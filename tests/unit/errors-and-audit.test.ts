import { describe, expect, it } from "vitest";
import { databaseRuleMessage, isUniqueViolation, toUserMessage, uniqueConstraintName, ValidationError } from "@/lib/errors";
import { sanitizeDetails } from "@/server/services/audit.service";
import { toFullTextQuery } from "@/server/services/catalog.service";

const prismaError = (code: string, cause: Record<string, unknown>) => ({ code, meta: { driverAdapterError: { cause } } });

describe("database error mapping", () => {
  it("surfaces trigger SIGNAL messages", () => {
    const e = prismaError("P2039", { originalCode: "1644", originalMessage: "Insufficient stock in the batch for this movement", state: "45000" });
    expect(databaseRuleMessage(e)).toBe("Insufficient stock in the batch for this movement");
  });
  it("cleans mariadb driver prefixes from procedure errors", () => {
    const e = { errno: 1644, sqlState: "45000", sqlMessage: "Only an active administrator can write off expired stock", message: "(conn:3, no: 1644, SQLState: 45000) Only..." };
    expect(databaseRuleMessage(e)).toBe("Only an active administrator can write off expired stock");
  });
  it("maps CHECK constraint violations to friendly text", () => {
    const e = prismaError("P2039", { originalCode: "3819", originalMessage: "Check constraint 'chk_batches_expiry_after_manufacture' is violated." });
    expect(toUserMessage(e)).toBe("Expiry date must be after the manufacturing date.");
  });
  it("identifies unique indexes", () => {
    const e = prismaError("P2002", { originalCode: "1062", kind: "UniqueConstraintViolation", constraint: { index: "uq_medicines_identity" } });
    expect(uniqueConstraintName(e)).toBe("uq_medicines_identity");
    expect(isUniqueViolation(e, "uq_medicines_identity")).toBe(true);
    expect(isUniqueViolation(e, "uq_other")).toBe(false);
  });
  it("never leaks unknown errors", () => {
    expect(toUserMessage(new Error("connect ECONNREFUSED mysql://user:secret@host"))).toBe("Something went wrong. Please try again.");
    expect(toUserMessage(new ValidationError("Name is required."))).toBe("Name is required.");
  });
});

describe("audit detail sanitising", () => {
  it("drops credential-like keys at any depth", () => {
    const clean = sanitizeDetails({ name: "x", password: "p", nested: { apiKey: "k", token: "t", keep: 1, mongoUri: "mongodb://..." } });
    expect(clean).toEqual({ name: "x", nested: { keep: 1 } });
  });
});

describe("full-text query builder", () => {
  it("builds a prefix boolean query and strips operators", () => {
    expect(toFullTextQuery("amox cap")).toBe("+amox* +cap*");
    expect(toFullTextQuery('para"cet-amol')).toBe("+para* +cet* +amol*");
  });
  it("falls back (null) for short terms", () => {
    expect(toFullTextQuery("ors")).toBe("+ors*");
    expect(toFullTextQuery("b1")).toBeNull();
    expect(toFullTextQuery("   ")).toBeNull();
  });
});
