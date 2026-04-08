import type { PricePoint } from "../../types/financials";
import type {
  ChartAxisMode,
  ComparisonChartRenderMode,
  ComparisonChartSeries,
  ComparisonChartViewState,
  TimeRange,
} from "./chart-types";
import { RANGE_DAYS } from "./chart-types";
import { getVisiblePointCount, resolveAnchoredChartZoom } from "./chart-viewport";

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

export interface ComparisonVisibleWindow {
  dates: Date[];
  startIdx: number;
  endIdx: number;
  totalDates: number;
}

export interface ComparisonAxisModeResolution {
  requestedAxisMode: ChartAxisMode;
  effectiveAxisMode: ChartAxisMode;
  warning: string | null;
}

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

export function filterComparisonSeriesByTimeRange(
  series: ComparisonChartSeries[],
  range: TimeRange,
): ComparisonChartSeries[] {
  return series.map((entry) => {
    const points = normalizeSeriesPoints(entry.points);
    if (range === "ALL" || points.length <= RANGE_DAYS[range]) {
      return { ...entry, points };
    }
    return { ...entry, points: points.slice(-RANGE_DAYS[range]) };
  });
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
  _timeRange: TimeRange,
  zoomLevel: number,
  chartWidth: number,
): number {
  const dates = getUniqueSortedDates(series);
  const visibleCount = getVisiblePointCount(dates.length, zoomLevel);
  return Math.max(dates.length - visibleCount, 0);
}

export function getVisibleComparisonWindow(
  series: ComparisonChartSeries[],
  viewState: Pick<ComparisonChartViewState, "panOffset" | "zoomLevel">,
  chartWidth: number,
): ComparisonVisibleWindow {
  const dates = getUniqueSortedDates(series);

  if (dates.length === 0) {
    return { dates: [], startIdx: 0, endIdx: 0, totalDates: 0 };
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

export function applyComparisonZoomAroundAnchor(
  view: ComparisonChartViewState,
  nextZoomLevel: number,
  anchorRatio: number,
  series: ComparisonChartSeries[],
): ComparisonChartViewState {
  const dates = getUniqueSortedDates(series);
  if (dates.length === 0) return view;

  const nextZoom = resolveAnchoredChartZoom(
    dates.length,
    view.zoomLevel,
    view.panOffset,
    nextZoomLevel,
    anchorRatio,
  );

  return {
    ...view,
    ...nextZoom,
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
  if (values.length === 1) return values[0]!;
  return index % 2 === 0
    ? Math.max(...values)
    : Math.min(...values);
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

export function resolveComparisonAxisMode(
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
  viewState: Pick<ComparisonChartViewState, "panOffset" | "zoomLevel" | "renderMode">,
  requestedAxisMode: ChartAxisMode,
): ComparisonChartProjection {
  const normalizedSeries = series.map((entry) => ({ ...entry, points: normalizeSeriesPoints(entry.points) }));
  const window = getVisibleComparisonWindow(normalizedSeries, viewState, chartWidth);
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
  const bucketCount = Math.min(Math.max(chartWidth, 1), Math.max(window.dates.length, 1));
  const bucketSize = window.dates.length > 0 ? window.dates.length / bucketCount : 1;

  const projectedSeries = normalizedSeries.map((entry) => {
    const rawByDate = buildSeriesMap(entry.points);
    const visibleRawValues = window.dates
      .map((date) => rawByDate.get(date.getTime()) ?? null)
      .filter((value): value is number => value !== null);
    const baseValue = visibleRawValues[0] ?? null;
    const latestRawValue = visibleRawValues[visibleRawValues.length - 1] ?? null;

    const points = Array.from({ length: bucketCount }, (_, index) => {
      const start = Math.floor(index * bucketSize);
      const end = Math.min(window.dates.length, Math.max(Math.floor((index + 1) * bucketSize), start + 1));
      const bucketDates = window.dates.slice(start, end);
      const date = bucketDates[bucketDates.length - 1] ?? window.dates[window.dates.length - 1] ?? new Date(0);
      const bucketRawValues = bucketDates
        .map((bucketDate) => rawByDate.get(bucketDate.getTime()) ?? null)
        .filter((value): value is number => value !== null);
      const rawValue = bucketRawValues.length > 0
        ? resolveRepresentativeValue(bucketRawValues, index)
        : null;

      return {
        date,
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
    dates: Array.from({ length: bucketCount }, (_, index) => {
      const start = Math.floor(index * bucketSize);
      const end = Math.min(window.dates.length, Math.max(Math.floor((index + 1) * bucketSize), start + 1));
      return window.dates[Math.max(end - 1, 0)] ?? new Date(0);
    }),
    series: projectedSeries,
    requestedMode,
    effectiveMode: requestedMode,
    requestedAxisMode: requestedAxisMode,
    effectiveAxisMode: axisResolution.effectiveAxisMode,
    warning: axisResolution.warning,
  };
}
