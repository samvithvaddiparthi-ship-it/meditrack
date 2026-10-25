import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/authz";
import { ConflictError, NotFoundError, ValidationError, isForeignKeyViolation, isUniqueViolation } from "@/lib/errors";
import { num } from "@/lib/format";
import type { Actor } from "@/lib/permissions";
import { parseInput } from "@/lib/validation/common";
import { categorySchema, medicineSchema, supplierSchema } from "@/lib/validation/schemas";
import { enqueueAudit, flushOutbox } from "@/server/services/audit.service";
import { runTransaction } from "@/server/services/tx";

// ================================================================ categories

export async function listCategories() {
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { medicines: true } } },
  });
  return categories.map((c) => ({ id: c.id, name: c.name, description: c.description, medicineCount: c._count.medicines }));
}

export async function createCategory(actor: Actor, input: unknown) {
  assertCan(actor, "category:manage");
  const data = parseInput(categorySchema, input);
  try {
    const category = await runTransaction(async (tx) => {
      const created = await tx.category.create({ data });
      await enqueueAudit(tx, { action: "category.create", entityType: "category", entityId: created.id, summary: `Created category ${created.name}`, actor });
      return created;
    });
    await flushOutbox();
    return category;
  } catch (error) {
    if (isUniqueViolation(error, "uq_categories_name")) {
      throw new ValidationError("A category with this name already exists.", { name: ["Already exists."] });
    }
    throw error;
  }
}

export async function updateCategory(actor: Actor, id: number, input: unknown) {
  assertCan(actor, "category:manage");
  const data = parseInput(categorySchema, input);
  try {
    const category = await runTransaction(async (tx) => {
      const updated = await tx.category.update({ where: { id }, data });
      await enqueueAudit(tx, { action: "category.update", entityType: "category", entityId: id, summary: `Updated category ${updated.name}`, actor });
      return updated;
    });
    await flushOutbox();
    return category;
  } catch (error) {
    if (isUniqueViolation(error, "uq_categories_name")) {
      throw new ValidationError("A category with this name already exists.", { name: ["Already exists."] });
    }
    if ((error as { code?: string }).code === "P2025") throw new NotFoundError("Category not found.");
    throw error;
  }
}

/** Deletes an unused category; the FK (ON DELETE RESTRICT) protects used ones. */
export async function deleteCategory(actor: Actor, id: number) {
  assertCan(actor, "category:manage");
  try {
    await runTransaction(async (tx) => {
      const deleted = await tx.category.delete({ where: { id } });
      await enqueueAudit(tx, { action: "category.delete", entityType: "category", entityId: id, summary: `Deleted category ${deleted.name}`, actor });
    });
    await flushOutbox();
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new ConflictError("This category still has medicines and cannot be deleted.");
    }
    if ((error as { code?: string }).code === "P2025") throw new NotFoundError("Category not found.");
    throw error;
  }
}

// ================================================================ medicines

