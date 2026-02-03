import type { CostValidationFlag, SupplierCompany } from "@prisma/client";

const flagPriority: Record<CostValidationFlag, number> = {
  OK: 0,
  NEEDS_REVIEW: 1,
  TIME_MISMATCH: 2,
  GPS_MISMATCH: 3,
  MISSING_EVIDENCE: 4
};

export function chooseFlag(current: CostValidationFlag, candidate: CostValidationFlag): CostValidationFlag {
  return flagPriority[candidate] > flagPriority[current] ? candidate : current;
}

export function eligibleExtraKm(measuredKm: number | null, supplier: SupplierCompany): number | null {
  if (measuredKm === null) return null;
  return Math.max(0, measuredKm - supplier.includedKm);
}

export function eligibleExtraMinutes(
  measuredMinutes: number | null,
  supplier: SupplierCompany
): number | null {
  if (measuredMinutes === null) return null;
  return Math.max(0, measuredMinutes - supplier.includedMinutes);
}
