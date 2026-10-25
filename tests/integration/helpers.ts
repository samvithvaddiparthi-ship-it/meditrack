import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { mysqlPool, prisma } from "@/lib/db";
import { COLLECTIONS, mongoDb } from "@/lib/mongo";
import { addDays, businessToday, toIsoDate } from "@/lib/dates";
import type { Actor, Role } from "@/lib/permissions";
import { hashPassword } from "@/server/auth/password";
import { receivePurchase } from "@/server/services/purchases.service";
import { testDatabaseConfig } from "./test-env";

const TABLES = [
  "stock_transactions",
  "stock_operations",
  "purchase_items",
  "purchases",
  "medicine_batches",
  "medicines",
  "categories",
  "suppliers",
  "sessions",
  "audit_outbox",
  "users",
];

/**
 * Empties every table of the *_test database. TRUNCATE (not DELETE) is used
 * because the ledger's append-only trigger rightly blocks DELETE.
 */
export async function resetDatabases(): Promise<void> {
  const { dbName } = testDatabaseConfig();
  const conn = await mysqlPool().getConnection();
  try {
    const [{ db }] = (await conn.query("SELECT DATABASE() AS db")) as { db: string }[];
    if (db !== dbName || !db.endsWith("_test")) throw new Error(`Refusing to truncate ${db}`);
    await conn.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) await conn.query(`TRUNCATE TABLE \`${table}\``);
    await conn.query("SET FOREIGN_KEY_CHECKS = 1");
  } finally {
    await conn.release();
  }
  const mongo = await mongoDb();
  if (!mongo.databaseName.endsWith("_test")) throw new Error(`Refusing to clear MongoDB ${mongo.databaseName}`);
  await Promise.all(Object.values(COLLECTIONS).map((c) => mongo.collection(c).deleteMany({})));
}

export const dayIso = (offset: number) => toIsoDate(addDays(businessToday(), offset));
export const daysAgoUtc = (days: number) => new Date(Date.now() - days * 86_400_000);

let counter = 0;
const unique = (prefix: string) => `${prefix}${++counter}${Date.now() % 100000}`;

export async function createUser(role: Role, options: { password?: string; isActive?: boolean; email?: string } = {}) {
  const password = options.password ?? "TestPassword123";
  const user = await prisma.user.create({
    data: {
      name: `${role === "ADMIN" ? "Admin" : "Staff"} ${unique("U")}`,
      email: options.email ?? `${unique("user")}@test.local`,
      role,
      passwordHash: await hashPassword(password),
      isActive: options.isActive ?? true,
    },
  });
  const actor: Actor = { id: user.id, name: user.name, role: user.role };
  return { user, actor, password };
}

export async function createCategory() {
  return prisma.category.create({ data: { name: unique("Category ") } });
}

export async function createMedicine(overrides: Partial<Prisma.MedicineUncheckedCreateInput> = {}) {
  const categoryId = overrides.categoryId ?? (await createCategory()).id;
  return prisma.medicine.create({
    data: {
      name: unique("Medicine "),
      manufacturer: "Test Pharma",
      dosageForm: "TABLET",
      strength: "10 mg",
      unit: "strip",
      reorderLevel: 10,
      ...overrides,
      categoryId,
    },
  });
}

export async function createSupplier(overrides: Partial<Prisma.SupplierCreateInput> = {}) {
  return prisma.supplier.create({
    data: { name: unique("Supplier "), phone: "+91 80 1111 2222", address: "1 Test Road, Bengaluru", ...overrides },
  });
}

export type ReceiveLine = { medicineId: number; batchNumber: string; qty: number; expDays: number; mfgDays?: number; cost?: number };

/** Receives stock today through the real purchase service. */
export async function receive(actor: Actor, supplierId: number, lines: ReceiveLine[], invoice = unique("INV-")) {
  return receivePurchase(actor, {
    idempotencyKey: randomUUID(),
    supplierId,
    invoiceNumber: invoice,
    purchaseDate: dayIso(0),
    notes: null,
    items: lines.map((l) => ({
      medicineId: l.medicineId,
      batchNumber: l.batchNumber,
      manufactureDate: dayIso(l.mfgDays ?? -60),
      expiryDate: dayIso(l.expDays),
      quantity: l.qty,
      unitCost: l.cost ?? 10,
    })),
  });
}

/**
 * Creates a batch that was received `receivedDaysAgo` days ago (back-dated
 * ledger row), e.g. to obtain a batch that has since expired but still
 * holds stock. Goes through the same triggers as normal receipts.
 */
export async function receiveHistoric(
  actor: Actor,
  supplierId: number,
  line: ReceiveLine & { receivedDaysAgo: number },
) {
  const receivedAt = daysAgoUtc(line.receivedDaysAgo);
  const purchase = await prisma.purchase.create({
    data: {
      supplierId,
      invoiceNumber: unique("OLD-"),
      purchaseDate: addDays(businessToday(), -line.receivedDaysAgo),
      receivedById: actor.id,
      idempotencyKey: randomUUID(),
      createdAt: receivedAt,
    },
  });
  const batch = await prisma.medicineBatch.create({
    data: {
      medicineId: line.medicineId,
      batchNumber: line.batchNumber,
      manufactureDate: addDays(businessToday(), line.mfgDays ?? -line.receivedDaysAgo - 30),
      expiryDate: addDays(businessToday(), line.expDays),
      unitCost: new Prisma.Decimal(line.cost ?? 10),
      createdAt: receivedAt,
    },
  });
  const item = await prisma.purchaseItem.create({
    data: { purchaseId: purchase.id, batchId: batch.id, quantity: line.qty, unitCost: new Prisma.Decimal(line.cost ?? 10), createdAt: receivedAt },
  });
  await prisma.stockTransaction.create({
    data: { batchId: batch.id, type: "STOCK_IN", quantity: line.qty, performedById: actor.id, purchaseItemId: item.id, createdAt: receivedAt },
  });
  return { purchase, batch, item };
}

export async function batchQuantity(batchId: number): Promise<number> {
  return (await prisma.medicineBatch.findUniqueOrThrow({ where: { id: batchId } })).quantity;
}

export async function batchByNumber(medicineId: number, batchNumber: string) {
  return prisma.medicineBatch.findUniqueOrThrow({ where: { medicineId_batchNumber: { medicineId, batchNumber } } });
}

export async function reconciliationMismatches(): Promise<number> {
  const [row] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM v_stock_reconciliation WHERE difference <> 0`;
  return Number(row.n);
}

export const uuid = () => randomUUID();
