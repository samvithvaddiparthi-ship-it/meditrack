import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/validation/common";
import { issueSchema, loginSchema, medicineSchema, passwordSchema, purchaseSchema, supplierSchema, wasteSchema, incidentSchema } from "@/lib/validation/schemas";
import { businessTodayIso } from "@/lib/dates";

const validMedicine = {
  name: "Paracetamol",
  genericName: "",
  categoryId: "1",
  manufacturer: "Sunrise Pharmaceuticals",
  dosageForm: "TABLET",
  strength: "500 mg",
  unit: "strip",
  storageCondition: "ROOM_TEMPERATURE",
  description: "",
  reorderLevel: "50",
  isActive: "on",
};

describe("medicine validation", () => {
  it("accepts and normalises a valid form submission", () => {
    const parsed = parseInput(medicineSchema, validMedicine);
    expect(parsed).toMatchObject({ categoryId: 1, reorderLevel: 50, isActive: true, genericName: null, description: null });
  });

  it("rejects missing names, unknown enums and negative or fractional reorder levels", () => {
    const attempt = (patch: Record<string, unknown>) => () => parseInput(medicineSchema, { ...validMedicine, ...patch });
    expect(attempt({ name: " " })).toThrow(ValidationError);
    expect(attempt({ dosageForm: "PILL" })).toThrow(ValidationError);
    expect(attempt({ reorderLevel: "-1" })).toThrow(ValidationError);
    expect(attempt({ reorderLevel: "2.5" })).toThrow(ValidationError);
    expect(attempt({ reorderLevel: "" })).toThrow(ValidationError);
    expect(attempt({ categoryId: "abc" })).toThrow(ValidationError);
  });

  it("reports errors per field", () => {
    try {
      parseInput(medicineSchema, { ...validMedicine, name: "", strength: "" });
      expect.unreachable();
    } catch (error) {
      expect((error as ValidationError).fieldErrors).toHaveProperty("name");
      expect((error as ValidationError).fieldErrors).toHaveProperty("strength");
    }
  });

  it("treats an unchecked checkbox as inactive", () => {
    const rest: Record<string, unknown> = { ...validMedicine };
    delete rest.isActive;
    expect(parseInput(medicineSchema, rest).isActive).toBe(false);
  });
});

describe("purchase validation", () => {
  const item = { medicineId: 1, batchNumber: "ab-123", manufactureDate: "2026-01-01", expiryDate: "2027-12-31", quantity: 10, unitCost: 12.5 };
  const base = { idempotencyKey: randomUUID(), supplierId: 1, invoiceNumber: "INV-1", purchaseDate: "2026-10-01", notes: "", items: [item] };

  it("upper-cases batch numbers", () => {
    expect(parseInput(purchaseSchema, base).items[0].batchNumber).toBe("AB-123");
  });
  it("rejects expiry before manufacture, zero quantity, and >2-decimal costs", () => {
    expect(() => parseInput(purchaseSchema, { ...base, items: [{ ...item, expiryDate: "2025-12-31" }] })).toThrow(/after the manufacturing date/);
    expect(() => parseInput(purchaseSchema, { ...base, items: [{ ...item, quantity: 0 }] })).toThrow(ValidationError);
    expect(() => parseInput(purchaseSchema, { ...base, items: [{ ...item, unitCost: 1.234 }] })).toThrow(/2 decimals/);
  });
  it("rejects a future manufacturing or purchase date", () => {
    expect(() => parseInput(purchaseSchema, { ...base, purchaseDate: "2999-01-01" })).toThrow(/future/);
    expect(() => parseInput(purchaseSchema, { ...base, items: [{ ...item, manufactureDate: "2999-01-01", expiryDate: "2999-12-01" }] })).toThrow(/future/);
  });
  it("rejects the same batch twice on one receipt and empty receipts", () => {
    expect(() => parseInput(purchaseSchema, { ...base, items: [item, { ...item, batchNumber: "AB-123" }] })).toThrow(/already appear/);
    expect(() => parseInput(purchaseSchema, { ...base, items: [] })).toThrow(/at least one item/);
  });
  it("requires a valid idempotency key", () => {
    expect(() => parseInput(purchaseSchema, { ...base, idempotencyKey: "123" })).toThrow(/Form token/);
  });
});

describe("stock operation validation", () => {
  it("rejects zero / negative issue quantities", () => {
    const base = { idempotencyKey: randomUUID(), medicineId: 1, destination: "Ward 1", notes: "" };
    expect(() => parseInput(issueSchema, { ...base, quantity: 0 })).toThrow(ValidationError);
    expect(() => parseInput(issueSchema, { ...base, quantity: -5 })).toThrow(ValidationError);
    expect(parseInput(issueSchema, { ...base, quantity: "7" }).quantity).toBe(7);
  });
  it("limits waste reasons", () => {
    expect(() => parseInput(wasteSchema, { idempotencyKey: randomUUID(), batchId: 1, quantity: 1, reason: "COUNT_CORRECTION" })).toThrow(ValidationError);
  });
});

describe("account validation", () => {
  it("normalises emails and enforces the password policy", () => {
    expect(parseInput(loginSchema, { email: " Admin@MediTrack.Local ", password: "x" }).email).toBe("admin@meditrack.local");
    expect(passwordSchema.safeParse("short1").success).toBe(false);
    expect(passwordSchema.safeParse("onlyletterslong").success).toBe(false);
    expect(passwordSchema.safeParse("Letters1234").success).toBe(true);
  });
  it("validates supplier phone numbers", () => {
    const supplier = { name: "Acme", phone: "+91 80 1234 5678", address: "1 Main Road", isActive: "on" };
    expect(parseInput(supplierSchema, supplier).phone).toBe("+91 80 1234 5678");
    expect(() => parseInput(supplierSchema, { ...supplier, phone: "call me" })).toThrow(ValidationError);
  });
});

describe("incident validation", () => {
  it("requires counts for stock discrepancies", () => {
    const input = { type: "STOCK_DISCREPANCY", title: "Count mismatch", description: "Counted less than expected.", severity: "MEDIUM", medicineId: "1", batchId: "2", metadata: {} };
    expect(() => parseInput(incidentSchema, input)).toThrow(ValidationError);
    const ok = parseInput(incidentSchema, { ...input, metadata: { expectedQuantity: "10", countedQuantity: "8" } });
    expect(ok.metadata).toMatchObject({ expectedQuantity: 10, countedQuantity: 8 });
  });
  it("uses today's date helper consistently", () => {
    expect(businessTodayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
