import type { PricePoint, Quote } from "../../types/financials";
import { isQuoteStaleForCurrentSession } from "../../utils/quote-freshness";
import type { ChartRenderMode } from "./chart-types";

export interface ProjectedChartPoint {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ChartProjection {
  points: ProjectedChartPoint[];
  requestedMode: ChartRenderMode;
  effectiveMode: ChartRenderMode;
  fallbackMode: ChartRenderMode | null;
}

export interface ProjectChartDataOptions {
  ohlcBucketWidth?: number;
  ohlcSourceBucketSize?: number;
  ohlcTargetBucketCount?: number;
  sourceIndexOffset?: number;
}

export interface StableOhlcProjectionOptionsInput {
  pointCount: number;
  sourceIndexOffset: number;
  bucketWidth: number;
  navigationPointCount?: number;
  countRatioTolerance?: number;
}

const DEFAULT_OHLC_COUNT_RATIO_TOLERANCE = 1.2;
const MAX_LIVE_QUOTE_TAIL_AGE_MS = 7 * 24 * 60 * 60_000;
const MAX_LIVE_QUOTE_CLOCK_SKEW_MS = 5 * 60_000;

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

function getRequestedRenderMode(mode?: ChartRenderMode, compact = false): ChartRenderMode {
  if (compact) return "area";
  return mode ?? "area";
}

function isOhlcProjectionMode(mode: ChartRenderMode): boolean {
  return mode === "candles" || mode === "ohlc" || mode === "hlc";
}

export function resolveRenderMode(
  mode: ChartRenderMode | undefined,
  chartWidth: number,
  compact = false,
): { requestedMode: ChartRenderMode; effectiveMode: ChartRenderMode; fallbackMode: ChartRenderMode | null } {
  const requestedMode = getRequestedRenderMode(mode, compact);
  if (compact) {
    return {
      requestedMode,
      effectiveMode: "area",
      fallbackMode: null,
    };
  }

  let effectiveMode = requestedMode;
  switch (requestedMode) {
    case "candles":
      if (chartWidth < 28) effectiveMode = "line";
      else if (chartWidth < 40) effectiveMode = "ohlc";
      break;
    case "ohlc":
    case "hlc":
      if (chartWidth < 28) effectiveMode = "line";
      break;
  }

  return {
    requestedMode,
    effectiveMode,
    fallbackMode: effectiveMode === requestedMode ? null : effectiveMode,
  };
}

function normalizePoint(point: PricePoint): ProjectedChartPoint {
  const open = point.open ?? point.close;
  const high = point.high ?? point.close;
  const low = point.low ?? point.close;

  return {
    date: coerceDate(point.date as Date | string | number),
    open,
    high,
    low,
    close: point.close,
    volume: point.volume ?? 0,
  };
}

function getMinimumPositiveDateGapMs(points: readonly ProjectedChartPoint[]): number | null {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!.date.getTime();
    const current = points[index]!.date.getTime();
    const gap = current - previous;
    if (Number.isFinite(gap) && gap > 0 && gap < minimum) {
      minimum = gap;
    }
  }
  return Number.isFinite(minimum) ? minimum : null;
}

function aggregateOhlcBucket(bucket: readonly ProjectedChartPoint[]): ProjectedChartPoint {
  const first = bucket[0]!;
  const last = bucket[bucket.length - 1]!;
  let high = first.high;
  let low = first.low;
  let volume = 0;

  for (const point of bucket) {
    high = Math.max(high, point.high);
    low = Math.min(low, point.low);
    volume += point.volume;
  }

  return {
    date: last.date,
    open: first.open,
    high,
    low,
    close: last.close,
    volume,
  };
}

