import { describe, expect, it } from "vitest";
import { dashboardMetrics, expiryAlerts, listBatches, lowStockAlerts } from "@/server/services/inventory.service";
import { listMedicines } from "@/server/services/catalog.service";
import { createMedicine, createSupplier, createUser, receive, receiveHistoric } from "./helpers";
import { setupCleanDatabases } from "./lifecycle";
import { prisma } from "@/lib/db";

setupCleanDatabases();

async function scenario() {
  const { actor } = await createUser("STAFF");
  const supplier = await createSupplier({ name: "Alert Supplier" });
  const med = await createMedicine({ name: "Alertamol", reorderLevel: 10 });
  await receiveHistoric(actor, supplier.id, { medicineId: med.id, batchNumber: "EXPIRED", qty: 5, expDays: -4, receivedDaysAgo: 100 });
  await receiveHistoric(actor, supplier.id, { medicineId: med.id, batchNumber: "EMPTY-EXPIRED", qty: 1, expDays: -9, receivedDaysAgo: 100 });
  await receive(actor, supplier.id, [
    { medicineId: med.id, batchNumber: "SOON", qty: 8, expDays: 10 },
    { medicineId: med.id, batchNumber: "EDGE", qty: 2, expDays: 30 },
    { medicineId: med.id, batchNumber: "LATER", qty: 20, expDays: 45 },
  ]);
  // Deplete the second expired batch through the ledger (waste).
  const empty = await prisma.medicineBatch.findFirstOrThrow({ where: { batchNumber: "EMPTY-EXPIRED" } });
  const op = await prisma.stockOperation.create({ data: { type: "WASTE", idempotencyKey: crypto.randomUUID(), performedById: actor.id, reason: "EXPIRED" } });
  await prisma.stockTransaction.create({ data: { batchId: empty.id, type: "WASTE", quantity: 1, performedById: actor.id, operationId: op.id } });
  return { actor, med };
}

describe("expiry alerts (sp_expiring_batches)", () => {
  it("separates expired from expiring-soon batches within the window", async () => {
    const { actor } = await scenario();
    const alerts = await expiryAlerts(actor, 30);
    expect(alerts.expired.map((a) => [a.batchNumber, a.daysToExpiry, a.quantity])).toEqual([["EXPIRED", -4, 5]]);
    expect(alerts.expiringSoon.map((a) => [a.batchNumber, a.daysToExpiry])).toEqual([
      ["SOON", 10],
      ["EDGE", 30],
    ]);
    expect(alerts.expiringSoon[0].supplierName).toBe("Alert Supplier");
  });

  it("honours a configurable window", async () => {
    const { actor } = await scenario();
    const wide = await expiryAlerts(actor, 60);
    expect(wide.expiringSoon.map((a) => a.batchNumber)).toEqual(["SOON", "EDGE", "LATER"]);
    const narrow = await expiryAlerts(actor, 7);
    expect(narrow.expiringSoon).toHaveLength(0);
    expect(narrow.expired).toHaveLength(1);
  });

  it("derives batch status from live dates in the batch list", async () => {
    const { actor } = await scenario();
    const all = await listBatches(actor, { windowDays: 30 });
    const status = Object.fromEntries(all.rows.map((r) => [r.batchNumber, r.status]));
    expect(status).toEqual({ EXPIRED: "EXPIRED", "EMPTY-EXPIRED": "DEPLETED", SOON: "EXPIRING_SOON", EDGE: "EXPIRING_SOON", LATER: "AVAILABLE" });
    const expiredOnly = await listBatches(actor, { status: "EXPIRED" });
    expect(expiredOnly.rows.map((r) => r.batchNumber)).toEqual(["EXPIRED"]);
  });
});

describe("low-stock alerts (v_low_stock_medicines)", () => {
  it("compares usable (unexpired) stock with the reorder level", async () => {
    const { actor } = await createUser("STAFF");
    const supplier = await createSupplier();
    const fine = await createMedicine({ name: "Plentiful", reorderLevel: 10 });
    const low = await createMedicine({ name: "Scarce", reorderLevel: 10 });
    const atLevel = await createMedicine({ name: "Exactly", reorderLevel: 10 });
    const onlyExpired = await createMedicine({ name: "Stale", reorderLevel: 5 });
    const inactive = await createMedicine({ name: "Retired", reorderLevel: 10, isActive: false });
    await receive(actor, supplier.id, [
      { medicineId: fine.id, batchNumber: "A", qty: 11, expDays: 100 },
      { medicineId: low.id, batchNumber: "B", qty: 3, expDays: 100 },
      { medicineId: atLevel.id, batchNumber: "C", qty: 10, expDays: 100 },
    ]);
    await receiveHistoric(actor, supplier.id, { medicineId: onlyExpired.id, batchNumber: "D", qty: 500, expDays: -1, receivedDaysAgo: 40 });

    const alerts = await lowStockAlerts(actor);
    const byName = Object.fromEntries(alerts.map((a) => [a.medicineName, a]));
    expect(Object.keys(byName).sort()).toEqual(["Exactly", "Scarce", "Stale"]);
    expect(byName.Scarce).toMatchObject({ usableQuantity: 3, shortfall: 7, outOfStock: false });
    expect(byName.Stale).toMatchObject({ usableQuantity: 0, expiredQuantity: 500, outOfStock: true });
    expect(byName.Retired).toBeUndefined();
    expect(inactive.isActive).toBe(false);

    const filtered = await listMedicines(actor, { stock: "low" });
    expect(filtered.rows.map((r) => r.name).sort()).toEqual(["Exactly", "Scarce", "Stale"]);
  });
});

describe("dashboard metrics", () => {
  it("are computed from the live tables and views", async () => {
    const { actor } = await scenario();
    const metrics = await dashboardMetrics(actor);
    expect(metrics).toMatchObject({
      activeMedicines: 1,
      totalUnits: 35,
      usableUnits: 30,
      expiredBatches: 1,
      expiringBatches: 2,
      lowStock: 0,
      reconciliationIssues: 0,
    });
    expect(metrics.recentMovements.length).toBeGreaterThan(0);
    expect(metrics.recentPurchases.length).toBeGreaterThan(0);
  });
});
