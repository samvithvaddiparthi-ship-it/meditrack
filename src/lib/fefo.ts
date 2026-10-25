/**
 * First-Expiry-First-Out allocation (pure function, no I/O).
 *
 * Eligible batches hold stock and are not expired (expiry date strictly
 * after today). They are consumed in order of earliest expiry, then lowest
 * batch id, until the requested quantity is covered.
 */
export type FefoCandidate = {
  batchId: number;
  batchNumber: string;
  expiryDate: string; // YYYY-MM-DD
  quantity: number;
};

export type FefoAllocation = FefoCandidate & { take: number };

export type FefoPlan = {
  allocations: FefoAllocation[];
  requested: number;
  available: number;
  shortfall: number;
};

export function allocateFefo(candidates: FefoCandidate[], requested: number, todayIso: string): FefoPlan {
  if (!Number.isInteger(requested) || requested <= 0) {
    throw new RangeError("Requested quantity must be a positive whole number");
  }
  const eligible = candidates
    .filter((c) => c.quantity > 0 && c.expiryDate > todayIso)
    .sort((a, b) => (a.expiryDate === b.expiryDate ? a.batchId - b.batchId : a.expiryDate < b.expiryDate ? -1 : 1));

  const available = eligible.reduce((sum, c) => sum + c.quantity, 0);
  const allocations: FefoAllocation[] = [];
  let remaining = requested;
  for (const candidate of eligible) {
    if (remaining === 0) break;
    const take = Math.min(candidate.quantity, remaining);
    allocations.push({ ...candidate, take });
    remaining -= take;
  }
  return {
    allocations,
    requested,
    available,
    shortfall: remaining,
  };
}
