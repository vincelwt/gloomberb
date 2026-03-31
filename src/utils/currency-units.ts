const SUB_UNIT_CURRENCIES: Record<string, { currency: string; divisor: number }> = {
  GBp: { currency: "GBP", divisor: 100 },
  GBX: { currency: "GBP", divisor: 100 },
  ILA: { currency: "ILS", divisor: 100 },
  ZAc: { currency: "ZAR", divisor: 100 },
};

const LIKELY_UNIT_MISMATCH_RATIOS: Record<string, number[]> = {
  BHD: [1000],
  GBP: [100],
  ILS: [100],
  JOD: [1000],
  KWD: [1000],
  OMR: [1000],
  TND: [1000],
  ZAR: [100],
};

export interface CurrencyUnitInfo {
  currency: string;
  divisor: number;
}

export function resolveCurrencyUnit(currency?: string | null): CurrencyUnitInfo {
  const raw = (currency ?? "").trim();
  if (!raw) {
    return { currency: "", divisor: 1 };
  }

  const normalized = SUB_UNIT_CURRENCIES[raw];
  if (normalized) {
    return normalized;
  }

  return {
    currency: raw.toUpperCase(),
    divisor: 1,
  };
}

export function normalizePriceValueByDivisor(value: number | undefined, divisor: number): number | undefined {
  if (value == null || !Number.isFinite(value) || divisor === 1) return value;
  return value / divisor;
}

function normalizedRatio(left: number, right: number): number {
  const ratio = left / right;
  return ratio >= 1 ? ratio : 1 / ratio;
}

function isRatioWithin(ratio: number, target: number, tolerance = 0.05): boolean {
  return Math.abs(ratio - target) / target < tolerance;
}

function likelyUnitMismatchRatios(currency: string): number[] {
  return LIKELY_UNIT_MISMATCH_RATIOS[currency] ?? [100];
}

export function hasLikelyQuoteUnitMismatch(
  left: { currency?: string; price: number } | null | undefined,
  right: { currency?: string; price: number } | null | undefined,
): boolean {
  if (!left || !right) return false;

  const leftUnit = resolveCurrencyUnit(left.currency);
  const rightUnit = resolveCurrencyUnit(right.currency);
  if (!leftUnit.currency || !rightUnit.currency) return false;
  if (leftUnit.currency !== rightUnit.currency) return false;
  if (!Number.isFinite(left.price) || !Number.isFinite(right.price)) return false;
  if (left.price <= 0 || right.price <= 0) return false;

  if (leftUnit.divisor !== rightUnit.divisor) {
    const leftCanonicalPrice = left.price / leftUnit.divisor;
    const rightCanonicalPrice = right.price / rightUnit.divisor;
    if (isRatioWithin(normalizedRatio(leftCanonicalPrice, rightCanonicalPrice), 1)) {
      return true;
    }
  }

  const ratio = normalizedRatio(left.price, right.price);
  return likelyUnitMismatchRatios(leftUnit.currency).some((target) => isRatioWithin(ratio, target));
}
