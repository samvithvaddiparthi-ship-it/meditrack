import { describe, expect, it } from "vitest";
import { COLLECTIONS, mongoDb } from "@/lib/mongo";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { createIncident, getIncident, incidentSummary, listIncidents, updateIncidentStatus } from "@/server/services/incidents.service";
import { batchByNumber, createMedicine, createSupplier, createUser, receive } from "./helpers";
import { setupCleanDatabases } from "./lifecycle";

setupCleanDatabases();

const baseIncident = {
  type: "DAMAGED_PACKAGING",
  title: "Crushed carton on delivery",
  description: "Outer carton crushed; inner strips intact but labels torn.",
  severity: "LOW",
  metadata: { affectedQuantity: "4", packagingType: "Carton", sealIntact: "yes" },
};

describe("incident reports (MongoDB)", () => {
  it("persists a document with a reference, MySQL snapshots and typed metadata", async () => {
    const { actor } = await createUser("STAFF");
    const supplier = await createSupplier();
    const medicine = await createMedicine({ name: "Carton Med" });
    await receive(actor, supplier.id, [{ medicineId: medicine.id, batchNumber: "INC-B1", qty: 10, expDays: 100 }]);
    const batch = await batchByNumber(medicine.id, "INC-B1");

    const created = await createIncident(actor, { ...baseIncident, medicineId: String(medicine.id), batchId: String(batch.id) });
    expect(created.reference).toBe("INC-00001");

    const raw = await (await mongoDb()).collection(COLLECTIONS.incidents).findOne({ reference: "INC-00001" });
    expect(raw).toMatchObject({
      status: "OPEN",
      medicine: { id: medicine.id, name: "Carton Med 10 mg" },
      batch: { id: batch.id, batchNumber: "INC-B1" },
      reporter: { id: actor.id, role: "STAFF" },
      metadata: { affectedQuantity: 4, packagingType: "Carton", sealIntact: true },
    });
    expect(raw!.timeline).toHaveLength(1);

    const fetched = await getIncident(actor, created.id);
    expect(fetched.title).toBe(baseIncident.title);

    const activity = await (await mongoDb()).collection(COLLECTIONS.activity).findOne({ action: "incident.create", entityId: created.id });
    expect(activity).toMatchObject({ actor: { id: actor.id }, details: { reference: "INC-00001" } });
  });

  it("computes the discrepancy and validates cross-database references", async () => {
    const { actor } = await createUser("STAFF");
    const supplier = await createSupplier();
    const a = await createMedicine();
    const b = await createMedicine();
    await receive(actor, supplier.id, [{ medicineId: a.id, batchNumber: "DISC-1", qty: 10, expDays: 100 }]);
    const batch = await batchByNumber(a.id, "DISC-1");
    const discrepancy = {
      type: "STOCK_DISCREPANCY",
      title: "Count mismatch",
      description: "Physical count is lower than system stock.",
      severity: "MEDIUM",
      metadata: { expectedQuantity: 10, countedQuantity: 7 },
    };
    const created = await createIncident(actor, { ...discrepancy, medicineId: a.id, batchId: batch.id });
    expect((await getIncident(actor, created.id)).metadata).toMatchObject({ difference: -3 });

    await expect(createIncident(actor, { ...discrepancy, medicineId: b.id, batchId: batch.id })).rejects.toThrow(/does not belong/);
    await expect(createIncident(actor, { ...baseIncident, medicineId: 999999 })).rejects.toBeInstanceOf(ValidationError);
  });

  it("shows staff only their own reports; admins see all", async () => {
    const { actor: staffA } = await createUser("STAFF");
    const { actor: staffB } = await createUser("STAFF");
    const { actor: admin } = await createUser("ADMIN");
    const medicine = await createMedicine();
    const mine = await createIncident(staffA, { ...baseIncident, medicineId: medicine.id });
    await createIncident(staffB, { ...baseIncident, title: "Torn blister packs found", medicineId: medicine.id });

    expect((await listIncidents(staffA)).rows.map((r) => r.reference)).toEqual([mine.reference]);
    expect((await listIncidents(admin)).total).toBe(2);
    await expect(getIncident(staffB, mine.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getIncident(admin, "not-an-id")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("supports text search and filters", async () => {
    const { actor: admin } = await createUser("ADMIN");
    const medicine = await createMedicine();
    await createIncident(admin, { ...baseIncident, medicineId: medicine.id });
    await createIncident(admin, { type: "STORAGE_TEMPERATURE", title: "Fridge excursion overnight", description: "Refrigerator reached 11 degrees overnight.", severity: "HIGH", metadata: { recordedTemperatureC: "11" } });
    expect((await listIncidents(admin, { q: "refrigerator" })).rows.map((r) => r.type)).toEqual(["STORAGE_TEMPERATURE"]);
    expect((await listIncidents(admin, { severity: "LOW" })).total).toBe(1);
    expect((await listIncidents(admin, { q: "INC-00001" })).rows[0].reference).toBe("INC-00001");
  });

  it("only reviewers change status, along allowed transitions, with optimistic concurrency", async () => {
    const { actor: staff } = await createUser("STAFF");
    const { actor: admin } = await createUser("ADMIN");
    const medicine = await createMedicine();
    const { id } = await createIncident(staff, { ...baseIncident, medicineId: medicine.id });

    await expect(updateIncidentStatus(staff, id, "OPEN", { status: "RESOLVED", note: "Fixed" })).rejects.toBeInstanceOf(ForbiddenError);
    await updateIncidentStatus(admin, id, "OPEN", { status: "UNDER_REVIEW", note: "Checking with supplier" });
    await expect(updateIncidentStatus(admin, id, "OPEN", { status: "RESOLVED", note: "stale view" })).rejects.toBeInstanceOf(ConflictError);
    await updateIncidentStatus(admin, id, "UNDER_REVIEW", { status: "RESOLVED", note: "Replacement received" });
    await expect(updateIncidentStatus(admin, id, "RESOLVED", { status: "UNDER_REVIEW", note: "Again" })).rejects.toBeInstanceOf(ValidationError);

    const doc = await getIncident(admin, id);
    expect(doc.status).toBe("RESOLVED");
    expect(doc.timeline.map((t) => t.toStatus)).toEqual(["OPEN", "UNDER_REVIEW", "RESOLVED"]);
    expect(doc.timeline[2]).toMatchObject({ fromStatus: "UNDER_REVIEW", note: "Replacement received", actor: { id: admin.id } });
  });

  it("aggregates counts by type, severity, status and month", async () => {
    const { actor: admin } = await createUser("ADMIN");
    const medicine = await createMedicine();
    await createIncident(admin, { ...baseIncident, medicineId: medicine.id });
    await createIncident(admin, { ...baseIncident, severity: "HIGH", medicineId: medicine.id });
    const third = await createIncident(admin, { type: "OTHER", title: "Shelf label missing", description: "Shelf label for rack C3 is missing.", severity: "HIGH", metadata: {} });
    await updateIncidentStatus(admin, third.id, "OPEN", { status: "DISMISSED", note: "Label replaced" });

    const summary = await incidentSummary(admin);
    expect(summary.total).toBe(3);
    expect(summary.byType.find((t) => t.key === "DAMAGED_PACKAGING")?.count).toBe(2);
    expect(summary.byType.find((t) => t.key === "OTHER")?.count).toBe(1);
    expect(summary.bySeverity.find((s) => s.key === "HIGH")?.count).toBe(2);
    expect(summary.byStatus.find((s) => s.key === "DISMISSED")?.count).toBe(1);
    expect(summary.openBySeverity.find((s) => s.key === "HIGH")?.count).toBe(1);
    expect(summary.monthly.at(-1)).toMatchObject({ count: 3, highOrCritical: 2 });
  });
});