export type MedicineSort = "name" | "stock" | "reorder" | "expiry" | "updated";
export type MedicineFilters = {
  q?: string;
  categoryId?: number;
  status?: "active" | "inactive" | "all";
  stock?: "low" | "out" | "all";
  sort?: MedicineSort;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

type SummaryRow = {
  medicine_id: number;
  medicine_name: string;
  generic_name: string | null;
  strength: string;
  dosage_form: string;
  unit: string;
  manufacturer: string;
  category_id: number;
  category_name: string;
  reorder_level: number;
  is_active: number | boolean;
  batch_count: bigint;
  total_quantity: bigint;
  usable_quantity: bigint;
  expired_quantity: bigint;
  next_expiry: Date | null;
  usable_value: Prisma.Decimal;
};

function mapSummary(r: SummaryRow) {
  const usable = num(r.usable_quantity);
  return {
    id: r.medicine_id,
    name: r.medicine_name,
    genericName: r.generic_name,
    strength: r.strength,
    dosageForm: r.dosage_form,
    unit: r.unit,
    manufacturer: r.manufacturer,
    categoryId: r.category_id,
    categoryName: r.category_name,
    reorderLevel: r.reorder_level,
    isActive: Boolean(r.is_active),
    batchCount: num(r.batch_count),
    totalQuantity: num(r.total_quantity),
    usableQuantity: usable,
    expiredQuantity: num(r.expired_quantity),
    nextExpiry: r.next_expiry,
    usableValue: num(r.usable_value),
    isLowStock: Boolean(r.is_active) && usable <= r.reorder_level,
  };
}

export type MedicineSummary = ReturnType<typeof mapSummary>;

/** Turns user text into a safe MySQL boolean-mode full-text query. */
export function toFullTextQuery(q: string): string | null {
  const terms = q
    .replace(/[+\-<>()~*"@]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length === 0 || terms.some((t) => t.length < 3)) return null;
  return terms.map((t) => `+${t}*`).join(" ");
}

const SORT_SQL: Record<MedicineSort, string> = {
  name: "s.medicine_name",
  stock: "s.usable_quantity",
  reorder: "s.reorder_level",
  expiry: "s.next_expiry",
  updated: "m.updated_at",
};

/**
 * Medicine list with live stock (v_inventory_summary). Search uses the
 * FULLTEXT index ft_medicines_search (MATCH ... AGAINST); very short terms
 * fall back to a LIKE prefix/substring match on the name.
 */
export async function listMedicines(actor: Actor, filters: MedicineFilters = {}) {
  assertCan(actor, "medicine:view");
  const conditions: Prisma.Sql[] = [Prisma.sql`1 = 1`];
  const q = filters.q?.trim();
  if (q) {
    const ft = toFullTextQuery(q);
    conditions.push(
      ft
        ? Prisma.sql`(MATCH(m.name, m.generic_name, m.manufacturer) AGAINST (${ft} IN BOOLEAN MODE) OR m.name LIKE ${`%${q}%`})`
        : Prisma.sql`(m.name LIKE ${`%${q}%`} OR m.generic_name LIKE ${`%${q}%`})`,
    );
  }
  if (filters.categoryId) conditions.push(Prisma.sql`s.category_id = ${filters.categoryId}`);
  const status = filters.status ?? "active";
  if (status === "active") conditions.push(Prisma.sql`s.is_active = TRUE`);
  if (status === "inactive") conditions.push(Prisma.sql`s.is_active = FALSE`);
  if (filters.stock === "low") conditions.push(Prisma.sql`s.usable_quantity <= s.reorder_level`);
  if (filters.stock === "out") conditions.push(Prisma.sql`s.usable_quantity = 0`);
  const where = Prisma.join(conditions, " AND ");

  const sortColumn = SORT_SQL[filters.sort ?? "name"] ?? SORT_SQL.name;
  const direction = filters.dir === "desc" ? "DESC" : "ASC";
  const orderBy = Prisma.raw(`${sortColumn} ${direction}, s.medicine_name ASC, s.medicine_id ASC`);
  const pageSize = Math.min(filters.pageSize ?? 20, 100);
  const page = Math.max(filters.page ?? 1, 1);

  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<SummaryRow[]>`
      SELECT s.* FROM v_inventory_summary s JOIN medicines m ON m.id = s.medicine_id
       WHERE ${where} ORDER BY ${orderBy}
       LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total FROM v_inventory_summary s JOIN medicines m ON m.id = s.medicine_id WHERE ${where}`,
  ]);
  return { rows: rows.map(mapSummary), total: num(countRows[0]?.total), page, pageSize };
}

export async function getMedicineSummary(id: number): Promise<MedicineSummary | null> {
  const rows = await prisma.$queryRaw<SummaryRow[]>`SELECT * FROM v_inventory_summary WHERE medicine_id = ${id}`;
  return rows[0] ? mapSummary(rows[0]) : null;
}

export async function getMedicine(actor: Actor, id: number) {
  assertCan(actor, "medicine:view");
  const medicine = await prisma.medicine.findUnique({
    where: { id },
    include: {
      category: true,
      batches: { orderBy: [{ expiryDate: "asc" }, { id: "asc" }] },
    },
  });
  if (!medicine) throw new NotFoundError("Medicine not found.");
  const summary = await getMedicineSummary(id);
  return { medicine, summary: summary! };
}

const MEDICINE_DUPLICATE = "A medicine with the same name, strength, dosage form and manufacturer already exists.";

export async function createMedicine(actor: Actor, input: unknown) {
  assertCan(actor, "medicine:manage");
  const data = parseInput(medicineSchema, input);
  try {
    const medicine = await runTransaction(async (tx) => {
      const created = await tx.medicine.create({ data });
      await enqueueAudit(tx, {
        action: "medicine.create",
        entityType: "medicine",
        entityId: created.id,
        summary: `Added medicine ${created.name} ${created.strength}`,
        actor,
        details: { categoryId: created.categoryId, reorderLevel: created.reorderLevel },
      });
      return created;
    });
    await flushOutbox();
    return medicine;
  } catch (error) {
    if (isUniqueViolation(error, "uq_medicines_identity")) throw new ValidationError(MEDICINE_DUPLICATE, { name: ["Duplicate medicine."] });
    if (isForeignKeyViolation(error)) throw new ValidationError("Choose a valid category.", { categoryId: ["Unknown category."] });
    throw error;
  }
}

export async function updateMedicine(actor: Actor, id: number, input: unknown) {
  assertCan(actor, "medicine:manage");
  const data = parseInput(medicineSchema, input);
  try {
    const medicine = await runTransaction(async (tx) => {
      const before = await tx.medicine.findUnique({ where: { id } });
      if (!before) throw new NotFoundError("Medicine not found.");
      const updated = await tx.medicine.update({ where: { id }, data });
      const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => String(before[k]) !== String(updated[k]));
      await enqueueAudit(tx, {
        action: "medicine.update",
        entityType: "medicine",
        entityId: id,
        summary: `Updated medicine ${updated.name} ${updated.strength}`,
        actor,
        details: { changedFields: changed },
      });
      return updated;
    });
    await flushOutbox();
    return medicine;
  } catch (error) {
    if (isUniqueViolation(error, "uq_medicines_identity")) throw new ValidationError(MEDICINE_DUPLICATE, { name: ["Duplicate medicine."] });
    if (isForeignKeyViolation(error)) throw new ValidationError("Choose a valid category.", { categoryId: ["Unknown category."] });
    throw error;
  }
}

