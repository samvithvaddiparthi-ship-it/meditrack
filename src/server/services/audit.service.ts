import "server-only";
import type { Filter } from "mongodb";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { COLLECTIONS, mongoDb } from "@/lib/mongo";
import { assertCan } from "@/lib/authz";
import { logServerError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions";

/**
 * Activity / audit logging with a transactional outbox.
 *
 * MySQL and MongoDB cannot share one atomic transaction. Every audit event
 * is therefore first INSERTed into MySQL `audit_outbox` *inside the same
 * transaction* as the business change (so the event exists if and only if
 * the change committed) and then delivered to MongoDB `activity_logs`.
 * Delivery is idempotent (_id = "outbox:<id>"), and undelivered rows are
 * retried on the next flush, so an outage in MongoDB never loses events and
 * never blocks or falsely reports an inventory operation.
 */

/** Shape of a document in MongoDB `activity_logs`. */
type ActivityDoc = {
  _id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  actor: { id: number; name: string; role: string } | null;
  details: Record<string, unknown>;
  createdAt: Date;
  outboxId: number;
};

export type AuditEvent = {
  action: string; // "<entity>.<verb>", e.g. "stock.issue"
  entityType: string;
  entityId?: string | number | null;
  summary: string;
  actor?: Actor | null;
  details?: Record<string, unknown>;
};

const SENSITIVE_KEY = /pass(word)?|token|secret|hash|cookie|session|uri|url|authorization|api[-_]?key/i;

/** Removes anything that looks like a credential before it is stored. */
export function sanitizeDetails(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitizeDetails(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k)) continue;
      out[k] = sanitizeDetails(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") return value.slice(0, 500);
  return value;
}

function toPayload(event: AuditEvent) {
  return {
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId === undefined || event.entityId === null ? null : String(event.entityId),
    summary: event.summary.slice(0, 300),
    actor: event.actor ? { id: event.actor.id, name: event.actor.name, role: event.actor.role } : null,
    details: sanitizeDetails(event.details ?? {}) as Record<string, unknown>,
    occurredAt: new Date().toISOString(),
  };
}

/** Records an audit event as part of the caller's MySQL transaction. */
export async function enqueueAudit(tx: Tx, event: AuditEvent): Promise<void> {
  await tx.auditOutbox.create({ data: { payload: toPayload(event) as Prisma.InputJsonObject } });
}

/** Records an audit event that is not tied to a larger transaction. */
export async function recordAudit(event: AuditEvent): Promise<boolean> {
  await prisma.auditOutbox.create({ data: { payload: toPayload(event) as Prisma.InputJsonObject } });
  return flushOutbox();
}

/**
 * Delivers pending outbox rows to MongoDB. Never throws: returns true when
 * nothing is left pending, false when delivery failed (rows stay queued and
 * their attempt counter / last error are updated).
 */
export async function flushOutbox(limit = 200): Promise<boolean> {
  let ids: number[] = [];
  try {
    const pending = await prisma.auditOutbox.findMany({
      where: { deliveredAt: null },
      orderBy: { id: "asc" },
      take: limit,
    });
    if (pending.length === 0) return true;
    ids = pending.map((p) => p.id);

    const db = await mongoDb();
    await db.collection<ActivityDoc>(COLLECTIONS.activity).bulkWrite(
      pending.map((row) => {
        const p = row.payload as ReturnType<typeof toPayload>;
        return {
          updateOne: {
            filter: { _id: `outbox:${row.id}` },
            update: {
              $setOnInsert: {
                action: p.action,
                entityType: p.entityType,
                entityId: p.entityId,
                summary: p.summary,
                actor: p.actor,
                details: p.details ?? {},
                createdAt: new Date(p.occurredAt ?? row.createdAt),
                outboxId: row.id,
              },
            },
            upsert: true,
          },
        };
      }),
      { ordered: false },
    );
    await prisma.auditOutbox.updateMany({ where: { id: { in: ids } }, data: { deliveredAt: new Date() } });
    return pending.length < limit ? true : flushOutbox(limit);
  } catch (error) {
    logServerError("Audit outbox delivery failed", error);
    if (ids.length) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.auditOutbox
        .updateMany({
          where: { id: { in: ids } },
          data: { attempts: { increment: 1 }, lastError: message.replace(/mongodb(\+srv)?:\/\/\S+/gi, "[uri]").slice(0, 500) },
        })
        .catch(() => undefined);
    }
    return false;
  }
}

export async function outboxBacklog(): Promise<number> {
  return prisma.auditOutbox.count({ where: { deliveredAt: null } });
}

// ------------------------------------------------------------------ reading

export type ActivityEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  actor: { id: number; name: string; role: string } | null;
  details: Record<string, unknown>;
  createdAt: Date;
};

export type ActivityFilters = {
  action?: string;
  entityType?: string;
  actorId?: number;
  page?: number;
  pageSize?: number;
};

export async function listActivity(actor: Actor, filters: ActivityFilters = {}) {
  assertCan(actor, "audit:view");
  await flushOutbox();
  const db = await mongoDb();
  const query: Filter<ActivityDoc> = {};
  if (filters.action) query.action = filters.action;
  if (filters.entityType) query.entityType = filters.entityType;
  if (filters.actorId) query["actor.id"] = filters.actorId;
  const pageSize = Math.min(filters.pageSize ?? 25, 100);
  const page = Math.max(filters.page ?? 1, 1);
  const collection = db.collection<ActivityDoc>(COLLECTIONS.activity);
  const [docs, total, actions, entityTypes] = await Promise.all([
    collection.find(query).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
    collection.countDocuments(query),
    collection.distinct("action"),
    collection.distinct("entityType"),
  ]);
  const entries: ActivityEntry[] = docs.map((d) => ({
    id: String(d._id),
    action: d.action,
    entityType: d.entityType,
    entityId: d.entityId ?? null,
    summary: d.summary,
    actor: d.actor ?? null,
    details: d.details ?? {},
    createdAt: d.createdAt,
  }));
  return { entries, total, page, pageSize, actions: actions.sort(), entityTypes: entityTypes.sort() };
}

/** MongoDB aggregation: events per action over the last `days` days. */
export async function activitySummary(actor: Actor, days = 30) {
  assertCan(actor, "audit:view");
  const db = await mongoDb();
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .collection<ActivityDoc>(COLLECTIONS.activity)
    .aggregate<{ _id: string; count: number; lastAt: Date }>([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: "$action", count: { $sum: 1 }, lastAt: { $max: "$createdAt" } } },
      { $sort: { count: -1, _id: 1 } },
    ])
    .toArray();
  return rows.map((r) => ({ action: r._id, count: r.count, lastAt: r.lastAt }));
}
