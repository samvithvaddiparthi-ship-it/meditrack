import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { MovementType, OperationType } from "@/generated/prisma/enums";
import { mysqlPool, prisma, type Tx } from "@/lib/db";
import { assertCan } from "@/lib/authz";
import { businessTodayIso, dateOnly, toIsoDate } from "@/lib/dates";
import { ConflictError, NotFoundError, ValidationError, isUniqueViolation, databaseRuleMessage } from "@/lib/errors";
import { allocateFefo, type FefoCandidate, type FefoPlan } from "@/lib/fefo";
import type { Actor } from "@/lib/permissions";
import { parseInput } from "@/lib/validation/common";
import { adjustmentSchema, fefoPreviewSchema, issueSchema, wasteSchema, writeOffExpiredSchema } from "@/lib/validation/schemas";
import { enqueueAudit, flushOutbox } from "@/server/services/audit.service";
import { runTransaction } from "@/server/services/tx";

export type OperationResult = {
  operationId: number;
  duplicate: boolean;
  auditDelivered: boolean;
  movements: { batchId: number; batchNumber: string; expiryDate: string; quantity: number; balanceAfter: number }[];
};

const IDEMPOTENCY_INDEX = "uq_operations_idempotency";

/** Rows of a previously committed operation (used for duplicate submissions). */
async function existingOperation(idempotencyKey: string, actor: Actor): Promise<OperationResult | null> {
  const op = await prisma.stockOperation.findUnique({
    where: { idempotencyKey },
    include: { transactions: { include: { batch: true }, orderBy: { id: "asc" } } },
  });
  if (!op) return null;
  if (op.performedById !== actor.id) {
    throw new ConflictError("This form was already submitted by another user. Reload the page and try again.");
  }
  return {
    operationId: op.id,
    duplicate: true,
    auditDelivered: true,
    movements: op.transactions.map((t) => ({
      batchId: t.batchId,
      batchNumber: t.batch.batchNumber,
      expiryDate: toIsoDate(t.batch.expiryDate),
      quantity: t.quantity,
      balanceAfter: t.balanceAfter,
    })),
  };
}

/** Wraps a DB rule violation raised by the ledger trigger as a ValidationError. */
function asValidation(error: unknown): never {
  const rule = databaseRuleMessage(error);
  if (rule) throw new ValidationError(rule);
  throw error;
}

type LockedBatch = { id: number; batch_number: string; expiry_date: Date; quantity: number };

/** Locks the medicine's eligible batches in FEFO order (SELECT ... FOR UPDATE). */
async function lockEligibleBatches(tx: Tx, medicineId: number): Promise<FefoCandidate[]> {
  const rows = await tx.$queryRaw<LockedBatch[]>`
    SELECT id, batch_number, expiry_date, quantity
      FROM medicine_batches
     WHERE medicine_id = ${medicineId}
       AND quantity > 0
       AND expiry_date > fn_business_today()
     ORDER BY expiry_date ASC, id ASC
       FOR UPDATE`;
  return rows.map((r) => ({
    batchId: r.id,
    batchNumber: r.batch_number,
    expiryDate: toIsoDate(r.expiry_date),
    quantity: Number(r.quantity),
  }));
}

/** Read-only FEFO plan shown before the user confirms an issue. */
export async function previewIssue(actor: Actor, input: unknown): Promise<FefoPlan & { unit: string; medicineName: string }> {
  assertCan(actor, "stock:issue");
  const { medicineId, quantity } = parseInput(fefoPreviewSchema, input);
  const medicine = await prisma.medicine.findUnique({ where: { id: medicineId } });
  if (!medicine) throw new NotFoundError("Medicine not found.");
  const batches = await prisma.medicineBatch.findMany({
    where: { medicineId, quantity: { gt: 0 } },
    select: { id: true, batchNumber: true, expiryDate: true, quantity: true },
  });
  const plan = allocateFefo(
    batches.map((b) => ({ batchId: b.id, batchNumber: b.batchNumber, expiryDate: toIsoDate(b.expiryDate), quantity: b.quantity })),
    quantity,
    businessTodayIso(),
  );
  return { ...plan, unit: medicine.unit, medicineName: medicine.name };
}

/**
 * Issues stock using FEFO across as many batches as needed, atomically.
 * Eligible batches are locked first, so two concurrent issues cannot both
 * consume the same units; if stock is insufficient nothing is written.
 */
