import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/authz";
import { businessTodayIso, dateOnly, formatDate, toIsoDate } from "@/lib/dates";
import { ConflictError, NotFoundError, ValidationError, databaseRuleMessage, isUniqueViolation } from "@/lib/errors";
import { num } from "@/lib/format";
import type { Actor } from "@/lib/permissions";
import { parseInput } from "@/lib/validation/common";
import { purchaseSchema } from "@/lib/validation/schemas";
import { enqueueAudit, flushOutbox } from "@/server/services/audit.service";
import { runTransaction } from "@/server/services/tx";

export type ReceiptResult = { purchaseId: number; duplicate: boolean; auditDelivered: boolean };

async function existingPurchase(idempotencyKey: string, actor: Actor): Promise<ReceiptResult | null> {
  const purchase = await prisma.purchase.findUnique({ where: { idempotencyKey } });
  if (!purchase) return null;
  if (purchase.receivedById !== actor.id) {
    throw new ConflictError("This receipt form was already submitted by another user. Reload the page.");
  }
  return { purchaseId: purchase.id, duplicate: true, auditDelivered: true };
}

type BatchRow = { id: number; manufacture_date: Date; expiry_date: Date };

/**
 * Records a supplier delivery in ONE transaction:
 *   purchase header -> for each line: find/lock or create the batch,
 *   insert the purchase item, insert the STOCK_IN ledger row (the trigger
 *   adds the quantity to the batch) -> audit event.
 * If any line fails (invalid dates, conflicting batch, DB rule) every row
 * written so far is rolled back and inventory is unchanged.
 */
export async function receivePurchase(actor: Actor, input: unknown): Promise<ReceiptResult> {
  assertCan(actor, "purchase:create");
  const data = parseInput(purchaseSchema, input);
  const duplicate = await existingPurchase(data.idempotencyKey, actor);
  if (duplicate) return duplicate;

  const today = businessTodayIso();
  data.items.forEach((item, index) => {
    if (item.expiryDate <= today) {
      throw new ValidationError("Expired stock cannot be received.", {
        [`items.${index}.expiryDate`]: ["This batch has already expired."],
      });
    }
  });

  let purchaseId: number;
  try {
    purchaseId = await runTransaction(
      async (tx) => {
        const supplier = await tx.supplier.findUnique({ where: { id: data.supplierId } });
        if (!supplier) throw new ValidationError("Supplier not found.", { supplierId: ["Choose a supplier."] });
        if (!supplier.isActive) throw new ValidationError(`${supplier.name} is inactive.`, { supplierId: ["Supplier is inactive."] });

        const medicineIds = [...new Set(data.items.map((i) => i.medicineId))];
        const medicines = await tx.medicine.findMany({ where: { id: { in: medicineIds } } });
        const byId = new Map(medicines.map((m) => [m.id, m]));
        data.items.forEach((item, index) => {
          const medicine = byId.get(item.medicineId);
          if (!medicine) throw new ValidationError("Medicine not found.", { [`items.${index}.medicineId`]: ["Unknown medicine."] });
          if (!medicine.isActive) {
            throw new ValidationError(`${medicine.name} is inactive.`, { [`items.${index}.medicineId`]: ["Medicine is inactive."] });
          }
        });

        const purchase = await tx.purchase.create({
          data: {
            supplierId: supplier.id,
            invoiceNumber: data.invoiceNumber,
            purchaseDate: dateOnly(data.purchaseDate),
            receivedById: actor.id,
            notes: data.notes,
            idempotencyKey: data.idempotencyKey,
          },
        });

        let totalUnits = 0;
        let totalAmount = 0;
        for (const [index, item] of data.items.entries()) {
          const medicine = byId.get(item.medicineId)!;
          const [existing] = await tx.$queryRaw<BatchRow[]>`
            SELECT id, manufacture_date, expiry_date
              FROM medicine_batches
             WHERE medicine_id = ${item.medicineId} AND batch_number = ${item.batchNumber}
               FOR UPDATE`;

          let batchId: number;
          if (existing) {
            if (toIsoDate(existing.manufacture_date) !== item.manufactureDate || toIsoDate(existing.expiry_date) !== item.expiryDate) {
              throw new ValidationError(
                `Batch ${item.batchNumber} of ${medicine.name} is already recorded with manufacturing date ` +
                  `${formatDate(existing.manufacture_date)} and expiry ${formatDate(existing.expiry_date)}.`,
                { [`items.${index}.batchNumber`]: ["Dates do not match the existing batch."] },
              );
            }
            batchId = existing.id;
          } else {
            const batch = await tx.medicineBatch.create({
              data: {
                medicineId: item.medicineId,
                batchNumber: item.batchNumber,
                manufactureDate: dateOnly(item.manufactureDate),
                expiryDate: dateOnly(item.expiryDate),
                unitCost: new Prisma.Decimal(item.unitCost.toFixed(2)),
              },
            });
            batchId = batch.id;
          }

          const purchaseItem = await tx.purchaseItem.create({
            data: {
              purchaseId: purchase.id,
              batchId,
              quantity: item.quantity,
              unitCost: new Prisma.Decimal(item.unitCost.toFixed(2)),
            },
          });
          await tx.stockTransaction.create({
            data: {
              batchId,
              type: "STOCK_IN",
              quantity: item.quantity,
              performedById: actor.id,
              purchaseItemId: purchaseItem.id,
              notes: `Invoice ${data.invoiceNumber}`,
            },
          });
          totalUnits += item.quantity;
          totalAmount += item.quantity * item.unitCost;
        }

        await enqueueAudit(tx, {
          action: "purchase.receive",
          entityType: "purchase",
          entityId: purchase.id,
          summary: `Received invoice ${data.invoiceNumber} from ${supplier.name}: ${data.items.length} line(s), ${totalUnits} units`,
          actor,
          details: { supplierId: supplier.id, invoiceNumber: data.invoiceNumber, lines: data.items.length, totalUnits, totalAmount },
        });
        return purchase.id;
      },
      { retryIf: (e) => isUniqueViolation(e, "uq_batches_medicine_number") },
    );
  } catch (error) {
    if (isUniqueViolation(error, "uq_purchases_idempotency")) {
      const again = await existingPurchase(data.idempotencyKey, actor);
      if (again) return again;
    }
    if (isUniqueViolation(error, "uq_purchases_supplier_invoice")) {
      throw new ConflictError(`Invoice ${data.invoiceNumber} from this supplier has already been received.`);
    }
    const rule = databaseRuleMessage(error);
    if (rule) throw new ValidationError(rule);
    throw error;
  }
  return { purchaseId, duplicate: false, auditDelivered: await flushOutbox() };
}

