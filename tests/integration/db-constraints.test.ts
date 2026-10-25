import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { mysqlPool, prisma } from "@/lib/db";
import { ConflictError, databaseRuleMessage, ValidationError } from "@/lib/errors";
import { addDays, businessToday } from "@/lib/dates";
import { createMedicine as createMedicineService, deleteMedicine, deleteSupplier } from "@/server/services/catalog.service";
import { batchByNumber, createCategory, createMedicine, createSupplier, createUser, receive, uuid } from "./helpers";
import { setupCleanDatabases } from "./lifecycle";

setupCleanDatabases();

const errorText = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return databaseRuleMessage(error) ?? String((error as { code?: string }).code);
  }
  throw new Error("expected the database to reject the operation");
};

describe("database-level validation and integrity", () => {
  it("CHECK: expiry must be after manufacture; quantity and cost cannot be negative", async () => {
    const medicine = await createMedicine();
    const base = { medicineId: medicine.id, unitCost: new Prisma.Decimal(1) };
    expect(await errorText(prisma.medicineBatch.create({ data: { ...base, batchNumber: "C1", manufactureDate: addDays(businessToday(), -10), expiryDate: addDays(businessToday(), -20) } }))).toBe(
      "Expiry date must be after the manufacturing date.",
    );
    expect(await errorText(prisma.medicineBatch.create({ data: { ...base, unitCost: new Prisma.Decimal(-1), batchNumber: "C2", manufactureDate: addDays(businessToday(), -10), expiryDate: addDays(businessToday(), 20) } }))).toBe(
      "Unit cost cannot be negative.",
    );
    expect(await errorText(prisma.medicine.update({ where: { id: medicine.id }, data: { reorderLevel: -5 } }))).toBe("Reorder level must be zero or more.");
  });

  it("TRIGGER: batches start empty and their quantity can only change through the ledger", async () => {
    const { actor } = await createUser("STAFF");
    const supplier = await createSupplier();
    const medicine = await createMedicine();
    expect(
      await errorText(prisma.medicineBatch.create({ data: { medicineId: medicine.id, batchNumber: "Q0", manufactureDate: addDays(businessToday(), -5), expiryDate: addDays(businessToday(), 50), unitCost: new Prisma.Decimal(1), quantity: 10 } })),
    ).toMatch(/must start at quantity 0/);
    expect(
      await errorText(prisma.medicineBatch.create({ data: { medicineId: medicine.id, batchNumber: "QF", manufactureDate: addDays(businessToday(), 5), expiryDate: addDays(businessToday(), 50), unitCost: new Prisma.Decimal(1) } })),
    ).toBe("Manufacturing date cannot be in the future");

    await receive(actor, supplier.id, [{ medicineId: medicine.id, batchNumber: "Q1", qty: 10, expDays: 100 }]);
    const batch = await batchByNumber(medicine.id, "Q1");
    expect(await errorText(prisma.medicineBatch.update({ where: { id: batch.id }, data: { quantity: 999 } }))).toBe(
      "Batch quantity can only change through the stock_transactions ledger",
    );
    expect(await errorText(prisma.medicineBatch.update({ where: { id: batch.id }, data: { expiryDate: addDays(businessToday(), 900) } }))).toMatch(/cannot be changed/);
    expect((await batchByNumber(medicine.id, "Q1")).quantity).toBe(10);
  });

  it("TRIGGER: the ledger rejects zero quantities, mismatched operations and is append-only", async () => {
    const { actor } = await createUser("STAFF");
    const supplier = await createSupplier();
    const medicine = await createMedicine();
    await receive(actor, supplier.id, [{ medicineId: medicine.id, batchNumber: "L1", qty: 10, expDays: 100 }]);
    const batch = await batchByNumber(medicine.id, "L1");
    const waste = await prisma.stockOperation.create({ data: { type: "WASTE", idempotencyKey: uuid(), performedById: actor.id, reason: "DAMAGED" } });

    expect(await errorText(prisma.stockTransaction.create({ data: { batchId: batch.id, type: "WASTE", quantity: 0, performedById: actor.id, operationId: waste.id } }))).toBe(
      "Movement quantity must be a positive whole number",
    );
    expect(await errorText(prisma.stockTransaction.create({ data: { batchId: batch.id, type: "STOCK_OUT", quantity: 1, performedById: actor.id, operationId: waste.id } }))).toBe(
      "Movement type does not match its stock operation type",
    );
    expect(await errorText(prisma.stockTransaction.create({ data: { batchId: batch.id, type: "WASTE", quantity: 1, performedById: actor.id, createdAt: new Date(Date.now() + 86_400_000), operationId: waste.id } }))).toBe(
      "A stock movement cannot be dated in the future",
    );
    // The trigger runs before CHECK constraints: a stock-in without its purchase line is refused there...
    expect(await errorText(prisma.stockTransaction.create({ data: { batchId: batch.id, type: "STOCK_IN", quantity: 1, performedById: actor.id } }))).toBe(
      "Stock-in must match the batch and quantity of its purchase item",
    );
    // ...and CHECK chk_transactions_source refuses a non-stock-in that points at a purchase line.
    const line = await prisma.purchaseItem.findFirstOrThrow({ where: { batchId: batch.id } });
    expect(
      await errorText(prisma.stockTransaction.create({ data: { batchId: batch.id, type: "WASTE", quantity: 1, performedById: actor.id, operationId: waste.id, purchaseItemId: line.id } })),
    ).toBe("A stock-in must reference a purchase line and every other movement a stock operation.");

    const row = await prisma.stockTransaction.findFirstOrThrow({ where: { batchId: batch.id } });
    expect(await errorText(prisma.stockTransaction.update({ where: { id: row.id }, data: { quantity: 1 } }))).toMatch(/append-only/);
    expect(await errorText(prisma.stockTransaction.delete({ where: { id: row.id } }))).toMatch(/append-only/);
  });

  it("FOREIGN KEYS: unknown parents are rejected and referenced rows cannot be deleted", async () => {
    const { actor: admin } = await createUser("ADMIN");
    expect(
      await errorText(prisma.medicineBatch.create({ data: { medicineId: 999_999, batchNumber: "F1", manufactureDate: addDays(businessToday(), -5), expiryDate: addDays(businessToday(), 50), unitCost: new Prisma.Decimal(1) } })),
    ).toBe("P2003");

    const supplier = await createSupplier();
    const medicine = await createMedicine();
    await receive(admin, supplier.id, [{ medicineId: medicine.id, batchNumber: "F2", qty: 3, expDays: 100 }]);
    expect(await errorText(prisma.medicine.delete({ where: { id: medicine.id } }))).toBe("P2003");
    await expect(deleteMedicine(admin, medicine.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(deleteSupplier(admin, supplier.id)).rejects.toBeInstanceOf(ConflictError);

    const unused = await createMedicine();
    await deleteMedicine(admin, unused.id);
    expect(await prisma.medicine.findUnique({ where: { id: unused.id } })).toBeNull();
  });

  it("UNIQUE: duplicate medicines are reported as a validation error", async () => {
    const { actor: admin } = await createUser("ADMIN");
    const category = await createCategory();
    const input = { name: "Dupcillin", categoryId: category.id, manufacturer: "Acme", dosageForm: "CAPSULE", strength: "250 mg", unit: "strip", storageCondition: "COOL_DRY", reorderLevel: 1, isActive: true };
    await createMedicineService(admin, input);
    await expect(createMedicineService(admin, { ...input, name: "DUPCILLIN" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("all views, functions and procedures exist and can be queried", async () => {
    for (const view of ["v_batch_stock", "v_expiring_batches", "v_expired_batches", "v_inventory_summary", "v_low_stock_medicines", "v_purchase_summary", "v_stock_reconciliation"]) {
      await expect(prisma.$queryRawUnsafe(`SELECT * FROM \`${view}\` LIMIT 1`)).resolves.toBeDefined();
    }
    const [row] = await prisma.$queryRaw<{ today: Date }[]>`SELECT fn_business_today() AS today`;
    expect(row.today.toISOString().slice(0, 10)).toBe(businessToday().toISOString().slice(0, 10));
    await expect(mysqlPool().query("CALL sp_expiring_batches(0)")).rejects.toMatchObject({ sqlMessage: "p_days must be between 1 and 365" });
    const triggers = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()`;
    expect(Number(triggers[0].n)).toBe(5);
  });
});