export async function issueStock(actor: Actor, input: unknown): Promise<OperationResult> {
  assertCan(actor, "stock:issue");
  const data = parseInput(issueSchema, input);
  const duplicate = await existingOperation(data.idempotencyKey, actor);
  if (duplicate) return duplicate;

  let result: Omit<OperationResult, "auditDelivered" | "duplicate">;
  try {
    result = await runTransaction(async (tx) => {
      const medicine = await tx.medicine.findUnique({ where: { id: data.medicineId } });
      if (!medicine) throw new NotFoundError("Medicine not found.");
      if (!medicine.isActive) throw new ValidationError(`${medicine.name} is inactive and cannot be issued.`);

      const candidates = await lockEligibleBatches(tx, medicine.id);
      const plan = allocateFefo(candidates, data.quantity, businessTodayIso());
      if (plan.shortfall > 0) {
        throw new ValidationError(
          `Only ${plan.available} ${medicine.unit}(s) of ${medicine.name} are available in unexpired batches; ${data.quantity} requested.`,
          { quantity: [`Maximum available: ${plan.available}`] },
        );
      }

      const operation = await tx.stockOperation.create({
        data: {
          type: "ISSUE",
          idempotencyKey: data.idempotencyKey,
          performedById: actor.id,
          destination: data.destination,
          notes: data.notes,
        },
      });

      const movements: OperationResult["movements"] = [];
      for (const allocation of plan.allocations) {
        const txn = await tx.stockTransaction.create({
          data: {
            batchId: allocation.batchId,
            type: "STOCK_OUT",
            quantity: allocation.take,
            performedById: actor.id,
            operationId: operation.id,
            notes: data.notes,
          },
        });
        movements.push({
          batchId: allocation.batchId,
          batchNumber: allocation.batchNumber,
          expiryDate: allocation.expiryDate,
          quantity: allocation.take,
          balanceAfter: txn.balanceAfter,
        });
      }

      await enqueueAudit(tx, {
        action: "stock.issue",
        entityType: "stock_operation",
        entityId: operation.id,
        summary: `Issued ${data.quantity} ${medicine.unit}(s) of ${medicine.name} to ${data.destination}`,
        actor,
        details: { medicineId: medicine.id, quantity: data.quantity, destination: data.destination, batches: movements },
      });
      return { operationId: operation.id, movements };
    });
  } catch (error) {
    if (isUniqueViolation(error, IDEMPOTENCY_INDEX)) {
      const again = await existingOperation(data.idempotencyKey, actor);
      if (again) return again;
    }
    asValidation(error);
  }
  return { ...result, duplicate: false, auditDelivered: await flushOutbox() };
}

async function singleBatchOperation(
  actor: Actor,
  args: {
    idempotencyKey: string;
    batchId: number;
    quantity: number;
    operationType: OperationType;
    movementType: MovementType;
    reason: "EXPIRED" | "DAMAGED" | "RECALLED" | "CONTAMINATED" | "COUNT_CORRECTION" | "OTHER";
    notes: string | null;
    auditAction: string;
    validate?: (batch: { expiryDate: Date; quantity: number; batchNumber: string }) => void;
    describe: (medicineName: string, unit: string, batchNumber: string) => string;
  },
): Promise<OperationResult> {
  const duplicate = await existingOperation(args.idempotencyKey, actor);
  if (duplicate) return duplicate;

  let result: Omit<OperationResult, "auditDelivered" | "duplicate">;
  try {
    result = await runTransaction(async (tx) => {
      const batch = await tx.medicineBatch.findUnique({ where: { id: args.batchId }, include: { medicine: true } });
      if (!batch) throw new NotFoundError("Batch not found.");
      args.validate?.(batch);

      const operation = await tx.stockOperation.create({
        data: {
          type: args.operationType,
          idempotencyKey: args.idempotencyKey,
          performedById: actor.id,
          reason: args.reason,
          notes: args.notes,
        },
      });
      const txn = await tx.stockTransaction.create({
        data: {
          batchId: batch.id,
          type: args.movementType,
          quantity: args.quantity,
          performedById: actor.id,
          operationId: operation.id,
          notes: args.notes,
        },
      });
      const summary = args.describe(batch.medicine.name, batch.medicine.unit, batch.batchNumber);
      await enqueueAudit(tx, {
        action: args.auditAction,
        entityType: "stock_operation",
        entityId: operation.id,
        summary,
        actor,
        details: { batchId: batch.id, medicineId: batch.medicineId, quantity: args.quantity, reason: args.reason, balanceAfter: txn.balanceAfter },
      });
      return {
        operationId: operation.id,
        movements: [
          {
            batchId: batch.id,
            batchNumber: batch.batchNumber,
            expiryDate: toIsoDate(batch.expiryDate),
            quantity: args.quantity,
            balanceAfter: txn.balanceAfter,
          },
        ],
      };
    });
  } catch (error) {
    if (isUniqueViolation(error, IDEMPOTENCY_INDEX)) {
      const again = await existingOperation(args.idempotencyKey, actor);
      if (again) return again;
    }
    asValidation(error);
  }
  return { ...result, duplicate: false, auditDelivered: await flushOutbox() };
}