/** Activate / deactivate (the safe alternative to deleting history). */
export async function setMedicineActive(actor: Actor, id: number, isActive: boolean) {
  assertCan(actor, "medicine:manage");
  await runTransaction(async (tx) => {
    const medicine = await tx.medicine.update({ where: { id }, data: { isActive } });
    await enqueueAudit(tx, {
      action: isActive ? "medicine.activate" : "medicine.deactivate",
      entityType: "medicine",
      entityId: id,
      summary: `${isActive ? "Reactivated" : "Deactivated"} medicine ${medicine.name} ${medicine.strength}`,
      actor,
    });
  });
  await flushOutbox();
}

/** Hard delete is allowed only for medicines that have no batches. */
export async function deleteMedicine(actor: Actor, id: number) {
  assertCan(actor, "medicine:manage");
  try {
    await runTransaction(async (tx) => {
      const medicine = await tx.medicine.delete({ where: { id } });
      await enqueueAudit(tx, {
        action: "medicine.delete",
        entityType: "medicine",
        entityId: id,
        summary: `Deleted medicine ${medicine.name} ${medicine.strength} (no history)`,
        actor,
      });
    });
    await flushOutbox();
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new ConflictError("This medicine has batch history and cannot be deleted. Deactivate it instead.");
    }
    if ((error as { code?: string }).code === "P2025") throw new NotFoundError("Medicine not found.");
    throw error;
  }
}