function bucketOhlcBySourceIndex(
  normalizedPoints: readonly ProjectedChartPoint[],
  bucketSize: number,
  sourceIndexOffset: number,
  targetBucketCount?: number,
): ProjectedChartPoint[] {
  const normalizedBucketSize = Math.max(Math.floor(bucketSize), 1);
  const normalizedSourceIndexOffset = Math.max(Math.floor(sourceIndexOffset), 0);
  const maximumBucketCount = targetBucketCount === undefined
    ? Number.POSITIVE_INFINITY
    : Math.max(Math.floor(targetBucketCount), 1);
  const result: ProjectedChartPoint[] = [];
  const firstBucketStart = Math.floor(normalizedSourceIndexOffset / normalizedBucketSize) * normalizedBucketSize;
  const endSourceIndex = normalizedSourceIndexOffset + normalizedPoints.length;

  for (
    let bucketStart = firstBucketStart;
    bucketStart < endSourceIndex && result.length < maximumBucketCount;
    bucketStart += normalizedBucketSize
  ) {
    const bucketEnd = bucketStart + normalizedBucketSize;
    const start = Math.max(bucketStart - normalizedSourceIndexOffset, 0);
    const end = Math.min(bucketEnd - normalizedSourceIndexOffset, normalizedPoints.length);
    if (end <= start) continue;
    const bucket = normalizedPoints.slice(start, end);
    if (bucket.length === 0) continue;
    result.push(aggregateOhlcBucket(bucket));
  }

  return result;
}

export function resolveStableOhlcProjectionOptions({
  pointCount,
  sourceIndexOffset,
  bucketWidth,
  navigationPointCount = 0,
  countRatioTolerance = DEFAULT_OHLC_COUNT_RATIO_TOLERANCE,
}: StableOhlcProjectionOptionsInput): ProjectChartDataOptions {
  const ohlcBucketWidth = Math.max(Math.floor(bucketWidth), 1);
  const ohlcProjectionWidth = Math.max(Math.floor(ohlcBucketWidth / 2), 1);
  const normalizedPointCount = Math.max(Math.floor(pointCount), 0);
  const normalizedNavigationPointCount = Math.max(Math.floor(navigationPointCount), 0);
  const canUseNavigationCount = normalizedNavigationPointCount > 0
    && normalizedPointCount > 0
    && Math.max(normalizedNavigationPointCount, normalizedPointCount)
      / Math.max(Math.min(normalizedNavigationPointCount, normalizedPointCount), 1)
      <= countRatioTolerance;
  const stableSourceCount = canUseNavigationCount
    ? normalizedNavigationPointCount
    : normalizedPointCount;
  const ohlcSourceBucketSize = Math.max(Math.ceil(stableSourceCount / ohlcProjectionWidth), 1);
  const ohlcTargetBucketCount = Math.max(Math.ceil(stableSourceCount / ohlcSourceBucketSize), 1);

  return {
    ohlcBucketWidth,
    ohlcSourceBucketSize,
    ohlcTargetBucketCount,
    sourceIndexOffset,
  };
}

/**
 * Downsample close-driven chart data to fit the target width.
 * Uses representative closes so line/area charts preserve the broad shape.
 */
function projectCloseSeries(
  points: PricePoint[],
  targetWidth: number,
): ProjectedChartPoint[] {
  if (points.length === 0) return [];
  if (points.length <= targetWidth) return points.map(normalizePoint);

  const result: ProjectedChartPoint[] = [];
  const bucketSize = points.length / targetWidth;

  for (let i = 0; i < targetWidth; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.min(points.length, Math.max(Math.floor((i + 1) * bucketSize), start + 1));
    const bucket = points.slice(start, end);

    if (bucket.length === 0) continue;

    // Pick the point with the most extreme close value in each bucket
    // alternating between high and low to preserve the shape
    let best = bucket[0]!;
    if (i % 2 === 0) {
      // Pick highest
      for (const p of bucket) {
        if (p.close > best.close) best = p;
      }
    } else {
      // Pick lowest
      for (const p of bucket) {
        if (p.close < best.close) best = p;
      }
    }
    result.push(normalizePoint(best));
  }

  return result;
}

/**
 * Bucket OHLC data so each rendered column preserves open, close, high, low, and volume.
 *
 * The default path aligns buckets by timestamp. Interactive manual panning can pass
 * ohlcSourceBucketSize/ohlcTargetBucketCount to align buckets by source bar index,
 * which keeps the rendered candle count stable as partial edge buckets enter/leave.
 */
