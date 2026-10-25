import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ConflictError, ValidationError } from "@/lib/errors";
import {
  createCategory as createCategoryService,
  createSupplier as createSupplierService,
  deleteCategory,
  listMedicines,
  setMedicineActive,
  updateMedicine,
} from "@/server/services/catalog.service";
import { createCategory, createMedicine, createUser } from "./helpers";
import { setupCleanDatabases } from "./lifecycle";

setupCleanDatabases();

describe("catalogue management", () => {
  it("searches medicines with the FULLTEXT index and LIKE fallback", async () => {
    const { actor } = await createUser("STAFF");
    const category = await createCategory();
    await createMedicine({ name: "Amoxicillin", genericName: "Amoxycillin trihydrate", categoryId: category.id, manufacturer: "Novacure" });
    await createMedicine({ name: "Azithromycin", categoryId: category.id, manufacturer: "Novacure" });
    await createMedicine({ name: "B12 Complex", categoryId: category.id, manufacturer: "Zenith" });

    expect((await listMedicines(actor, { q: "amox" })).rows.map((r) => r.name)).toEqual(["Amoxicillin"]);
    expect((await listMedicines(actor, { q: "novacure" })).total).toBe(2);
    expect((await listMedicines(actor, { q: "B1" })).rows.map((r) => r.name)).toEqual(["B12 Complex"]);
  });

  it("filters, sorts and paginates", async () => {
    const { actor } = await createUser("STAFF");
    const category = await createCategory();
    for (const name of ["Delta", "Alpha", "Charlie", "Bravo"]) await createMedicine({ name, categoryId: category.id });
    const page1 = await listMedicines(actor, { sort: "name", pageSize: 2, page: 1 });
    const page2 = await listMedicines(actor, { sort: "name", pageSize: 2, page: 2 });
    expect(page1.rows.map((r) => r.name)).toEqual(["Alpha", "Bravo"]);
    expect(page2.rows.map((r) => r.name)).toEqual(["Charlie", "Delta"]);
    expect(page1.total).toBe(4);
    const desc = await listMedicines(actor, { sort: "name", dir: "desc", pageSize: 1 });
    expect(desc.rows[0].name).toBe("Delta");
  });

  it("deactivates instead of deleting, and inactive medicines leave the default list", async () => {
    const { actor: admin } = await createUser("ADMIN");
    const medicine = await createMedicine({ name: "Retirable" });
    await setMedicineActive(admin, medicine.id, false);
    expect((await listMedicines(admin, {})).rows).toHaveLength(0);
    expect((await listMedicines(admin, { status: "inactive" })).rows.map((r) => r.name)).toEqual(["Retirable"]);
  });

  it("validates updates and rejects duplicates", async () => {
    const { actor: admin } = await createUser("ADMIN");
    const category = await createCategory();
    const a = await createMedicine({ name: "Same", strength: "1 mg", categoryId: category.id });
    await createMedicine({ name: "Same", strength: "2 mg", categoryId: category.id });
    const input = { name: "Same", categoryId: category.id, manufacturer: a.manufacturer, dosageForm: a.dosageForm, strength: "2 mg", unit: "strip", storageCondition: "ROOM_TEMPERATURE", reorderLevel: 3, isActive: true };
    await expect(updateMedicine(admin, a.id, input)).rejects.toThrow(/already exists/);
    await expect(updateMedicine(admin, a.id, { ...input, strength: "", reorderLevel: -1 })).rejects.toBeInstanceOf(ValidationError);
  });

  it("protects categories in use and supplier uniqueness", async () => {
    const { actor: admin } = await createUser("ADMIN");
    const used = await createCategoryService(admin, { name: "Used Category" });
    await createMedicine({ categoryId: used.id });
    await expect(deleteCategory(admin, used.id)).rejects.toBeInstanceOf(ConflictError);
    const unused = await createCategoryService(admin, { name: "Unused Category" });
    await deleteCategory(admin, unused.id);
    expect(await prisma.category.findUnique({ where: { id: unused.id } })).toBeNull();

    const supplier = { name: "Unique Pharma", phone: "+91 80 1234 5678", address: "12 MG Road", licenseNumber: "LIC-1", isActive: true };
    await createSupplierService(admin, supplier);
    await expect(createSupplierService(admin, { ...supplier, name: "Other Pharma" })).rejects.toThrow(/licence number/);
  });
});
