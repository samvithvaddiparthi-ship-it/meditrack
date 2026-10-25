import "server-only";
import { ObjectId, type Filter } from "mongodb";
import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/authz";
import { toIsoDate } from "@/lib/dates";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { COLLECTIONS, mongoDb, nextSequence } from "@/lib/mongo";
import { can, type Actor } from "@/lib/permissions";
import { parseInput } from "@/lib/validation/common";
import {
  incidentSchema,
  incidentStatusSchema,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  type IncidentSeverity,
  type IncidentStatus,
  type IncidentType,
} from "@/lib/validation/schemas";
import { recordAudit } from "@/server/services/audit.service";

/**
 * Incident reports are documents in MongoDB `incident_reports`:
 * each type carries different metadata, and the review history is an
 * embedded `timeline` array that grows over time. MySQL entities are
 * referenced by id with a name snapshot (no cross-database joins needed
 * to display a report, and a report stays readable if names change).
 */

type ActorRef = { id: number; name: string; role: "ADMIN" | "STAFF" };

export type TimelineEntry = {
  at: Date;
  actor: ActorRef;
  action: "CREATED" | "STATUS_CHANGED";
  fromStatus?: IncidentStatus;
  toStatus?: IncidentStatus;
  note?: string;
};

export type IncidentDoc = {
  _id: ObjectId;
  reference: string;
  type: IncidentType;
  title: string;
  description: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  medicine: { id: number; name: string } | null;
  batch: { id: number; batchNumber: string; expiryDate: string } | null;
  reporter: ActorRef;
  metadata: Record<string, unknown>;
  timeline: TimelineEntry[];
  createdAt: Date;
  updatedAt: Date;
};

export const ALLOWED_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  OPEN: ["UNDER_REVIEW", "RESOLVED", "DISMISSED"],
  UNDER_REVIEW: ["OPEN", "RESOLVED", "DISMISSED"],
  RESOLVED: ["OPEN"],
  DISMISSED: ["OPEN"],
};

function actorRef(actor: Actor): ActorRef {
  return { id: actor.id, name: actor.name, role: actor.role };
}

async function incidents() {
  const db = await mongoDb();
  return { db, collection: db.collection<IncidentDoc>(COLLECTIONS.incidents) };
}

function parseObjectId(id: string): ObjectId {
  if (!ObjectId.isValid(id) || String(new ObjectId(id)) !== id) throw new NotFoundError("Incident report not found.");
  return new ObjectId(id);
}

/** Staff see only their own reports; reviewers see all. */
function visibilityFilter(actor: Actor): Filter<IncidentDoc> {
  return can(actor.role, "incident:view-all") ? {} : { "reporter.id": actor.id };
}

export async function createIncident(actor: Actor, input: unknown) {
  assertCan(actor, "incident:create");
  const data = parseInput(incidentSchema, input);

  // Validate MySQL references before writing the document.
  let medicine: IncidentDoc["medicine"] = null;
  let batch: IncidentDoc["batch"] = null;
  if (data.medicineId) {
    const m = await prisma.medicine.findUnique({ where: { id: data.medicineId }, select: { id: true, name: true, strength: true } });
    if (!m) throw new ValidationError("Medicine not found.", { medicineId: ["Unknown medicine."] });
    medicine = { id: m.id, name: `${m.name} ${m.strength}` };
  }
  if (data.batchId) {
    const b = await prisma.medicineBatch.findUnique({ where: { id: data.batchId } });
    if (!b || b.medicineId !== data.medicineId) {
      throw new ValidationError("The batch does not belong to the selected medicine.", { batchId: ["Invalid batch."] });
    }
    batch = { id: b.id, batchNumber: b.batchNumber, expiryDate: toIsoDate(b.expiryDate) };
  }

  const metadata: Record<string, unknown> = Object.fromEntries(
    Object.entries(data.metadata).filter(([, v]) => v !== undefined && v !== null),
  );
  if (data.type === "STOCK_DISCREPANCY") {
    metadata.difference = Number(data.metadata.countedQuantity) - Number(data.metadata.expectedQuantity);
  }

  const { db, collection } = await incidents();
  const now = new Date();
  const sequence = await nextSequence(db, "incident_reports");
  const doc: Omit<IncidentDoc, "_id"> = {
    reference: `INC-${String(sequence).padStart(5, "0")}`,
    type: data.type,
    title: data.title,
    description: data.description,
    severity: data.severity,
    status: "OPEN",
    medicine,
    batch,
    reporter: actorRef(actor),
    metadata,
    timeline: [{ at: now, actor: actorRef(actor), action: "CREATED", toStatus: "OPEN" }],
    createdAt: now,
    updatedAt: now,
  };
  const result = await collection.insertOne(doc as IncidentDoc);
  const id = result.insertedId.toHexString();

  const auditDelivered = await recordAudit({
    action: "incident.create",
    entityType: "incident",
    entityId: id,
    summary: `Reported ${doc.reference}: ${doc.title} (${doc.severity.toLowerCase()})`,
    actor,
    details: { reference: doc.reference, type: doc.type, severity: doc.severity, medicineId: medicine?.id ?? null },
  });
  return { id, reference: doc.reference, auditDelivered };
}

export type IncidentFilters = {
  q?: string;
  type?: IncidentType;
  severity?: IncidentSeverity;
  status?: IncidentStatus;
  medicineId?: number;
  page?: number;
  pageSize?: number;
};

