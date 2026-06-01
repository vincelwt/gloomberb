import type { PricePoint } from "../../../types/financials";
import type {
  ChartAxisMode,
  ComparisonChartRenderMode,
  ComparisonChartSeries,
  ComparisonChartViewState,
} from "../core/types";
import { buildVisibleDateWindowFromRange } from "../core/date-window";
import { getVisiblePointCount } from "../core/viewport";
import {
  buildIndexProjectionBuckets,
  selectRepresentativeCloseValue,
  type IndexProjectionBucket,
} from "../core/projection";

export interface ComparisonProjectedPoint {
  date: Date;
  value: number | null;
  rawValue: number | null;
}

export interface ComparisonProjectedSeries {
  symbol: string;
  color: string;
  fillColor: string;
  currency?: string;
  baseValue: number | null;
  latestRawValue: number | null;
  latestValue: number | null;
  points: ComparisonProjectedPoint[];
}

interface ComparisonVisibleWindow {
  dates: Date[];
  startIdx: number;
  endIdx: number;
  totalDates: number;
}

interface ComparisonAxisModeResolution {
  requestedAxisMode: ChartAxisMode;
  effectiveAxisMode: ChartAxisMode;
  warning: string | null;
}

type ComparisonWindowViewState =
  Pick<ComparisonChartViewState, "panOffset" | "zoomLevel">
  & Partial<Pick<ComparisonChartViewState, "dateWindow">>;

type ComparisonProjectionViewState =
  ComparisonWindowViewState
  & Pick<ComparisonChartViewState, "renderMode">;

export interface ComparisonChartProjection {
  dates: Date[];
  series: ComparisonProjectedSeries[];
  requestedMode: ComparisonChartRenderMode;
  effectiveMode: ComparisonChartRenderMode;
  requestedAxisMode: ChartAxisMode;
  effectiveAxisMode: ChartAxisMode;
  warning: string | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function coerceDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

function normalizeSeriesPoints(points: PricePoint[]): PricePoint[] {
  return [...points].sort((left, right) => (
    coerceDate(left.date as Date | string | number).getTime()
    - coerceDate(right.date as Date | string | number).getTime()
  ));
}

function getUniqueSortedDates(series: ComparisonChartSeries[]): Date[] {
  const byTimestamp = new Map<number, Date>();

  for (const entry of series) {
    for (const point of entry.points) {
      const date = coerceDate(point.date as Date | string | number);
      const timestamp = date.getTime();
      if (!Number.isNaN(timestamp)) {
        byTimestamp.set(timestamp, date);
      }
    }
  }

  return [...byTimestamp.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, date]) => date);
}

export function getMaxComparisonPanOffset(
  series: ComparisonChartSeries[],
  zoomLevel: number,
): number {
  const dates = getUniqueSortedDates(series);
  const visibleCount = getVisiblePointCount(dates.length, zoomLevel);
  return Math.max(dates.length - visibleCount, 0);
}

export function getVisibleComparisonWindow(
  series: ComparisonChartSeries[],
  viewState: ComparisonWindowViewState,
): ComparisonVisibleWindow {
  const dates = getUniqueSortedDates(series);

  if (dates.length === 0) {
    return { dates: [], startIdx: 0, endIdx: 0, totalDates: 0 };
  }

  if (viewState.dateWindow?.start && viewState.dateWindow.end) {
    const visibleWindow = buildVisibleDateWindowFromRange(dates, viewState.dateWindow);
    return {
      dates: visibleWindow.dates,
      startIdx: visibleWindow.startIdx,
      endIdx: visibleWindow.endIdx,
      totalDates: visibleWindow.totalDates,
    };
  }

  const visibleCount = getVisiblePointCount(dates.length, viewState.zoomLevel);
  const maxPan = Math.max(dates.length - visibleCount, 0);
  const pan = clamp(viewState.panOffset, 0, maxPan);
  const endIdx = dates.length - pan;
  const startIdx = Math.max(endIdx - visibleCount, 0);

  return {
    dates: dates.slice(startIdx, endIdx),
    startIdx,
    endIdx,
    totalDates: dates.length,
  };
}

function normalizeComparisonMode(mode: ComparisonChartRenderMode | undefined): ComparisonChartRenderMode {
  return mode === "line" ? "line" : "area";
}

function transformRawValue(rawValue: number | null, axisMode: ChartAxisMode, baseValue: number | null): number | null {
  if (rawValue === null) return null;
  if (axisMode === "price") return rawValue;
  if (baseValue === null || baseValue === 0) {
    return rawValue === baseValue ? 0 : null;
  }
  return ((rawValue - baseValue) / baseValue) * 100;
}

function resolveRepresentativeValue(values: number[], index: number): number {
  return selectRepresentativeCloseValue(values, index, (value) => value);
}

