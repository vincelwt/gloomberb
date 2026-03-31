import type { PricePoint, TickerFinancials } from "../types/financials";

function getPointTimestamp(point: PricePoint): number {
  return point.date instanceof Date ? point.date.getTime() : new Date(point.date).getTime();
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
  if (points.length <= 1) return points;

  let previousTime = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const time = getPointTimestamp(point);
    if (!Number.isFinite(time) || time < previousTime) {
      return [...points].sort(comparePricePointsByDate);
    }
    previousTime = time;
  }

  return points;
}

export function normalizeTickerFinancialsPriceHistory(financials: TickerFinancials): TickerFinancials {
  const priceHistory = normalizePriceHistory(financials.priceHistory ?? []);
  return priceHistory === financials.priceHistory
    ? financials
    : { ...financials, priceHistory };
}
