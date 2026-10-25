import { describe, expect, it } from "vitest";
import { assertCan } from "@/lib/authz";
import { ForbiddenError } from "@/lib/errors";
import { can, PERMISSIONS } from "@/lib/permissions";

describe("role permissions", () => {
  it("grants every permission to ADMIN", () => {
    for (const p of PERMISSIONS) expect(can("ADMIN", p)).toBe(true);
  });

  it("lets STAFF run day-to-day inventory work", () => {
    for (const p of ["medicine:view", "batch:view", "purchase:create", "stock:issue", "stock:waste", "stock:adjust-out", "alerts:view", "incident:create", "ledger:view", "reports:view"] as const) {
      expect(can("STAFF", p)).toBe(true);
    }
  });

  it("keeps management and review functions away from STAFF", () => {
    for (const p of ["medicine:manage", "supplier:manage", "category:manage", "user:manage", "audit:view", "incident:review", "incident:view-all", "stock:adjust-in", "stock:write-off-expired", "reports:financial"] as const) {
      expect(can("STAFF", p)).toBe(false);
    }
  });

  it("assertCan throws ForbiddenError for a missing permission", () => {
    expect(() => assertCan({ id: 1, name: "S", role: "STAFF" }, "user:manage")).toThrow(ForbiddenError);
    expect(() => assertCan({ id: 1, name: "A", role: "ADMIN" }, "user:manage")).not.toThrow();
  });
});
