import { describe, expect, it } from "vitest";
import { allocateFefo, type FefoCandidate } from "@/lib/fefo";

const today = "2026-10-25";
const batch = (batchId: number, expiryDate: string, quantity: number): FefoCandidate => ({
  batchId,
  batchNumber: `B${batchId}`,
  expiryDate,
  quantity,
});

describe("allocateFefo (First-Expiry-First-Out)", () => {
  it("takes the earliest-expiring batch first", () => {
    const plan = allocateFefo([batch(1, "2027-06-01", 50), batch(2, "2026-12-01", 50)], 30, today);
    expect(plan.allocations).toEqual([{ ...batch(2, "2026-12-01", 50), take: 30 }]);
    expect(plan.shortfall).toBe(0);
  });

  it("spans several batches in expiry order when one is not enough", () => {
    const plan = allocateFefo([batch(1, "2027-06-01", 50), batch(2, "2026-12-01", 20), batch(3, "2027-01-15", 10)], 45, today);
    expect(plan.allocations.map((a) => [a.batchId, a.take])).toEqual([
      [2, 20],
      [3, 10],
      [1, 15],
    ]);
  });

  it("excludes expired batches, including one that expires today", () => {
    const plan = allocateFefo([batch(1, "2026-10-20", 100), batch(2, today, 100), batch(3, "2026-10-26", 5)], 5, today);
    expect(plan.available).toBe(5);
    expect(plan.allocations.map((a) => a.batchId)).toEqual([3]);
  });

  it("excludes depleted batches", () => {
    const plan = allocateFefo([batch(1, "2026-11-01", 0), batch(2, "2027-01-01", 10)], 4, today);
    expect(plan.allocations.map((a) => a.batchId)).toEqual([2]);
  });

  it("reports a shortfall instead of over-allocating", () => {
    const plan = allocateFefo([batch(1, "2027-01-01", 10), batch(2, "2027-02-01", 5)], 20, today);
    expect(plan.available).toBe(15);
    expect(plan.shortfall).toBe(5);
    expect(plan.allocations.reduce((s, a) => s + a.take, 0)).toBe(15);
  });

  it("breaks expiry ties by batch id", () => {
    const plan = allocateFefo([batch(9, "2027-01-01", 10), batch(4, "2027-01-01", 10)], 12, today);
    expect(plan.allocations.map((a) => [a.batchId, a.take])).toEqual([
      [4, 10],
      [9, 2],
    ]);
  });

  it("rejects zero and negative quantities", () => {
    expect(() => allocateFefo([], 0, today)).toThrow(RangeError);
    expect(() => allocateFefo([], -3, today)).toThrow(RangeError);
    expect(() => allocateFefo([], 1.5, today)).toThrow(RangeError);
  });
});