export type PurchaseFilters = { supplierId?: number; q?: string; from?: string; to?: string; page?: number; pageSize?: number };

type PurchaseSummaryRow = {
  purchase_id: number;
  invoice_number: string;
  purchase_date: Date;
  supplier_id: number;
  supplier_name: string;
  received_by_name: string;
  item_count: bigint;
  total_units: bigint;
  total_amount: Prisma.Decimal;
  created_at: Date;
};

/** Purchase history from the v_purchase_summary view. */
export async function listPurchases(actor: Actor, filters: PurchaseFilters = {}) {
  assertCan(actor, "purchase:view");
  const conditions: Prisma.Sql[] = [Prisma.sql`1 = 1`];
  if (filters.supplierId) conditions.push(Prisma.sql`supplier_id = ${filters.supplierId}`);
  if (filters.q) conditions.push(Prisma.sql`invoice_number LIKE ${`%${filters.q}%`}`);
  if (filters.from) conditions.push(Prisma.sql`purchase_date >= ${dateOnly(filters.from)}`);
  if (filters.to) conditions.push(Prisma.sql`purchase_date <= ${dateOnly(filters.to)}`);
  const where = Prisma.join(conditions, " AND ");
  const pageSize = Math.min(filters.pageSize ?? 20, 100);
  const page = Math.max(filters.page ?? 1, 1);
  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<PurchaseSummaryRow[]>`
      SELECT * FROM v_purchase_summary WHERE ${where}
       ORDER BY purchase_date DESC, purchase_id DESC
       LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    prisma.$queryRaw<{ total: bigint }[]>`SELECT COUNT(*) AS total FROM v_purchase_summary WHERE ${where}`,
  ]);
  return {
    rows: rows.map((r) => ({
      id: r.purchase_id,
      invoiceNumber: r.invoice_number,
      purchaseDate: r.purchase_date,
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      receivedBy: r.received_by_name,
      itemCount: num(r.item_count),
      totalUnits: num(r.total_units),
      totalAmount: num(r.total_amount),
      createdAt: r.created_at,
    })),
    total: num(countRows[0]?.total),
    page,
    pageSize,
  };
}

export async function getPurchase(actor: Actor, id: number) {
  assertCan(actor, "purchase:view");
  const purchase = await prisma.purchase.findUnique({
    where: { id },
    include: {
      supplier: true,
      receivedBy: { select: { id: true, name: true } },
      items: {
        include: {
          batch: { include: { medicine: { select: { id: true, name: true, strength: true, unit: true } } } },
          stockIn: { select: { id: true, balanceAfter: true, createdAt: true } },
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!purchase) throw new NotFoundError("Purchase not found.");
  const totalAmount = purchase.items.reduce((s, i) => s + i.quantity * num(i.unitCost), 0);
  const totalUnits = purchase.items.reduce((s, i) => s + i.quantity, 0);
  return { ...purchase, totalAmount, totalUnits };
}