export function bucketOhlcSeries(
  points: PricePoint[],
  targetWidth: number,
  options: ProjectChartDataOptions = {},
): ProjectedChartPoint[] {
  if (points.length === 0) return [];
  const normalizedPoints = points.map(normalizePoint);
  if (points.length <= targetWidth) return normalizedPoints;
  if (options.ohlcSourceBucketSize !== undefined) {
    return bucketOhlcBySourceIndex(
      normalizedPoints,
      options.ohlcSourceBucketSize,
      options.sourceIndexOffset ?? 0,
      options.ohlcTargetBucketCount,
    );
  }

  const result: ProjectedChartPoint[] = [];
  const minimumGapMs = getMinimumPositiveDateGapMs(normalizedPoints);
  const firstTime = normalizedPoints[0]!.date.getTime();
  const lastTime = normalizedPoints[normalizedPoints.length - 1]!.date.getTime();
  if (
    minimumGapMs
    && Number.isFinite(firstTime)
    && Number.isFinite(lastTime)
    && lastTime > firstTime
  ) {
    const spanMs = Math.max(lastTime - firstTime, minimumGapMs);
    const rawBucketDurationMs = spanMs / Math.max(targetWidth, 1);
    const bucketDurationMs = Math.max(Math.ceil(rawBucketDurationMs / minimumGapMs) * minimumGapMs, minimumGapMs);
    let currentBucketKey: number | null = null;
    let currentBucket: ProjectedChartPoint[] = [];

    for (const point of normalizedPoints) {
      const time = point.date.getTime();
      const bucketKey = Math.floor(time / bucketDurationMs);
      if (currentBucketKey !== null && bucketKey !== currentBucketKey) {
        result.push(aggregateOhlcBucket(currentBucket));
        currentBucket = [];
      }
      currentBucketKey = bucketKey;
      currentBucket.push(point);
    }

    if (currentBucket.length > 0) {
      result.push(aggregateOhlcBucket(currentBucket));
    }

    return result;
  }

  const bucketSize = Math.max(Math.ceil(normalizedPoints.length / Math.max(targetWidth, 1)), 1);
  const sourceIndexOffset = Math.max(Math.floor(options.sourceIndexOffset ?? 0), 0);
  const firstBucketStart = Math.floor(sourceIndexOffset / bucketSize) * bucketSize;
  const endSourceIndex = sourceIndexOffset + normalizedPoints.length;

  for (let bucketStart = firstBucketStart; bucketStart < endSourceIndex; bucketStart += bucketSize) {
    const bucketEnd = bucketStart + bucketSize;
    const start = Math.max(bucketStart - sourceIndexOffset, 0);
    const end = Math.min(bucketEnd - sourceIndexOffset, normalizedPoints.length);
    if (end <= start) continue;
    const bucket = normalizedPoints.slice(start, end);
    if (bucket.length === 0) continue;
    result.push(aggregateOhlcBucket(bucket));
  }

  return result;
}

const MS_DAY = 86400_000;

/**
 * Given the visible time span in milliseconds, return a generic bar size label
 * for fetching higher-resolution data, or null if the base data is sufficient.
 */
export function resolveBarSize(visibleTimeSpanMs: number): string | null {
  if (visibleTimeSpanMs < MS_DAY) return "5m";
  if (visibleTimeSpanMs < 3 * MS_DAY) return "15m";
  if (visibleTimeSpanMs < 28 * MS_DAY) return "1h";
  if (visibleTimeSpanMs < 90 * MS_DAY) return "1d";
  return null; // base data is sufficient
}

export function projectChartData(
  points: PricePoint[],
  targetWidth: number,
  mode: ChartRenderMode | undefined,
  compact = false,
  options: ProjectChartDataOptions = {},
): ChartProjection {
  const { requestedMode, effectiveMode, fallbackMode } = resolveRenderMode(mode, targetWidth, compact);
  const ohlcBucketWidth = options.ohlcBucketWidth ?? targetWidth;
  const projectionWidth = isOhlcProjectionMode(effectiveMode)
    ? Math.max(Math.floor(ohlcBucketWidth / 2), 1)
    : targetWidth;

  const projectedPoints = isOhlcProjectionMode(effectiveMode)
    ? bucketOhlcSeries(points, projectionWidth, options)
    : projectCloseSeries(points, projectionWidth);

  return {
    points: projectedPoints,
    requestedMode,
    effectiveMode,
    fallbackMode,
  };
}
