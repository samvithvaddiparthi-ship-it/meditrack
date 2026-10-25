import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { COLLECTIONS, mongoDb } from "@/lib/mongo";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { issueStock, previewIssue, recordAdjustment, recordWaste, writeOffExpired } from "@/server/services/stock.service";
import { runTransaction } from "@/server/services/tx";
import { batchByNumber, batchQuantity, createMedicine, createSupplier, createUser, receive, receiveHistoric, reconciliationMismatches, uuid } from "./helpers";
import { setupCleanDatabases } from "./lifecycle";

setupCleanDatabases();

async function stockedMedicine() {
  const { actor } = await createUser("STAFF");
  const supplier = await createSupplier();
  const medicine = await createMedicine();
  await receive(actor, supplier.id, [
    { medicineId: medicine.id, batchNumber: "LATE", qty: 50, expDays: 400 },
    { medicineId: medicine.id, batchNumber: "EARLY", qty: 30, expDays: 60 },
    { medicineId: medicine.id, batchNumber: "MID", qty: 20, expDays: 120 },
  ]);
  return { actor, supplier, medicine };
}

const issue = (actor: Parameters<typeof issueStock>[0], medicineId: number, quantity: number, key = uuid()) =>
  issueStock(actor, { idempotencyKey: key, medicineId, quantity, destination: "Ward 7", notes: null });

describe("stock issue (FEFO)", () => {
  it("reduces stock using the earliest-expiring batches first, atomically across batches", async () => {
    const { actor, medicine } = await stockedMedicine();
    const result = await issue(actor, medicine.id, 45);

    expect(result.movements.map((m) => [m.batchNumber, m.quantity])).toEqual([
      ["EARLY", 30],
      ["MID", 15],
    ]);
    expect(await batchQuantity((await batchByNumber(medicine.id, "EARLY")).id)).toBe(0);
    expect(await batchQuantity((await batchByNumber(medicine.id, "MID")).id)).toBe(5);
    expect(await batchQuantity((await batchByNumber(medicine.id, "LATE")).id)).toBe(50);

    const op = await prisma.stockOperation.findUniqueOrThrow({ where: { id: result.operationId }, include: { transactions: true } });
    expect(op.type).toBe("ISSUE");
    expect(op.transactions).toHaveLength(2);
    expect(op.transactions.every((t) => t.type === "STOCK_OUT" && t.performedById === actor.id)).toBe(true);
    expect(await reconciliationMismatches()).toBe(0);
  });

  it("matches the read-only FEFO preview", async () => {
    const { actor, medicine } = await stockedMedicine();
    const preview = await previewIssue(actor, { medicineId: medicine.id, quantity: 60 });
    expect(preview.allocations.map((a) => [a.batchNumber, a.take])).toEqual([
      ["EARLY", 30],
      ["MID", 20],
      ["LATE", 10],
    ]);
  });

  it("rejects an issue larger than the available stock and writes nothing", async () => {
    const { actor, medicine } = await stockedMedicine();
    await expect(issue(actor, medicine.id, 101)).rejects.toThrow(/Only 100 strip\(s\)/);
    expect(await prisma.stockOperation.count()).toBe(0);
    expect(await prisma.stockTransaction.count({ where: { type: "STOCK_OUT" } })).toBe(0);
    expect(await batchQuantity((await batchByNumber(medicine.id, "EARLY")).id)).toBe(30);
  });

  it("never issues from expired batches, even when they are first by expiry", async () => {
    const { actor } = await createUser("STAFF");
    const supplier = await createSupplier();
    const medicine = await createMedicine();
    const { batch: expired } = await receiveHistoric(actor, supplier.id, { medicineId: medicine.id, batchNumber: "OLD", qty: 40, expDays: -5, receivedDaysAgo: 90 });
    const { batch: expiresToday } = await receiveHistoric(actor, supplier.id, { medicineId: medicine.id, batchNumber: "TODAY", qty: 40, expDays: 0, receivedDaysAgo: 90 });

    // Only expired stock exists: the issue is refused.
    await expect(issue(actor, medicine.id, 1)).rejects.toThrow(/Only 0 strip/);

    await receive(actor, supplier.id, [{ medicineId: medicine.id, batchNumber: "NEW", qty: 10, expDays: 200 }]);
    const result = await issue(actor, medicine.id, 10);
    expect(result.movements.map((m) => m.batchNumber)).toEqual(["NEW"]);
    expect(await batchQuantity(expired.id)).toBe(40);
    expect(await batchQuantity(expiresToday.id)).toBe(40);
  });

  it("the ledger trigger rejects a direct STOCK_OUT from an expired batch", async () => {
    const { actor } = await createUser("STAFF");
    const supplier = await createSupplier();
    const medicine = await createMedicine();
    const { batch } = await receiveHistoric(actor, supplier.id, { medicineId: medicine.id, batchNumber: "EXP", qty: 10, expDays: -1, receivedDaysAgo: 30 });
    const op = await prisma.stockOperation.create({ data: { type: "ISSUE", idempotencyKey: uuid(), performedById: actor.id, destination: "Ward" } });
    await expect(
      prisma.stockTransaction.create({ data: { batchId: batch.id, type: "STOCK_OUT", quantity: 1, performedById: actor.id, operationId: op.id } }),
    ).rejects.toMatchObject({ meta: { driverAdapterError: { cause: { originalMessage: "Cannot issue from an expired batch; record it as waste instead" } } } });
    expect(await batchQuantity(batch.id)).toBe(10);
  });

  it("is idempotent for repeated submissions of the same form", async () => {
    const { actor, medicine } = await stockedMedicine();
    const key = uuid();
    const first = await issue(actor, medicine.id, 10, key);
    const again = await issue(actor, medicine.id, 10, key);
    expect(again).toMatchObject({ operationId: first.operationId, duplicate: true });
    expect(await prisma.stockOperation.count()).toBe(1);
    expect(await batchQuantity((await batchByNumber(medicine.id, "EARLY")).id)).toBe(20);
  });

  it("serialises concurrent issues so stock never goes negative", async () => {
    const { actor } = await createUser("STAFF");
    const supplier = await createSupplier();
    const medicine = await createMedicine();
    await receive(actor, supplier.id, [{ medicineId: medicine.id, batchNumber: "C-1", qty: 100, expDays: 300 }]);
    const results = await Promise.allSettled([issue(actor, medicine.id, 60), issue(actor, medicine.id, 60), issue(actor, medicine.id, 30)]);
    // In every serial order exactly one 60 and the 30 fit into 100 units; the other 60 must fail.
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ValidationError);
    expect(await batchQuantity((await batchByNumber(medicine.id, "C-1")).id)).toBe(10);
    expect(await reconciliationMismatches()).toBe(0);
  });
});

