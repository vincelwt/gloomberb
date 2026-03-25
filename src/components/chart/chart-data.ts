import type { PricePoint } from "../../types/financials";
import type { TimeRange, ChartViewState, VisibleWindow } from "./chart-types";
import { RANGE_DAYS } from "./chart-types";

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

  // Number of data points visible at current zoom
  const visibleCount = Math.max(
    Math.floor(chartWidth / viewState.zoomLevel),
    10, // minimum 10 data points visible
  );

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

/**
 * Downsample data points to fit the target width.
 * Uses LTTB-like bucketing that preserves highs and lows.
 */
export function downsample(
  points: PricePoint[],
  targetWidth: number,
): PricePoint[] {
  if (points.length <= targetWidth) return points;

  const result: PricePoint[] = [];
  const bucketSize = points.length / targetWidth;

  for (let i = 0; i < targetWidth; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.floor((i + 1) * bucketSize);
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
    result.push(best);
  }

  return result;
}