/** Writes off expired / damaged / recalled stock from one batch. */
export async function recordWaste(actor: Actor, input: unknown): Promise<OperationResult> {
  assertCan(actor, "stock:waste");
  const data = parseInput(wasteSchema, input);
  return singleBatchOperation(actor, {
    idempotencyKey: data.idempotencyKey,
    batchId: data.batchId,
    quantity: data.quantity,
    operationType: "WASTE",
    movementType: "WASTE",
    reason: data.reason,
    notes: data.notes,
    auditAction: "stock.waste",
    validate: (batch) => {
      if (data.reason === "EXPIRED" && toIsoDate(batch.expiryDate) > businessTodayIso()) {
        throw new ValidationError("This batch has not expired yet; choose a different reason.", {
          reason: ["Batch is not expired."],
        });
      }
    },
    describe: (name, unit, batchNumber) =>
      `Recorded ${data.quantity} ${unit}(s) of ${name} (batch ${batchNumber}) as waste: ${data.reason.toLowerCase()}`,
  });
}

/**
 * Stock count corrections. Decreases may be recorded by staff; increases
 * create stock without a purchase, so they require stock:adjust-in (admin).
 */
export async function recordAdjustment(actor: Actor, input: unknown): Promise<OperationResult> {
  const data = parseInput(adjustmentSchema, input);
  assertCan(actor, data.direction === "IN" ? "stock:adjust-in" : "stock:adjust-out");
  return singleBatchOperation(actor, {
    idempotencyKey: data.idempotencyKey,
    batchId: data.batchId,
    quantity: data.quantity,
    operationType: "ADJUSTMENT",
    movementType: data.direction === "IN" ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
    reason: data.reason,
    notes: data.notes,
    auditAction: data.direction === "IN" ? "stock.adjust_in" : "stock.adjust_out",
    describe: (name, unit, batchNumber) =>
      `Adjusted ${name} (batch ${batchNumber}) ${data.direction === "IN" ? "+" : "-"}${data.quantity} ${unit}(s): ${data.reason.toLowerCase().replace(/_/g, " ")}`,
  });
}

export type WriteOffResult = { operationId: number | null; batchCount: number; unitCount: number; auditDelivered: boolean };

/**
 * Calls the sp_write_off_expired stored procedure, which writes off every
 * expired batch in its own transaction (all-or-nothing).
 */
export async function writeOffExpired(actor: Actor, input: unknown): Promise<WriteOffResult> {
  assertCan(actor, "stock:write-off-expired");
  const { idempotencyKey } = parseInput(writeOffExpiredSchema, input);
  const existing = await prisma.stockOperation.findUnique({ where: { idempotencyKey }, include: { transactions: true } });
  if (existing) {
    return {
      operationId: existing.id,
      batchCount: existing.transactions.length,
      unitCount: existing.transactions.reduce((s, t) => s + t.quantity, 0),
      auditDelivered: true,
    };
  }
  const conn = await mysqlPool().getConnection();
  try {
    const result = (await conn.query({ sql: "CALL sp_write_off_expired(?, ?)", dateStrings: true }, [actor.id, idempotencyKey])) as unknown[];
    const row = (result[0] as Record<string, unknown>[])[0] ?? {};
    return {
      operationId: row.operation_id === null || row.operation_id === undefined ? null : Number(row.operation_id),
      batchCount: Number(row.batch_count ?? 0),
      unitCount: Number(row.unit_count ?? 0),
      auditDelivered: await flushOutbox(),
    };
  } catch (error) {
    const rule = databaseRuleMessage(error);
    if (rule) throw new ValidationError(rule);
    if ((error as { errno?: number }).errno === 1062) {
      throw new ConflictError("This write-off was already submitted. Reload the page to see the result.");
    }
    throw error;
  } finally {
    await conn.release();
  }
}

