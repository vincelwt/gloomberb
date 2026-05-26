import type { PricePoint, Quote } from "../../../types/financials";
import { isQuoteStaleForCurrentSession } from "../../../market-data/quotes/freshness";
import { hasLikelyQuoteUnitMismatch } from "../../../utils/currency-units";

export {
  bucketOhlcSeries,
  projectChartData,
  resolveRenderMode,
  resolveStableOhlcProjectionOptions,
} from "./projection";
export type {
  ChartProjection,
  ProjectChartDataOptions,
  ProjectedChartPoint,
} from "./projection";

const MAX_LIVE_QUOTE_TAIL_AGE_MS = 7 * 24 * 60 * 60_000;
const MAX_LIVE_QUOTE_CLOCK_SKEW_MS = 5 * 60_000;
const MS_DAY = 86400_000;

function coerceDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

function getPointTime(point: Pick<PricePoint, "date">): number {
  return coerceDate(point.date as Date | string | number).getTime();
}

function getActiveQuotePrice(quote: Quote): number {
  if ((quote.marketState === "PRE" || quote.marketState === "PREPRE") && quote.preMarketPrice != null) {
    return quote.preMarketPrice;
  }
  if ((quote.marketState === "POST" || quote.marketState === "POSTPOST") && quote.postMarketPrice != null) {
    return quote.postMarketPrice;
  }
  return quote.price;
}

export function appendLiveQuotePoint(
  points: PricePoint[],
  quote: Quote | null | undefined,
  now = Date.now(),
): PricePoint[] {
  if (!quote || isQuoteStaleForCurrentSession(quote, now)) return points;

  const quoteTime = quote.lastUpdated;
  const quotePrice = getActiveQuotePrice(quote);
  if (
    !Number.isFinite(quoteTime)
    || !Number.isFinite(quotePrice)
    || quotePrice <= 0
    || quoteTime > now + MAX_LIVE_QUOTE_CLOCK_SKEW_MS
    || now - quoteTime > MAX_LIVE_QUOTE_TAIL_AGE_MS
  ) {
    return points;
  }

  const latest = points.at(-1);
  if (!latest) return points;

  const latestTime = getPointTime(latest);
  if (!Number.isFinite(latestTime) || quoteTime <= latestTime) return points;

  const latestClose = latest.close;
  if (hasLikelyQuoteUnitMismatch(
    { currency: quote.currency, price: latestClose },
    { currency: quote.currency, price: quotePrice },
  )) {
    return points;
  }

  return [
    ...points,
    {
      date: new Date(quoteTime),
      open: latestClose,
      high: Math.max(latest.high ?? latestClose, quotePrice),
      low: Math.min(latest.low ?? latestClose, quotePrice),
      close: quotePrice,
    },
  ];
}

/**
 * Given the visible time span in milliseconds, return a generic bar size label
 * for fetching higher-resolution data, or null if the base data is sufficient.
 */
export function resolveBarSize(visibleTimeSpanMs: number): string | null {
  if (visibleTimeSpanMs < MS_DAY) return "5m";
  if (visibleTimeSpanMs < 3 * MS_DAY) return "15m";
  if (visibleTimeSpanMs < 28 * MS_DAY) return "1h";
  if (visibleTimeSpanMs < 90 * MS_DAY) return "1d";
  return null;
}
