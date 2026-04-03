import type { PricePoint } from "../../types/financials";
import type { TimeRange, ChartRenderMode, ChartViewState, VisibleWindow } from "./chart-types";
import { RANGE_DAYS } from "./chart-types";
import { getVisiblePointCount } from "./chart-viewport";

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

function coerceDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

export function getRequestedRenderMode(mode?: ChartRenderMode, compact = false): ChartRenderMode {
  if (compact) return "area";
  return mode ?? "area";
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
      if (chartWidth < 28) effectiveMode = "line";
      break;
  }

  return {
    requestedMode,
    effectiveMode,
    fallbackMode: effectiveMode === requestedMode ? null : effectiveMode,
  };
}

/**
 * Filter price history to the selected time range.
 */
export function filterByTimeRange(history: PricePoint[], range: TimeRange): PricePoint[] {
  if (range === "ALL" || history.length <= RANGE_DAYS[range]) {
    return history;
  }
  return history.slice(-RANGE_DAYS[range]);
}

/**
 * Apply zoom and pan to get the visible data window.
 */
export function getVisibleWindow(
  history: PricePoint[],
  viewState: ChartViewState,
  chartWidth: number,
): VisibleWindow {
  const filtered = filterByTimeRange(history, viewState.timeRange);
  if (filtered.length === 0) {
    return { points: [], startIdx: 0, endIdx: 0 };
  }

  const visibleCount = getVisiblePointCount(filtered.length, viewState.zoomLevel);

  // Clamp pan offset
  const maxPan = Math.max(filtered.length - visibleCount, 0);
  const pan = Math.min(Math.max(viewState.panOffset, 0), maxPan);

  const endIdx = filtered.length - pan;
  const startIdx = Math.max(endIdx - visibleCount, 0);

  return {
    points: filtered.slice(startIdx, endIdx),
    startIdx,
    endIdx,
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

/**
 * Downsample close-driven chart data to fit the target width.
 * Uses representative closes so line/area charts preserve the broad shape.
 */
export function projectCloseSeries(
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
 */
export function bucketOhlcSeries(
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

    const first = bucket[0]!;
    const last = bucket[bucket.length - 1]!;

    let high = first.high ?? first.close;
    let low = first.low ?? first.close;
    let volume = 0;

    for (const point of bucket) {
      high = Math.max(high, point.high ?? point.close);
      low = Math.min(low, point.low ?? point.close);
      volume += point.volume ?? 0;
    }

    result.push({
      date: coerceDate(last.date as Date | string | number),
      open: first.open ?? first.close,
      high,
      low,
      close: last.close,
      volume,
    });
  }

  return result;
}

const MS_HOUR = 3600_000;
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
): ChartProjection {
  const { requestedMode, effectiveMode, fallbackMode } = resolveRenderMode(mode, targetWidth, compact);
  const projectionWidth = effectiveMode === "candles" || effectiveMode === "ohlc"
    ? Math.max(Math.floor(targetWidth / 2), 1)
    : targetWidth;

  const projectedPoints = effectiveMode === "candles" || effectiveMode === "ohlc"
    ? bucketOhlcSeries(points, projectionWidth)
    : projectCloseSeries(points, projectionWidth);

  return {
    points: projectedPoints,
    requestedMode,
    effectiveMode,
    fallbackMode,
  };
}
