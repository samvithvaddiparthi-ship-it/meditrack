import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { mysqlPool, prisma } from "@/lib/db";
import { assertCan } from "@/lib/authz";
import { env } from "@/lib/env";
import { batchStatus, toIsoDate, type BatchStatus } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { num } from "@/lib/format";
import type { Actor } from "@/lib/permissions";

export function expiryWindowDays(requested?: number): number {
  if (requested && Number.isInteger(requested) && requested >= 1 && requested <= 365) return requested;
  return env().EXPIRY_ALERT_DAYS;
}

// ================================================================ batches

export type BatchFilters = {
  q?: string;
  status?: BatchStatus | "ALL";
  medicineId?: number;
  sort?: "expiry" | "medicine" | "quantity" | "received";
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  windowDays?: number;
};

type BatchRow = {
  batch_id: number;
  medicine_id: number;
  medicine_name: string;
  strength: string;
  unit: string;
  category_name: string;
  batch_number: string;
  manufacture_date: Date;
  expiry_date: Date;
  quantity: number;
  unit_cost: Prisma.Decimal;
  stock_value: Prisma.Decimal;
  days_to_expiry: number | bigint;
  status: BatchStatus;
  supplier_name: string | null;
};

function mapBatch(r: BatchRow) {
  return {
    id: r.batch_id,
    medicineId: r.medicine_id,
    medicineName: r.medicine_name,
    strength: r.strength,
    unit: r.unit,
    categoryName: r.category_name,
    batchNumber: r.batch_number,
    manufactureDate: r.manufacture_date,
    expiryDate: r.expiry_date,
    quantity: num(r.quantity),
    unitCost: num(r.unit_cost),
    stockValue: num(r.stock_value),
    daysToExpiry: num(r.days_to_expiry),
    status: r.status,
    supplierName: r.supplier_name,
  };
}

export type BatchView = ReturnType<typeof mapBatch>;

const BATCH_SORT: Record<NonNullable<BatchFilters["sort"]>, string> = {
  expiry: "v.expiry_date",
  medicine: "v.medicine_name",
  quantity: "v.quantity",
  received: "v.batch_id",
};