describe("waste, adjustments and rollback", () => {
  it("allows expired stock to be written off as waste, but not unexpired stock as EXPIRED", async () => {
    const { actor } = await createUser("STAFF");
    const supplier = await createSupplier();
    const medicine = await createMedicine();
    const { batch } = await receiveHistoric(actor, supplier.id, { medicineId: medicine.id, batchNumber: "W-1", qty: 12, expDays: -3, receivedDaysAgo: 60 });
    const waste = await recordWaste(actor, { idempotencyKey: uuid(), batchId: batch.id, quantity: 12, reason: "EXPIRED", notes: "Disposed" });
    expect(waste.movements[0].balanceAfter).toBe(0);

    await receive(actor, supplier.id, [{ medicineId: medicine.id, batchNumber: "W-2", qty: 5, expDays: 100 }]);
    const fresh = await batchByNumber(medicine.id, "W-2");
    await expect(recordWaste(actor, { idempotencyKey: uuid(), batchId: fresh.id, quantity: 1, reason: "EXPIRED" })).rejects.toThrow(/not expired/);
    const damaged = await recordWaste(actor, { idempotencyKey: uuid(), batchId: fresh.id, quantity: 2, reason: "DAMAGED", notes: "Crushed box" });
    expect(damaged.movements[0].balanceAfter).toBe(3);
  });

  it("rejects waste or adjustments larger than the batch balance (trigger)", async () => {
    const { actor } = await createUser("STAFF");
    const supplier = await createSupplier();
    const medicine = await createMedicine();
    await receive(actor, supplier.id, [{ medicineId: medicine.id, batchNumber: "N-1", qty: 5, expDays: 100 }]);
    const batch = await batchByNumber(medicine.id, "N-1");
    await expect(recordWaste(actor, { idempotencyKey: uuid(), batchId: batch.id, quantity: 6, reason: "DAMAGED" })).rejects.toThrow(
      "Insufficient stock in the batch for this movement",
    );
    await expect(
      recordAdjustment(actor, { idempotencyKey: uuid(), batchId: batch.id, direction: "OUT", quantity: 6, reason: "COUNT_CORRECTION", notes: "Count lower" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await batchQuantity(batch.id)).toBe(5);
    expect(await prisma.stockOperation.count()).toBe(0);
  });

  it("rolls back earlier ledger rows when a later statement in the transaction fails", async () => {
    const { actor } = await createUser("STAFF");
    const supplier = await createSupplier();
    const medicine = await createMedicine();
    await receive(actor, supplier.id, [
      { medicineId: medicine.id, batchNumber: "T-1", qty: 10, expDays: 100 },
      { medicineId: medicine.id, batchNumber: "T-2", qty: 3, expDays: 200 },
    ]);
    const t1 = await batchByNumber(medicine.id, "T-1");
    const t2 = await batchByNumber(medicine.id, "T-2");
    await expect(
      runTransaction(async (tx) => {
        const op = await tx.stockOperation.create({ data: { type: "ISSUE", idempotencyKey: uuid(), performedById: actor.id, destination: "Ward" } });
        await tx.stockTransaction.create({ data: { batchId: t1.id, type: "STOCK_OUT", quantity: 10, performedById: actor.id, operationId: op.id } });
        await tx.stockTransaction.create({ data: { batchId: t2.id, type: "STOCK_OUT", quantity: 4, performedById: actor.id, operationId: op.id } }); // fails
      }),
    ).rejects.toBeTruthy();
    expect(await batchQuantity(t1.id)).toBe(10);
    expect(await batchQuantity(t2.id)).toBe(3);
    expect(await prisma.stockOperation.count()).toBe(0);
    expect(await prisma.stockTransaction.count({ where: { type: "STOCK_OUT" } })).toBe(0);
  });

  it("writes off all expired stock through the stored procedure, once", async () => {
    const { actor: admin } = await createUser("ADMIN");
    const { actor: staff } = await createUser("STAFF");
    const supplier = await createSupplier();
    const medicine = await createMedicine();
    const { batch: e1 } = await receiveHistoric(admin, supplier.id, { medicineId: medicine.id, batchNumber: "P-1", qty: 7, expDays: -2, receivedDaysAgo: 50 });
    const { batch: e2 } = await receiveHistoric(admin, supplier.id, { medicineId: medicine.id, batchNumber: "P-2", qty: 3, expDays: -20, receivedDaysAgo: 80 });
    await receive(admin, supplier.id, [{ medicineId: medicine.id, batchNumber: "P-3", qty: 9, expDays: 90 }]);

    await expect(writeOffExpired(staff, { idempotencyKey: uuid() })).rejects.toBeInstanceOf(ForbiddenError);
    const key = uuid();
    const result = await writeOffExpired(admin, { idempotencyKey: key });
    expect(result).toMatchObject({ batchCount: 2, unitCount: 10, auditDelivered: true });
    expect(await batchQuantity(e1.id)).toBe(0);
    expect(await batchQuantity(e2.id)).toBe(0);
    expect(await batchQuantity((await batchByNumber(medicine.id, "P-3")).id)).toBe(9);

    const repeat = await writeOffExpired(admin, { idempotencyKey: key });
    expect(repeat.operationId).toBe(result.operationId);
    const nothingLeft = await writeOffExpired(admin, { idempotencyKey: uuid() });
    expect(nothingLeft).toMatchObject({ operationId: null, batchCount: 0 });

    // The procedure queued its audit event in the same transaction; it reached MongoDB.
    const log = await (await mongoDb()).collection(COLLECTIONS.activity).findOne({ action: "stock.write_off_expired" });
    expect(log).toMatchObject({ entityId: String(result.operationId), details: { unitCount: 10 } });
    expect(await reconciliationMismatches()).toBe(0);
  });
});