export async function listMedicineOptions(options: { activeOnly?: boolean } = {}) {
  const medicines = await prisma.medicine.findMany({
    where: options.activeOnly ? { isActive: true } : undefined,
    select: { id: true, name: true, strength: true, unit: true, dosageForm: true },
    orderBy: [{ name: "asc" }, { strength: "asc" }],
  });
  return medicines.map((m) => ({ id: m.id, label: `${m.name} ${m.strength}`, unit: m.unit }));
}

// ================================================================ suppliers

export type SupplierFilters = { q?: string; status?: "active" | "inactive" | "all"; page?: number; pageSize?: number };

export async function listSuppliers(actor: Actor, filters: SupplierFilters = {}) {
  assertCan(actor, "supplier:view");
  const where: Prisma.SupplierWhereInput = {};
  if (filters.q) where.OR = [{ name: { contains: filters.q } }, { contactPerson: { contains: filters.q } }, { phone: { contains: filters.q } }];
  const status = filters.status ?? "all";
  if (status !== "all") where.isActive = status === "active";
  const pageSize = Math.min(filters.pageSize ?? 20, 100);
  const page = Math.max(filters.page ?? 1, 1);
  const [rows, total] = await Promise.all([
    prisma.supplier.findMany({
      where,
      include: { _count: { select: { purchases: true } } },
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.supplier.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

export async function getSupplier(actor: Actor, id: number) {
  assertCan(actor, "supplier:view");
  const supplier = await prisma.supplier.findUnique({ where: { id }, include: { _count: { select: { purchases: true } } } });
  if (!supplier) throw new NotFoundError("Supplier not found.");
  return supplier;
}

function supplierUniqueError(error: unknown): never | void {
  if (isUniqueViolation(error, "uq_suppliers_name")) throw new ValidationError("A supplier with this name already exists.", { name: ["Already exists."] });
  if (isUniqueViolation(error, "uq_suppliers_license")) {
    throw new ValidationError("Another supplier already uses this licence number.", { licenseNumber: ["Already in use."] });
  }
}

export async function createSupplier(actor: Actor, input: unknown) {
  assertCan(actor, "supplier:manage");
  const data = parseInput(supplierSchema, input);
  try {
    const supplier = await runTransaction(async (tx) => {
      const created = await tx.supplier.create({ data });
      await enqueueAudit(tx, { action: "supplier.create", entityType: "supplier", entityId: created.id, summary: `Added supplier ${created.name}`, actor });
      return created;
    });
    await flushOutbox();
    return supplier;
  } catch (error) {
    supplierUniqueError(error);
    throw error;
  }
}

export async function updateSupplier(actor: Actor, id: number, input: unknown) {
  assertCan(actor, "supplier:manage");
  const data = parseInput(supplierSchema, input);
  try {
    const supplier = await runTransaction(async (tx) => {
      const updated = await tx.supplier.update({ where: { id }, data });
      await enqueueAudit(tx, { action: "supplier.update", entityType: "supplier", entityId: id, summary: `Updated supplier ${updated.name}`, actor });
      return updated;
    });
    await flushOutbox();
    return supplier;
  } catch (error) {
    supplierUniqueError(error);
    if ((error as { code?: string }).code === "P2025") throw new NotFoundError("Supplier not found.");
    throw error;
  }
}

export async function deleteSupplier(actor: Actor, id: number) {
  assertCan(actor, "supplier:manage");
  try {
    await runTransaction(async (tx) => {
      const deleted = await tx.supplier.delete({ where: { id } });
      await enqueueAudit(tx, { action: "supplier.delete", entityType: "supplier", entityId: id, summary: `Deleted supplier ${deleted.name}`, actor });
    });
    await flushOutbox();
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new ConflictError("This supplier has purchase history and cannot be deleted. Mark it inactive instead.");
    }
    if ((error as { code?: string }).code === "P2025") throw new NotFoundError("Supplier not found.");
    throw error;
  }
}

export async function listSupplierOptions() {
  const suppliers = await prisma.supplier.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return suppliers.map((s) => ({ id: s.id, label: s.name }));
}