// ------------------------------------------------------------------ ledger

export type LedgerFilters = {
  type?: MovementType;
  medicineId?: number;
  batchId?: number;
  operationId?: number;
  userId?: number;
  from?: string; // YYYY-MM-DD business date
  to?: string;
  page?: number;
  pageSize?: number;
};

const IST_OFFSET_MS = 330 * 60_000;

/** UTC instant at which a business (IST) calendar day starts. */
export function businessDayStartUtc(iso: string): Date {
  return new Date(dateOnly(iso).getTime() - IST_OFFSET_MS);
}

export async function listTransactions(actor: Actor, filters: LedgerFilters = {}) {
  assertCan(actor, "ledger:view");
  const where: Prisma.StockTransactionWhereInput = {};
  if (filters.type) where.type = filters.type;
  if (filters.batchId) where.batchId = filters.batchId;
  if (filters.operationId) where.operationId = filters.operationId;
  if (filters.userId) where.performedById = filters.userId;
  if (filters.medicineId) where.batch = { medicineId: filters.medicineId };
  if (filters.from || filters.to) {
    where.createdAt = {};
    if (filters.from) where.createdAt.gte = businessDayStartUtc(filters.from);
    if (filters.to) where.createdAt.lt = new Date(businessDayStartUtc(filters.to).getTime() + 86_400_000);
  }
  const pageSize = Math.min(filters.pageSize ?? 25, 100);
  const page = Math.max(filters.page ?? 1, 1);
  const [rows, total] = await Promise.all([
    prisma.stockTransaction.findMany({
      where,
      include: {
        batch: { include: { medicine: { select: { id: true, name: true, strength: true, unit: true } } } },
        performedBy: { select: { id: true, name: true } },
        operation: { select: { id: true, type: true, destination: true, reason: true } },
        purchaseItem: { select: { purchaseId: true, purchase: { select: { invoiceNumber: true } } } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.stockTransaction.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

export async function getOperation(actor: Actor, id: number) {
  assertCan(actor, "ledger:view");
  const operation = await prisma.stockOperation.findUnique({
    where: { id },
    include: {
      performedBy: { select: { id: true, name: true, role: true } },
      transactions: {
        include: { batch: { include: { medicine: { select: { id: true, name: true, strength: true, unit: true } } } } },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!operation) throw new NotFoundError("Stock operation not found.");
  return operation;
}

/** Batches that can be written off / adjusted, for form pickers. */
export async function listBatchesForAdjustment(actor: Actor) {
  assertCan(actor, "stock:waste");
  const batches = await prisma.medicineBatch.findMany({
    where: { quantity: { gt: 0 } },
    include: { medicine: { select: { id: true, name: true, strength: true, unit: true } } },
    orderBy: [{ medicine: { name: "asc" } }, { expiryDate: "asc" }],
  });
  return batches.map((b) => ({
    id: b.id,
    label: `${b.medicine.name} ${b.medicine.strength} — ${b.batchNumber}`,
    medicineName: b.medicine.name,
    batchNumber: b.batchNumber,
    expiryDate: toIsoDate(b.expiryDate),
    quantity: b.quantity,
    unit: b.medicine.unit,
  }));
}

/** Medicines that currently have unexpired stock (issue form picker). */
export async function listIssuableMedicines(actor: Actor) {
  assertCan(actor, "stock:issue");
  const rows = await prisma.$queryRaw<
    { medicine_id: number; medicine_name: string; strength: string; unit: string; usable_quantity: bigint | number }[]
  >`SELECT medicine_id, medicine_name, strength, unit, usable_quantity
      FROM v_inventory_summary
     WHERE is_active = TRUE
     ORDER BY medicine_name, strength`;
  return rows.map((r) => ({
    id: r.medicine_id,
    label: `${r.medicine_name} ${r.strength}`,
    unit: r.unit,
    available: Number(r.usable_quantity),
  }));
}