/** Batch inventory from v_batch_stock; status uses the configured window. */
export async function listBatches(actor: Actor, filters: BatchFilters = {}) {
  assertCan(actor, "batch:view");
  const window = expiryWindowDays(filters.windowDays);
  const conditions: Prisma.Sql[] = [Prisma.sql`1 = 1`];
  if (filters.q) {
    conditions.push(Prisma.sql`(v.medicine_name LIKE ${`%${filters.q}%`} OR v.batch_number LIKE ${`%${filters.q}%`})`);
  }
  if (filters.medicineId) conditions.push(Prisma.sql`v.medicine_id = ${filters.medicineId}`);
  switch (filters.status) {
    case "DEPLETED":
      conditions.push(Prisma.sql`v.quantity = 0`);
      break;
    case "EXPIRED":
      conditions.push(Prisma.sql`v.quantity > 0 AND v.expiry_date <= fn_business_today()`);
      break;
    case "EXPIRING_SOON":
      conditions.push(
        Prisma.sql`v.quantity > 0 AND v.expiry_date > fn_business_today() AND v.expiry_date <= fn_business_today() + INTERVAL ${window} DAY`,
      );
      break;
    case "AVAILABLE":
      conditions.push(Prisma.sql`v.quantity > 0 AND v.expiry_date > fn_business_today() + INTERVAL ${window} DAY`);
      break;
  }
  const where = Prisma.join(conditions, " AND ");
  const orderBy = Prisma.raw(`${BATCH_SORT[filters.sort ?? "expiry"] ?? BATCH_SORT.expiry} ${filters.dir === "desc" ? "DESC" : "ASC"}, v.batch_id ASC`);
  const pageSize = Math.min(filters.pageSize ?? 25, 100);
  const page = Math.max(filters.page ?? 1, 1);
  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<BatchRow[]>`
      SELECT v.batch_id, v.medicine_id, v.medicine_name, v.strength, v.unit, v.category_name, v.batch_number,
             v.manufacture_date, v.expiry_date, v.quantity, v.unit_cost, v.stock_value, v.days_to_expiry,
             fn_batch_status(v.quantity, v.expiry_date, ${window}) AS status, v.supplier_name
        FROM v_batch_stock v
       WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    prisma.$queryRaw<{ total: bigint }[]>`SELECT COUNT(*) AS total FROM v_batch_stock v WHERE ${where}`,
  ]);
  return { rows: rows.map(mapBatch), total: num(countRows[0]?.total), page, pageSize, windowDays: window };
}

export async function getBatch(actor: Actor, id: number) {
  assertCan(actor, "batch:view");
  const batch = await prisma.medicineBatch.findUnique({
    where: { id },
    include: {
      medicine: { include: { category: true } },
      purchaseItems: {
        include: { purchase: { include: { supplier: { select: { id: true, name: true } } } } },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!batch) throw new NotFoundError("Batch not found.");
  const window = expiryWindowDays();
  return { batch, status: batchStatus(batch.quantity, batch.expiryDate, window), windowDays: window };
}

// ================================================================ alerts

export type ExpiryAlert = {
  batchId: number;
  medicineId: number;
  medicineName: string;
  strength: string;
  unit: string;
  categoryName: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
  daysToExpiry: number;
  alertStatus: "EXPIRED" | "EXPIRING_SOON";
  supplierName: string | null;
  stockValue: number;
};

/** Calls the sp_expiring_batches(p_days) stored procedure. */
export async function expiryAlerts(actor: Actor, windowDays?: number) {
  assertCan(actor, "alerts:view");
  const window = expiryWindowDays(windowDays);
  const result = (await mysqlPool().query({ sql: "CALL sp_expiring_batches(?)", dateStrings: true }, [window])) as unknown[];
  const rows = (result[0] as Record<string, unknown>[]).map(
    (r): ExpiryAlert => ({
      batchId: Number(r.batch_id),
      medicineId: Number(r.medicine_id),
      medicineName: String(r.medicine_name),
      strength: String(r.strength),
      unit: String(r.unit),
      categoryName: String(r.category_name),
      batchNumber: String(r.batch_number),
      expiryDate: toIsoDate(String(r.expiry_date)),
      quantity: Number(r.quantity),
      daysToExpiry: Number(r.days_to_expiry),
      alertStatus: r.alert_status === "EXPIRED" ? "EXPIRED" : "EXPIRING_SOON",
      supplierName: r.supplier_name === null ? null : String(r.supplier_name),
      stockValue: num(r.stock_value),
    }),
  );
  return {
    windowDays: window,
    expired: rows.filter((r) => r.alertStatus === "EXPIRED"),
    expiringSoon: rows.filter((r) => r.alertStatus === "EXPIRING_SOON"),
  };
}

type LowStockRow = {
  medicine_id: number;
  medicine_name: string;
  strength: string;
  unit: string;
  category_name: string;
  reorder_level: number;
  usable_quantity: bigint;
  expired_quantity: bigint;
  next_expiry: Date | null;
  shortfall: bigint | number;
};

/** Active medicines whose usable (unexpired) stock <= reorder level (v_low_stock_medicines). */
export async function lowStockAlerts(actor: Actor) {
  assertCan(actor, "alerts:view");
  const rows = await prisma.$queryRaw<LowStockRow[]>`
    SELECT medicine_id, medicine_name, strength, unit, category_name, reorder_level,
           usable_quantity, expired_quantity, next_expiry, shortfall
      FROM v_low_stock_medicines
     ORDER BY usable_quantity = 0 DESC, shortfall DESC, medicine_name`;
  const lastSuppliers = await latestSupplierByMedicine(rows.map((r) => r.medicine_id));
  return rows.map((r) => ({
    medicineId: r.medicine_id,
    medicineName: r.medicine_name,
    strength: r.strength,
    unit: r.unit,
    categoryName: r.category_name,
    reorderLevel: r.reorder_level,
    usableQuantity: num(r.usable_quantity),
    expiredQuantity: num(r.expired_quantity),
    nextExpiry: r.next_expiry,
    shortfall: num(r.shortfall),
    outOfStock: num(r.usable_quantity) === 0,
    lastSupplier: lastSuppliers.get(r.medicine_id) ?? null,
  }));
}

/** Most recent supplier for each medicine (correlated subquery). */
async function latestSupplierByMedicine(medicineIds: number[]): Promise<Map<number, string>> {
  if (medicineIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ medicine_id: number; supplier_name: string | null }[]>`
    SELECT m.id AS medicine_id,
           (SELECT s.name
              FROM purchase_items pi
              JOIN medicine_batches b ON b.id = pi.batch_id
              JOIN purchases p        ON p.id = pi.purchase_id
              JOIN suppliers s        ON s.id = p.supplier_id
             WHERE b.medicine_id = m.id
             ORDER BY p.purchase_date DESC, pi.id DESC
             LIMIT 1) AS supplier_name
      FROM medicines m
     WHERE m.id IN (${Prisma.join(medicineIds)})`;
  return new Map(rows.filter((r) => r.supplier_name).map((r) => [r.medicine_id, r.supplier_name as string]));
}

/** Depleted batches and recent waste / damage write-offs. */
export async function depletionAndWaste(actor: Actor, days = 90) {
  assertCan(actor, "alerts:view");
  const [depletedBatches, wasteByReason, recentWaste] = await Promise.all([
    prisma.$queryRaw<{ batch_id: number; medicine_id: number; medicine_name: string; strength: string; batch_number: string; expiry_date: Date; last_movement: Date | null }[]>`
      SELECT v.batch_id, v.medicine_id, v.medicine_name, v.strength, v.batch_number, v.expiry_date,
             (SELECT MAX(t.created_at) FROM stock_transactions t WHERE t.batch_id = v.batch_id) AS last_movement
        FROM v_batch_stock v
       WHERE v.quantity = 0
       ORDER BY last_movement DESC
       LIMIT 50`,
    prisma.$queryRaw<{ reason: string; operations: bigint; units: Prisma.Decimal; value: Prisma.Decimal }[]>`
      SELECT o.reason, COUNT(DISTINCT o.id) AS operations, SUM(t.quantity) AS units, SUM(t.quantity * b.unit_cost) AS value
        FROM stock_operations o
        JOIN stock_transactions t ON t.operation_id = o.id
        JOIN medicine_batches b   ON b.id = t.batch_id
       WHERE o.type = 'WASTE' AND o.created_at >= UTC_TIMESTAMP() - INTERVAL ${days} DAY
       GROUP BY o.reason
       ORDER BY units DESC`,
    prisma.stockTransaction.findMany({
      where: { type: "WASTE" },
      include: {
        batch: { include: { medicine: { select: { id: true, name: true, strength: true, unit: true } } } },
        operation: { select: { id: true, reason: true } },
        performedBy: { select: { name: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 15,
    }),
  ]);
  return {
    days,
    depletedBatches: depletedBatches.map((d) => ({
      batchId: d.batch_id,
      medicineId: d.medicine_id,
      medicineName: `${d.medicine_name} ${d.strength}`,
      batchNumber: d.batch_number,
      expiryDate: d.expiry_date,
      lastMovement: d.last_movement,
    })),
    wasteByReason: wasteByReason.map((w) => ({ reason: w.reason, operations: num(w.operations), units: num(w.units), value: num(w.value) })),
    recentWaste,
  };
}

// ================================================================ dashboard

export async function dashboardMetrics(actor: Actor) {
  assertCan(actor, "dashboard:view");
  const window = expiryWindowDays();
  const [counts] = await prisma.$queryRaw<
    {
      active_medicines: bigint;
      total_units: Prisma.Decimal | null;
      usable_units: Prisma.Decimal | null;
      low_stock: bigint;
      out_of_stock: bigint;
      expired_batches: bigint;
      expiring_batches: bigint;
      reconciliation_issues: bigint;
    }[]
  >`
    SELECT
      (SELECT COUNT(*) FROM medicines WHERE is_active = TRUE)                                   AS active_medicines,
      (SELECT SUM(quantity) FROM medicine_batches)                                              AS total_units,
      (SELECT SUM(quantity) FROM medicine_batches WHERE expiry_date > fn_business_today())      AS usable_units,
      (SELECT COUNT(*) FROM v_low_stock_medicines)                                              AS low_stock,
      (SELECT COUNT(*) FROM v_low_stock_medicines WHERE usable_quantity = 0)                    AS out_of_stock,
      (SELECT COUNT(*) FROM medicine_batches WHERE quantity > 0 AND expiry_date <= fn_business_today()) AS expired_batches,
      (SELECT COUNT(*) FROM medicine_batches
        WHERE quantity > 0 AND expiry_date > fn_business_today()
          AND expiry_date <= fn_business_today() + INTERVAL ${window} DAY)                     AS expiring_batches,
      (SELECT COUNT(*) FROM v_stock_reconciliation WHERE difference <> 0)                      AS reconciliation_issues`;

  const [recentMovements, recentPurchases, movementTrend] = await Promise.all([
    prisma.stockTransaction.findMany({
      include: {
        batch: { include: { medicine: { select: { id: true, name: true, strength: true, unit: true } } } },
        performedBy: { select: { name: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 8,
    }),
    prisma.$queryRaw<{ purchase_id: number; invoice_number: string; purchase_date: Date; supplier_name: string; total_units: bigint; total_amount: Prisma.Decimal }[]>`
      SELECT purchase_id, invoice_number, purchase_date, supplier_name, total_units, total_amount
        FROM v_purchase_summary ORDER BY purchase_date DESC, purchase_id DESC LIMIT 5`,
    prisma.$queryRaw<{ day: Date; units_in: Prisma.Decimal; units_out: Prisma.Decimal }[]>`
      SELECT fn_business_date(created_at) AS day,
             SUM(CASE WHEN type IN ('STOCK_IN', 'ADJUSTMENT_IN') THEN quantity ELSE 0 END) AS units_in,
             SUM(CASE WHEN type IN ('STOCK_OUT', 'WASTE', 'ADJUSTMENT_OUT') THEN quantity ELSE 0 END) AS units_out
        FROM stock_transactions
       WHERE created_at >= UTC_TIMESTAMP() - INTERVAL 14 DAY
       GROUP BY day
       ORDER BY day`,
  ]);

  return {
    windowDays: window,
    activeMedicines: num(counts.active_medicines),
    totalUnits: num(counts.total_units),
    usableUnits: num(counts.usable_units),
    lowStock: num(counts.low_stock),
    outOfStock: num(counts.out_of_stock),
    expiredBatches: num(counts.expired_batches),
    expiringBatches: num(counts.expiring_batches),
    reconciliationIssues: num(counts.reconciliation_issues),
    recentMovements,
    recentPurchases: recentPurchases.map((p) => ({
      id: p.purchase_id,
      invoiceNumber: p.invoice_number,
      purchaseDate: p.purchase_date,
      supplierName: p.supplier_name,
      totalUnits: num(p.total_units),
      totalAmount: num(p.total_amount),
    })),
    movementTrend: movementTrend.map((d) => ({ day: toIsoDate(d.day), unitsIn: num(d.units_in), unitsOut: num(d.units_out) })),
  };
}

// ================================================================ reports

/**
 * Inventory reports. Each query demonstrates a different SQL feature
 * (GROUP BY / HAVING / subqueries / NOT EXISTS / derived tables) and is
 * shown in the Reports page together with its purpose.
 */
export async function inventoryReports(actor: Actor) {
  assertCan(actor, "reports:view");
  const financial = actor.role === "ADMIN";

  const [byCategory, monthlyMovements, topIssued, supplierTotals, wasteByMedicine, neverIssued, reconciliation] = await Promise.all([
    // GROUP BY with aggregates over a view.
    prisma.$queryRaw<{ category_name: string; medicines: bigint; usable_units: Prisma.Decimal; expired_units: Prisma.Decimal; usable_value: Prisma.Decimal }[]>`
      SELECT category_name,
             COUNT(*)              AS medicines,
             SUM(usable_quantity)  AS usable_units,
             SUM(expired_quantity) AS expired_units,
             SUM(usable_value)     AS usable_value
        FROM v_inventory_summary
       WHERE is_active = TRUE
       GROUP BY category_name
       ORDER BY usable_value DESC`,
    // Monthly in / out movement totals (last 6 months).
    prisma.$queryRaw<{ month: string; units_in: Prisma.Decimal; units_out: Prisma.Decimal; units_wasted: Prisma.Decimal }[]>`
      SELECT DATE_FORMAT(fn_business_date(created_at), '%Y-%m') AS month,
             SUM(CASE WHEN type IN ('STOCK_IN', 'ADJUSTMENT_IN') THEN quantity ELSE 0 END) AS units_in,
             SUM(CASE WHEN type IN ('STOCK_OUT', 'ADJUSTMENT_OUT') THEN quantity ELSE 0 END) AS units_out,
             SUM(CASE WHEN type = 'WASTE' THEN quantity ELSE 0 END) AS units_wasted
        FROM stock_transactions
       WHERE created_at >= UTC_TIMESTAMP() - INTERVAL 6 MONTH
       GROUP BY month
       ORDER BY month`,
    // JOIN + GROUP BY + ORDER BY ... LIMIT: most issued medicines in 90 days.
    prisma.$queryRaw<{ medicine_id: number; medicine_name: string; strength: string; unit: string; units_issued: Prisma.Decimal; issues: bigint }[]>`
      SELECT m.id AS medicine_id, m.name AS medicine_name, m.strength, m.unit,
             SUM(t.quantity) AS units_issued, COUNT(DISTINCT t.operation_id) AS issues
        FROM stock_transactions t
        JOIN medicine_batches b ON b.id = t.batch_id
        JOIN medicines m        ON m.id = b.medicine_id
       WHERE t.type = 'STOCK_OUT' AND t.created_at >= UTC_TIMESTAMP() - INTERVAL 90 DAY
       GROUP BY m.id, m.name, m.strength, m.unit
       ORDER BY units_issued DESC
       LIMIT 10`,
    // HAVING with a scalar subquery: suppliers above the average spend.
    prisma.$queryRaw<{ supplier_id: number; supplier_name: string; purchases: bigint; total_units: Prisma.Decimal; total_amount: Prisma.Decimal; above_average: number | bigint }[]>`
      SELECT supplier_id, supplier_name,
             COUNT(*)          AS purchases,
             SUM(total_units)  AS total_units,
             SUM(total_amount) AS total_amount,
             SUM(total_amount) > (SELECT AVG(t.amount)
                                    FROM (SELECT SUM(total_amount) AS amount
                                            FROM v_purchase_summary GROUP BY supplier_id) t) AS above_average
        FROM v_purchase_summary
       GROUP BY supplier_id, supplier_name
      HAVING COUNT(*) >= 1
       ORDER BY total_amount DESC`,
    // Waste by medicine, only medicines with waste (HAVING SUM > 0).
    prisma.$queryRaw<{ medicine_name: string; strength: string; units: Prisma.Decimal; value: Prisma.Decimal }[]>`
      SELECT m.name AS medicine_name, m.strength,
             SUM(t.quantity) AS units, SUM(t.quantity * b.unit_cost) AS value
        FROM medicines m
        JOIN medicine_batches b   ON b.medicine_id = m.id
        JOIN stock_transactions t ON t.batch_id = b.id AND t.type = 'WASTE'
       GROUP BY m.id, m.name, m.strength
      HAVING SUM(t.quantity) > 0
       ORDER BY value DESC`,
    // NOT EXISTS subquery: stocked medicines not issued in the last 60 days.
    prisma.$queryRaw<{ medicine_id: number; medicine_name: string; strength: string; usable_quantity: bigint }[]>`
      SELECT s.medicine_id, s.medicine_name, s.strength, s.usable_quantity
        FROM v_inventory_summary s
       WHERE s.is_active = TRUE
         AND s.usable_quantity > 0
         AND NOT EXISTS (SELECT 1
                           FROM stock_transactions t
                           JOIN medicine_batches b ON b.id = t.batch_id
                          WHERE b.medicine_id = s.medicine_id
                            AND t.type = 'STOCK_OUT'
                            AND t.created_at >= UTC_TIMESTAMP() - INTERVAL 60 DAY)
       ORDER BY s.usable_quantity DESC`,
    prisma.$queryRaw<{ batches: bigint; mismatched: Prisma.Decimal | null }[]>`
      SELECT COUNT(*) AS batches, SUM(difference <> 0) AS mismatched FROM v_stock_reconciliation`,
  ]);

  return {
    financial,
    byCategory: byCategory.map((r) => ({
      category: r.category_name,
      medicines: num(r.medicines),
      usableUnits: num(r.usable_units),
      expiredUnits: num(r.expired_units),
      usableValue: financial ? num(r.usable_value) : null,
    })),
    monthlyMovements: monthlyMovements.map((r) => ({ month: r.month, unitsIn: num(r.units_in), unitsOut: num(r.units_out), unitsWasted: num(r.units_wasted) })),
    topIssued: topIssued.map((r) => ({ medicineId: r.medicine_id, name: `${r.medicine_name} ${r.strength}`, unit: r.unit, unitsIssued: num(r.units_issued), issues: num(r.issues) })),
    supplierTotals: supplierTotals.map((r) => ({
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      purchases: num(r.purchases),
      totalUnits: num(r.total_units),
      totalAmount: financial ? num(r.total_amount) : null,
      aboveAverage: Boolean(num(r.above_average)),
    })),
    wasteByMedicine: wasteByMedicine.map((r) => ({ name: `${r.medicine_name} ${r.strength}`, units: num(r.units), value: financial ? num(r.value) : null })),
    neverIssued: neverIssued.map((r) => ({ medicineId: r.medicine_id, name: `${r.medicine_name} ${r.strength}`, usableQuantity: num(r.usable_quantity) })),
    reconciliation: { batches: num(reconciliation[0]?.batches), mismatched: num(reconciliation[0]?.mismatched) },
  };
}
