import type { PricePoint, TickerFinancials } from "../types/financials";

function getPointTimestamp(point: PricePoint): number {
  const value = point.date as Date | string | number | null | undefined;
  if (value instanceof Date) return value.getTime();
  if (value == null) return Number.NaN;
  return new Date(value).getTime();
}

function comparePricePointsByDate(left: PricePoint, right: PricePoint): number {
  const leftTime = getPointTimestamp(left);
  const rightTime = getPointTimestamp(right);
  const leftValid = Number.isFinite(leftTime);
  const rightValid = Number.isFinite(rightTime);

  if (leftValid && rightValid) return leftTime - rightTime;
  if (leftValid) return -1;
  if (rightValid) return 1;
  return 0;
}

export function normalizePriceHistory(points: PricePoint[]): PricePoint[] {
  if (points.length === 0) return points;

  const validPoints: PricePoint[] = [];
  let sawDistinctTimestamp = false;
  let firstTimestamp: number | null = null;
  let previousTime = Number.NEGATIVE_INFINITY;
  let requiresSort = false;

  for (const point of points) {
    const time = getPointTimestamp(point);
    if (!Number.isFinite(time)) continue;

    if (firstTimestamp === null) {
      firstTimestamp = time;
    } else if (time !== firstTimestamp) {
      sawDistinctTimestamp = true;
    }

    if (time < previousTime) {
      requiresSort = true;
    }
    previousTime = time;
    validPoints.push(point);
  }

  if (validPoints.length === 0) return [];
  if (validPoints.length === 1) return validPoints;
  if (!sawDistinctTimestamp) return [];

  if (requiresSort) {
    return [...validPoints].sort(comparePricePointsByDate);
  }
  return validPoints.length === points.length ? points : validPoints;
}

export function normalizeTickerFinancialsPriceHistory(financials: TickerFinancials): TickerFinancials {
  const priceHistory = normalizePriceHistory(financials.priceHistory ?? []);
  return priceHistory === financials.priceHistory
    ? financials
    : { ...financials, priceHistory };
}
