import { describe, expect, it } from "vitest";
import { batchStatus, businessTodayIso, dateOnly, daysUntil, isValidIsoDate } from "@/lib/dates";

describe("business dates (IST, UTC+05:30)", () => {
  it("rolls over to the next calendar day at 18:30 UTC", () => {
    expect(businessTodayIso(new Date("2026-10-25T18:29:59Z"))).toBe("2026-10-25");
    expect(businessTodayIso(new Date("2026-10-25T18:30:00Z"))).toBe("2026-10-26");
  });

  it("validates calendar dates strictly", () => {
    expect(isValidIsoDate("2026-02-28")).toBe(true);
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("26-02-01")).toBe(false);
    expect(() => dateOnly("2026-13-01")).toThrow();
  });

  it("counts days until expiry", () => {
    const today = dateOnly("2026-10-25");
    expect(daysUntil("2026-10-25", today)).toBe(0);
    expect(daysUntil("2026-11-24", today)).toBe(30);
    expect(daysUntil("2026-10-20", today)).toBe(-5);
  });
});

describe("batchStatus", () => {
  const today = dateOnly("2026-10-25");
  it("is DEPLETED whenever the quantity is zero", () => {
    expect(batchStatus(0, "2025-01-01", 30, today)).toBe("DEPLETED");
    expect(batchStatus(0, "2028-01-01", 30, today)).toBe("DEPLETED");
  });
  it("is EXPIRED on and after the expiry date", () => {
    expect(batchStatus(5, "2026-10-25", 30, today)).toBe("EXPIRED");
    expect(batchStatus(5, "2026-10-01", 30, today)).toBe("EXPIRED");
  });
  it("is EXPIRING_SOON inside the window and AVAILABLE outside it", () => {
    expect(batchStatus(5, "2026-10-26", 30, today)).toBe("EXPIRING_SOON");
    expect(batchStatus(5, "2026-11-24", 30, today)).toBe("EXPIRING_SOON");
    expect(batchStatus(5, "2026-11-25", 30, today)).toBe("AVAILABLE");
    expect(batchStatus(5, "2026-11-25", 60, today)).toBe("EXPIRING_SOON");
  });
});
