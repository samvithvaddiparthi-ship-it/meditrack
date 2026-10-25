import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ConflictError, ValidationError } from "@/lib/errors";
import { receivePurchase } from "@/server/services/purchases.service";
import { batchByNumber, batchQuantity, createMedicine, createSupplier, createUser, dayIso, receive, reconciliationMismatches, uuid } from "./helpers";
import { setupCleanDatabases } from "./lifecycle";

setupCleanDatabases();

describe("purchase receipts", () => {
  it("creates the purchase, items, batches and increases stock exactly once", async () => {
    const { actor } = await createUser("STAFF");
    const supplier = await createSupplier();
    const a = await createMedicine();
    const b = await createMedicine();

    const result = await receive(actor, supplier.id, [
      { medicineId: a.id, batchNumber: "pa-001", qty: 100, expDays: 365, cost: 2.5 },
      { medicineId: b.id, batchNumber: "PB-001", qty: 40, expDays: 200, cost: 10 },
    ]);
    expect(result.duplicate).toBe(false);

    const batchA = await batchByNumber(a.id, "PA-001"); // batch numbers are normalised to upper case
    const batchB = await batchByNumber(b.id, "PB-001");
    expect(batchA.quantity).toBe(100);
    expect(batchB.quantity).toBe(40);

    const purchase = await prisma.purchase.findUniqueOrThrow({ where: { id: result.purchaseId }, include: { items: { include: { stockIn: true } } } });
    expect(purchase.items).toHaveLength(2);
    for (const item of purchase.items) {
      expect(item.stockIn).not.toBeNull();
      expect(item.stockIn!.quantity).toBe(item.quantity);
      expect(item.stockIn!.balanceAfter).toBe(item.quantity);
    }
    expect(await prisma.stockTransaction.count({ where: { type: "STOCK_IN" } })).toBe(2);
    expect(await reconciliationMismatches()).toBe(0);
  });

  it("treats a repeated submission (same idempotency key) as the same receipt", async () => {
    const { actor } = await createUser("STAFF");
    const supplier = await createSupplier();
    const medicine = await createMedicine();
    const input = {
      idempotencyKey: uuid(),
      supplierId: supplier.id,
      invoiceNumber: "INV-RETRY",
      purchaseDate: dayIso(0),
      items: [{ medicineId: medicine.id, batchNumber: "R-1", manufactureDate: dayIso(-30), expiryDate: dayIso(300), quantity: 25, unitCost: 4 }],
    };
    const first = await receivePurchase(actor, input);
    const second = await receivePurchase(actor, input);
    const [third, fourth] = await Promise.all([receivePurchase(actor, input), receivePurchase(actor, input)]);
    expect(second).toMatchObject({ purchaseId: first.purchaseId, duplicate: true });
    expect([third.purchaseId, fourth.purchaseId]).toEqual([first.purchaseId, first.purchaseId]);
    expect(await batchQuantity((await batchByNumber(medicine.id, "R-1")).id)).toBe(25);
    expect(await prisma.purchase.count()).toBe(1);
  });

  it("rejects the same supplier invoice entered twice with a new form", async () => {
    const { actor } = await createUser("STAFF");
    const supplier = await createSupplier();
    const medicine = await createMedicine();
    await receive(actor, supplier.id, [{ medicineId: medicine.id, batchNumber: "D-1", qty: 10, expDays: 100 }], "INV-DUP");
    await expect(receive(actor, supplier.id, [{ medicineId: medicine.id, batchNumber: "D-1", qty: 10, expDays: 100 }], "INV-DUP")).rejects.toBeInstanceOf(ConflictError);
    expect(await batchQuantity((await batchByNumber(medicine.id, "D-1")).id)).toBe(10);
  });

  it("adds a later delivery of the same batch to the existing batch row", async () => {
    const { actor } = await createUser("STAFF");
    const supplier = await createSupplier();
    const medicine = await createMedicine();
    await receive(actor, supplier.id, [{ medicineId: medicine.id, batchNumber: "S-1", qty: 10, expDays: 100, mfgDays: -20 }]);
    await receive(actor, supplier.id, [{ medicineId: medicine.id, batchNumber: "S-1", qty: 5, expDays: 100, mfgDays: -20 }]);
    const batch = await batchByNumber(medicine.id, "S-1");
    expect(batch.quantity).toBe(15);
    expect(await prisma.medicineBatch.count()).toBe(1);
    expect(await prisma.purchaseItem.count({ where: { batchId: batch.id } })).toBe(2);
  });

  it("rolls back the WHOLE receipt when a later line fails", async () => {
    const { actor } = await createUser("STAFF");
    const supplier = await createSupplier();
    const good = await createMedicine();
    const other = await createMedicine();
    await receive(actor, supplier.id, [{ medicineId: other.id, batchNumber: "X-1", qty: 10, expDays: 100, mfgDays: -20 }]);
    const before = { purchases: await prisma.purchase.count(), batches: await prisma.medicineBatch.count(), ledger: await prisma.stockTransaction.count() };

    // Line 1 is valid; line 2 re-uses batch X-1 with conflicting dates.
    await expect(
      receive(actor, supplier.id, [
        { medicineId: good.id, batchNumber: "G-1", qty: 50, expDays: 300 },
        { medicineId: other.id, batchNumber: "X-1", qty: 5, expDays: 150, mfgDays: -20 },
      ]),
    ).rejects.toThrow(/already recorded/);

    expect(await prisma.purchase.count()).toBe(before.purchases);
    expect(await prisma.medicineBatch.count()).toBe(before.batches);
    expect(await prisma.stockTransaction.count()).toBe(before.ledger);
    expect(await prisma.medicineBatch.findFirst({ where: { batchNumber: "G-1" } })).toBeNull();
    expect(await batchQuantity((await batchByNumber(other.id, "X-1")).id)).toBe(10);
  });

  it("refuses expired stock and inactive suppliers", async () => {
    const { actor } = await createUser("STAFF");
    const supplier = await createSupplier();
    const inactive = await createSupplier({ isActive: false });
    const medicine = await createMedicine();
    await expect(receive(actor, supplier.id, [{ medicineId: medicine.id, batchNumber: "E-1", qty: 5, expDays: 0 }])).rejects.toBeInstanceOf(ValidationError);
    await expect(receive(actor, inactive.id, [{ medicineId: medicine.id, batchNumber: "E-2", qty: 5, expDays: 100 }])).rejects.toThrow(/inactive/);
    expect(await prisma.medicineBatch.count()).toBe(0);
  });

  it("the database refuses a second STOCK_IN for the same purchase line", async () => {
    const { actor } = await createUser("STAFF");
    const supplier = await createSupplier();
    const medicine = await createMedicine();
    const { purchaseId } = await receive(actor, supplier.id, [{ medicineId: medicine.id, batchNumber: "U-1", qty: 10, expDays: 100 }]);
    const item = await prisma.purchaseItem.findFirstOrThrow({ where: { purchaseId } });
    await expect(
      prisma.stockTransaction.create({ data: { batchId: item.batchId, type: "STOCK_IN", quantity: 10, performedById: actor.id, purchaseItemId: item.id } }),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(await batchQuantity(item.batchId)).toBe(10);
  });
});