export async function listIncidents(actor: Actor, filters: IncidentFilters = {}) {
  assertCan(actor, "incident:create");
  const { collection } = await incidents();
  const query: Filter<IncidentDoc> = { ...visibilityFilter(actor) };
  if (filters.type && INCIDENT_TYPES.includes(filters.type)) query.type = filters.type;
  if (filters.severity && INCIDENT_SEVERITIES.includes(filters.severity)) query.severity = filters.severity;
  if (filters.status && INCIDENT_STATUSES.includes(filters.status)) query.status = filters.status;
  if (filters.medicineId) query["medicine.id"] = filters.medicineId;
  const q = filters.q?.trim().slice(0, 100);
  if (q) {
    // Reference lookup or MongoDB $text search on title + description.
    if (/^INC-\d+$/i.test(q)) query.reference = q.toUpperCase();
    else query.$text = { $search: q };
  }
  const pageSize = Math.min(filters.pageSize ?? 20, 100);
  const page = Math.max(filters.page ?? 1, 1);
  const [rows, total] = await Promise.all([
    collection
      .find(query, { projection: { timeline: 0 } })
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray(),
    collection.countDocuments(query),
  ]);
  return { rows: rows.map((r) => ({ ...r, id: r._id.toHexString() })), total, page, pageSize };
}

export async function getIncident(actor: Actor, id: string) {
  assertCan(actor, "incident:create");
  const { collection } = await incidents();
  const doc = await collection.findOne({ _id: parseObjectId(id), ...visibilityFilter(actor) });
  if (!doc) throw new NotFoundError("Incident report not found.");
  return { ...doc, id: doc._id.toHexString() };
}

/**
 * Status change with optimistic concurrency: the update only matches if the
 * status is still the one the reviewer saw, and the transition is appended
 * to the embedded timeline in the same atomic document update.
 */
export async function updateIncidentStatus(actor: Actor, id: string, expectedStatus: string, input: unknown) {
  assertCan(actor, "incident:review");
  const data = parseInput(incidentStatusSchema, input);
  const { collection } = await incidents();
  const _id = parseObjectId(id);
  const current = await collection.findOne({ _id }, { projection: { status: 1, reference: 1 } });
  if (!current) throw new NotFoundError("Incident report not found.");
  if (current.status !== expectedStatus) {
    throw new ConflictError("This report was updated by someone else. Reload to see the latest status.");
  }
  if (!ALLOWED_TRANSITIONS[current.status].includes(data.status)) {
    throw new ValidationError(`Cannot move a report from ${current.status} to ${data.status}.`, { status: ["Transition not allowed."] });
  }
  const now = new Date();
  const result = await collection.updateOne(
    { _id, status: current.status },
    {
      $set: { status: data.status, updatedAt: now },
      $push: {
        timeline: { at: now, actor: actorRef(actor), action: "STATUS_CHANGED", fromStatus: current.status, toStatus: data.status, note: data.note },
      },
    },
  );
  if (result.matchedCount === 0) {
    throw new ConflictError("This report was updated by someone else. Reload to see the latest status.");
  }
  const auditDelivered = await recordAudit({
    action: "incident.status_change",
    entityType: "incident",
    entityId: id,
    summary: `${current.reference}: ${current.status} → ${data.status}`,
    actor,
    details: { reference: current.reference, from: current.status, to: data.status },
  });
  return { auditDelivered };
}

/**
 * MongoDB aggregation pipeline ($match -> $facet with $group/$sort):
 * counts by type, severity and status, open reports by severity, and a
 * monthly trend (IST months) — all in one round trip.
 */
export async function incidentSummary(actor: Actor) {
  assertCan(actor, "incident:create");
  const { collection } = await incidents();
  const [result] = await collection
    .aggregate<{
      byType: { _id: IncidentType; count: number }[];
      bySeverity: { _id: IncidentSeverity; count: number }[];
      byStatus: { _id: IncidentStatus; count: number }[];
      openBySeverity: { _id: IncidentSeverity; count: number }[];
      monthly: { _id: string; count: number; critical: number }[];
      total: { count: number }[];
    }>([
      { $match: visibilityFilter(actor) },
      {
        $facet: {
          byType: [{ $group: { _id: "$type", count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }],
          bySeverity: [{ $group: { _id: "$severity", count: { $sum: 1 } } }],
          byStatus: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
          openBySeverity: [
            { $match: { status: { $in: ["OPEN", "UNDER_REVIEW"] } } },
            { $group: { _id: "$severity", count: { $sum: 1 } } },
          ],
          monthly: [
            {
              $group: {
                _id: { $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: "Asia/Kolkata" } },
                count: { $sum: 1 },
                critical: { $sum: { $cond: [{ $in: ["$severity", ["HIGH", "CRITICAL"]] }, 1, 0] } },
              },
            },
            { $sort: { _id: 1 } },
            { $limit: 12 },
          ],
          total: [{ $count: "count" }],
        },
      },
    ])
    .toArray();

  const order = <T extends string>(keys: readonly T[], rows: { _id: T; count: number }[]) =>
    keys.map((k) => ({ key: k, count: rows.find((r) => r._id === k)?.count ?? 0 }));

  return {
    total: result?.total[0]?.count ?? 0,
    byType: order(INCIDENT_TYPES, result?.byType ?? []),
    bySeverity: order(INCIDENT_SEVERITIES, result?.bySeverity ?? []),
    byStatus: order(INCIDENT_STATUSES, result?.byStatus ?? []),
    openBySeverity: order(INCIDENT_SEVERITIES, result?.openBySeverity ?? []),
    monthly: (result?.monthly ?? []).map((m) => ({ month: m._id, count: m.count, highOrCritical: m.critical })),
  };
}

export async function recentIncidents(actor: Actor, limit = 5) {
  const { rows } = await listIncidents(actor, { pageSize: limit });
  return rows;
}