function buildSeriesMap(points: PricePoint[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const point of points) {
    const date = coerceDate(point.date as Date | string | number);
    const timestamp = date.getTime();
    if (Number.isNaN(timestamp)) continue;
    map.set(timestamp, point.close);
  }
  return map;
}

function buildFilledRawValuesByDate(
  rawByDate: ReadonlyMap<number, number>,
  dates: readonly Date[],
): Array<number | null> {
  let latestRawValue: number | null = null;
  return dates.map((date) => {
    const timestamp = date.getTime();
    if (rawByDate.has(timestamp)) {
      latestRawValue = rawByDate.get(timestamp)!;
      return latestRawValue;
    }
    return latestRawValue;
  });
}

function getBucketDate(
  dates: readonly Date[],
  bucket: IndexProjectionBucket,
): Date {
  return dates[Math.max(bucket.end - 1, 0)] ?? dates[dates.length - 1] ?? new Date(0);
}

function resolveComparisonAxisMode(
  requestedAxisMode: ChartAxisMode,
  series: ComparisonChartSeries[],
  visibleDates: Date[],
): ComparisonAxisModeResolution {
  if (requestedAxisMode !== "price") {
    return {
      requestedAxisMode,
      effectiveAxisMode: requestedAxisMode,
      warning: null,
    };
  }

  const visibleTimestamps = new Set(visibleDates.map((date) => date.getTime()));
  const currencies = new Set(
    series
      .filter((entry) => entry.currency && entry.points.some((point) => visibleTimestamps.has(coerceDate(point.date as Date | string | number).getTime())))
      .map((entry) => entry.currency!.trim().toUpperCase())
      .filter((currency) => currency.length > 0),
  );

  if (currencies.size <= 1) {
    return {
      requestedAxisMode,
      effectiveAxisMode: requestedAxisMode,
      warning: null,
    };
  }

  return {
    requestedAxisMode,
    effectiveAxisMode: "percent",
    warning: "Mixed currencies detected; showing percent change.",
  };
}

export function projectComparisonChartData(
  series: ComparisonChartSeries[],
  chartWidth: number,
  viewState: ComparisonProjectionViewState,
  requestedAxisMode: ChartAxisMode,
): ComparisonChartProjection {
  const normalizedSeries = series.map((entry) => ({ ...entry, points: normalizeSeriesPoints(entry.points) }));
  const window = getVisibleComparisonWindow(normalizedSeries, viewState);
  const axisResolution = resolveComparisonAxisMode(requestedAxisMode, normalizedSeries, window.dates);
  const requestedMode = normalizeComparisonMode(viewState.renderMode);
  if (window.dates.length === 0) {
    return {
      dates: [],
      series: normalizedSeries.map((entry) => ({
        symbol: entry.symbol,
        color: entry.color,
        fillColor: entry.fillColor,
        currency: entry.currency,
        baseValue: null,
        latestRawValue: null,
        latestValue: null,
        points: [],
      })),
      requestedMode,
      effectiveMode: requestedMode,
      requestedAxisMode: requestedAxisMode,
      effectiveAxisMode: axisResolution.effectiveAxisMode,
      warning: axisResolution.warning,
    };
  }
  const buckets = buildIndexProjectionBuckets(window.dates.length, chartWidth);

  const projectedSeries = normalizedSeries.map((entry) => {
    const rawByDate = buildSeriesMap(entry.points);
    const filledRawValues = buildFilledRawValuesByDate(rawByDate, window.dates);
    const visibleRawValues = filledRawValues
      .filter((value): value is number => value !== null);
    const baseValue = visibleRawValues[0] ?? null;
    const latestRawValue = visibleRawValues[visibleRawValues.length - 1] ?? null;

    const points = buckets.map((bucket) => {
      const bucketRawValues = filledRawValues
        .slice(bucket.start, bucket.end)
        .filter((value): value is number => value !== null);
      const rawValue = bucketRawValues.length > 0
        ? resolveRepresentativeValue(bucketRawValues, bucket.index)
        : null;

      return {
        date: getBucketDate(window.dates, bucket),
        rawValue,
        value: transformRawValue(rawValue, axisResolution.effectiveAxisMode, baseValue),
      };
    });

    return {
      symbol: entry.symbol,
      color: entry.color,
      fillColor: entry.fillColor,
      currency: entry.currency,
      baseValue,
      latestRawValue,
      latestValue: transformRawValue(latestRawValue, axisResolution.effectiveAxisMode, baseValue),
      points,
    };
  });

  return {
    dates: buckets.map((bucket) => getBucketDate(window.dates, bucket)),
    series: projectedSeries,
    requestedMode,
    effectiveMode: requestedMode,
    requestedAxisMode: requestedAxisMode,
    effectiveAxisMode: axisResolution.effectiveAxisMode,
    warning: axisResolution.warning,
  };
}
