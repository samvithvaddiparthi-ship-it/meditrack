import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError } from "@/lib/errors";
import { listActivity } from "@/server/services/audit.service";
import { createMedicine as createMedicineService, createSupplier as createSupplierService } from "@/server/services/catalog.service";
import { updateIncidentStatus } from "@/server/services/incidents.service";
import { recordAdjustment, writeOffExpired } from "@/server/services/stock.service";
import { createUser as createUserService, updateUser } from "@/server/services/users.service";
import { inventoryReports } from "@/server/services/inventory.service";
import { batchByNumber, createCategory, createMedicine, createSupplier, createUser, receive, uuid } from "./helpers";
import { setupCleanDatabases } from "./lifecycle";

setupCleanDatabases();

const medicineInput = (categoryId: number) => ({
  name: "Authz Test Medicine",
  categoryId,
  manufacturer: "Test Pharma",
  dosageForm: "TABLET",
  strength: "5 mg",
  unit: "strip",
  storageCondition: "ROOM_TEMPERATURE",
  reorderLevel: 5,
  isActive: true,
});

describe("server-side role authorization", () => {
  it("blocks STAFF from administrative mutations even when called directly", async () => {
    const { actor: staff } = await createUser("STAFF");
    const category = await createCategory();
    await expect(createMedicineService(staff, medicineInput(category.id))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createSupplierService(staff, { name: "X Ltd", phone: "+91 99999 99999", address: "Somewhere 1" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createUserService(staff, { name: "New", email: "n@test.local", role: "ADMIN", password: "Password1234" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listActivity(staff)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateIncidentStatus(staff, "0123456789abcdef01234567", "OPEN", { status: "RESOLVED", note: "done" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(writeOffExpired(staff, { idempotencyKey: uuid() })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lets STAFF decrease but not increase stock through adjustments", async () => {
    const { actor: staff } = await createUser("STAFF");
    const supplier = await createSupplier();
    const medicine = await createMedicine();
    await receive(staff, supplier.id, [{ medicineId: medicine.id, batchNumber: "ADJ-1", qty: 20, expDays: 200 }]);
    const b = await batchByNumber(medicine.id, "ADJ-1");

    const out = await recordAdjustment(staff, { idempotencyKey: uuid(), batchId: b.id, direction: "OUT", quantity: 2, reason: "COUNT_CORRECTION", notes: "Physical count lower" });
    expect(out.movements[0].balanceAfter).toBe(18);
    await expect(
      recordAdjustment(staff, { idempotencyKey: uuid(), batchId: b.id, direction: "IN", quantity: 2, reason: "COUNT_CORRECTION", notes: "Found extra" }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const { actor: admin } = await createUser("ADMIN");
    const inc = await recordAdjustment(admin, { idempotencyKey: uuid(), batchId: b.id, direction: "IN", quantity: 2, reason: "COUNT_CORRECTION", notes: "Found extra" });
    expect(inc.movements[0].balanceAfter).toBe(20);
  });

  it("allows ADMIN to manage the catalogue", async () => {
    const { actor: admin } = await createUser("ADMIN");
    const category = await createCategory();
    const created = await createMedicineService(admin, medicineInput(category.id));
    expect(created.id).toBeGreaterThan(0);
  });

  it("hides financial report values from STAFF", async () => {
    const { actor: staff } = await createUser("STAFF");
    const { actor: admin } = await createUser("ADMIN");
    const supplier = await createSupplier();
    const medicine = await createMedicine();
    await receive(admin, supplier.id, [{ medicineId: medicine.id, batchNumber: "FIN-1", qty: 10, expDays: 300, cost: 5 }]);
    const staffView = await inventoryReports(staff);
    const adminView = await inventoryReports(admin);
    expect(staffView.byCategory[0].usableValue).toBeNull();
    expect(adminView.byCategory[0].usableValue).toBe(50);
  });

  it("prevents admins from demoting or deactivating themselves", async () => {
    const { actor: admin, user } = await createUser("ADMIN");
    await expect(updateUser(admin, user.id, { name: user.name, role: "STAFF", isActive: true })).rejects.toBeInstanceOf(ConflictError);
    await expect(updateUser(admin, user.id, { name: user.name, role: "ADMIN", isActive: false })).rejects.toBeInstanceOf(ConflictError);
  });

  it("never removes the last active administrator", async () => {
    const { actor: staleAdmin, user: staleUser } = await createUser("ADMIN");
    const { user: onlyAdmin } = await createUser("ADMIN");
    // The acting admin was deactivated in the meantime (stale session object).
    await prisma.user.update({ where: { id: staleUser.id }, data: { isActive: false } });
    await expect(updateUser(staleAdmin, onlyAdmin.id, { name: onlyAdmin.name, role: "STAFF", isActive: true })).rejects.toThrow(
      "At least one active administrator is required.",
    );
  });
});
