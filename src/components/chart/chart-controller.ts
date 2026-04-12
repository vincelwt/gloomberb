import type { QueryEntry } from "../../market-data/result-types";
import type { PricePoint } from "../../types/financials";
import { clampChartZoom, getVisiblePointCount } from "./chart-viewport";
import type { ChartResolution, ChartViewState, ComparisonChartViewState, TimeRange, VisibleWindow } from "./chart-types";
import {
  clampTimeRangeToMaxRange,
  getBestSupportedResolutionForPreset,
  getCompatibleBufferRange,
  getNextBufferRange,
  getPresetResolution,
  getSupportMaxRange,
  getWidestPresetForResolution,
  isDateWindowWithinTimeRange,
  isTimeRangeAtOrBelow,
  subtractTimeRange,
  type ChartResolutionSupport,
  type ManualChartResolution,
} from "./chart-resolution";

type ViewStateWithViewport = Pick<ChartViewState, "presetRange" | "bufferRange" | "activePreset" | "resolution" | "panOffset" | "zoomLevel" | "cursorX" | "cursorY">
  | Pick<ComparisonChartViewState, "presetRange" | "bufferRange" | "activePreset" | "resolution" | "panOffset" | "zoomLevel" | "cursorX" | "cursorY">;

export interface VisibleDateWindow {
  start: Date | null;
  end: Date | null;
  dates: Date[];
  startIdx: number;
  endIdx: number;
  totalDates: number;
}

export interface ChartBodyState<T> {
  data: T | null;
  blocking: boolean;
  updating: boolean;
  emptyMessage: string | null;
  errorMessage: string | null;
}

export interface DateWindowRange {
  start: Date | null;
  end: Date | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function coerceDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

function normalizeDateWindowRange(window: DateWindowRange | null | undefined): { startMs: number; endMs: number } | null {
  if (!window?.start || !window.end) return null;
  const rawStartMs = window.start.getTime();
  const rawEndMs = window.end.getTime();
  if (!Number.isFinite(rawStartMs) || !Number.isFinite(rawEndMs)) return null;
  return rawStartMs <= rawEndMs
    ? { startMs: rawStartMs, endMs: rawEndMs }
    : { startMs: rawEndMs, endMs: rawStartMs };
}

function lowerBoundDate(dates: readonly Date[], targetMs: number): number {
  let low = 0;
  let high = dates.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (dates[mid]!.getTime() < targetMs) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function upperBoundDate(dates: readonly Date[], targetMs: number): number {
  let low = 0;
  let high = dates.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (dates[mid]!.getTime() <= targetMs) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function resolveMinimumPointWindow(
  dates: readonly Date[],
  startMs: number,
  endMs: number,
  minimumPoints: number,
): { startIdx: number; endIdx: number } {
  if (dates.length === 0) return { startIdx: 0, endIdx: 0 };

  let startIdx = lowerBoundDate(dates, startMs);
  let endIdx = upperBoundDate(dates, endMs);

  if (minimumPoints <= 0) {
    return {
      startIdx: Math.min(startIdx, dates.length),
      endIdx: Math.min(Math.max(endIdx, startIdx), dates.length),
    };
  }

  if (endIdx - startIdx >= minimumPoints || dates.length <= minimumPoints) {
    return {
      startIdx: Math.min(startIdx, dates.length),
      endIdx: Math.min(Math.max(endIdx, startIdx), dates.length),
    };
  }

  const centerMs = startMs + ((endMs - startMs) / 2);
  let anchorIdx = lowerBoundDate(dates, centerMs);
  if (anchorIdx >= dates.length) anchorIdx = dates.length - 1;
  if (anchorIdx > 0) {
    const currentDistance = Math.abs(dates[anchorIdx]!.getTime() - centerMs);
    const previousDistance = Math.abs(dates[anchorIdx - 1]!.getTime() - centerMs);
    if (previousDistance <= currentDistance) {
      anchorIdx -= 1;
    }
  }

  startIdx = Math.max(Math.min(anchorIdx - Math.floor((minimumPoints - 1) / 2), dates.length - minimumPoints), 0);
  endIdx = Math.min(startIdx + minimumPoints, dates.length);

  return { startIdx, endIdx };
}

export function getPointDates(points: readonly Pick<PricePoint, "date">[]): Date[] {
  return points.map((point) => coerceDate(point.date as Date | string | number));
}

export function getDateWindowBounds(dates: readonly Date[]): DateWindowRange | null {
  if (dates.length === 0) return null;
  return {
    start: dates[0] ?? null,
    end: dates[dates.length - 1] ?? null,
  };
}

export function getMinimumDateStepMs(dates: readonly Date[]): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < dates.length; index += 1) {
    const delta = dates[index]!.getTime() - dates[index - 1]!.getTime();
    if (delta > 0 && delta < minimum) {
      minimum = delta;
    }
  }
  return Number.isFinite(minimum) ? minimum : 1;
}

export function buildPresetDateWindow(dates: readonly Date[], presetRange: TimeRange): DateWindowRange | null {
  if (dates.length === 0) return null;
  if (presetRange === "ALL") {
    return {
      start: dates[0] ?? null,
      end: dates[dates.length - 1] ?? null,
    };
  }

  const end = dates[dates.length - 1]!;
  const threshold = subtractTimeRange(end, presetRange).getTime();
  const startIdx = dates.findIndex((date) => date.getTime() >= threshold);

  return {
    start: dates[startIdx < 0 ? 0 : startIdx] ?? null,
    end,
  };
}

export function sameDateWindow(
  left: DateWindowRange | null | undefined,
  right: DateWindowRange | null | undefined,
  toleranceMs = 1,
): boolean {
  if (!left?.start || !left.end || !right?.start || !right.end) {
    return left?.start === right?.start && left?.end === right?.end;
  }
  return Math.abs(left.start.getTime() - right.start.getTime()) <= toleranceMs
    && Math.abs(left.end.getTime() - right.end.getTime()) <= toleranceMs;
}

export function clampDateWindowToBounds(
  window: DateWindowRange | null | undefined,
  bounds: DateWindowRange | null | undefined,
  minimumSpanMs = 1,
): DateWindowRange | null {
  const normalizedWindow = normalizeDateWindowRange(window);
  const normalizedBounds = normalizeDateWindowRange(bounds);
  if (!normalizedWindow || !normalizedBounds) return null;

  const availableSpanMs = Math.max(normalizedBounds.endMs - normalizedBounds.startMs, 0);
  const effectiveMinimumSpanMs = availableSpanMs === 0
    ? 0
    : Math.min(Math.max(minimumSpanMs, 1), availableSpanMs);

  let startMs = clamp(normalizedWindow.startMs, normalizedBounds.startMs, normalizedBounds.endMs);
  let endMs = clamp(normalizedWindow.endMs, normalizedBounds.startMs, normalizedBounds.endMs);

  if (endMs < startMs) {
    [startMs, endMs] = [endMs, startMs];
  }

  if (effectiveMinimumSpanMs > 0 && endMs - startMs < effectiveMinimumSpanMs) {
    const centerMs = startMs + ((endMs - startMs) / 2);
    startMs = centerMs - (effectiveMinimumSpanMs / 2);
    endMs = centerMs + (effectiveMinimumSpanMs / 2);
  }

  if (startMs < normalizedBounds.startMs) {
    const shiftMs = normalizedBounds.startMs - startMs;
    startMs += shiftMs;
    endMs += shiftMs;
  }

  if (endMs > normalizedBounds.endMs) {
    const shiftMs = endMs - normalizedBounds.endMs;
    startMs -= shiftMs;
    endMs -= shiftMs;
  }

  startMs = clamp(startMs, normalizedBounds.startMs, normalizedBounds.endMs);
  endMs = clamp(endMs, normalizedBounds.startMs, normalizedBounds.endMs);

  if (effectiveMinimumSpanMs > 0 && endMs - startMs < effectiveMinimumSpanMs) {
    if (availableSpanMs <= effectiveMinimumSpanMs) {
      startMs = normalizedBounds.startMs;
      endMs = normalizedBounds.endMs;
    } else {
      endMs = Math.min(normalizedBounds.endMs, startMs + effectiveMinimumSpanMs);
      startMs = Math.max(normalizedBounds.startMs, endMs - effectiveMinimumSpanMs);
    }
  }

  return {
    start: new Date(startMs),
    end: new Date(endMs),
  };
}

export function scaleDateWindow(
  window: DateWindowRange | null | undefined,
  spanScale: number,
  anchorRatio: number,
): DateWindowRange | null {
  const normalizedWindow = normalizeDateWindowRange(window);
  if (!normalizedWindow) return null;

  const currentSpanMs = Math.max(normalizedWindow.endMs - normalizedWindow.startMs, 1);
  const nextSpanMs = Math.max(currentSpanMs * spanScale, 1);
  const ratio = clamp(anchorRatio, 0, 1);
  const anchorMs = normalizedWindow.startMs + (currentSpanMs * ratio);
  const nextStartMs = anchorMs - (nextSpanMs * ratio);

  return {
    start: new Date(nextStartMs),
    end: new Date(nextStartMs + nextSpanMs),
  };
}

export function shiftDateWindow(
  window: DateWindowRange | null | undefined,
  shiftRatio: number,
): DateWindowRange | null {
  const normalizedWindow = normalizeDateWindowRange(window);
  if (!normalizedWindow) return null;

  const spanMs = Math.max(normalizedWindow.endMs - normalizedWindow.startMs, 1);
  const shiftMs = spanMs * shiftRatio;

  return {
    start: new Date(normalizedWindow.startMs - shiftMs),
    end: new Date(normalizedWindow.endMs - shiftMs),
  };
}

export function getCanonicalVisiblePointCount(dates: readonly Date[], presetRange: TimeRange): number {
  if (dates.length === 0) return 0;
  if (presetRange === "ALL") return dates.length;
  const endDate = dates[dates.length - 1]!;
  const threshold = subtractTimeRange(endDate, presetRange).getTime();
  const firstVisibleIndex = dates.findIndex((date) => date.getTime() >= threshold);
  if (firstVisibleIndex < 0) return dates.length;
  return Math.max(dates.length - firstVisibleIndex, 1);
}

export function getCanonicalZoomLevel(dates: readonly Date[], presetRange: TimeRange): number {
  if (dates.length === 0) return 1;
  const visibleCount = getCanonicalVisiblePointCount(dates, presetRange);
  return clampChartZoom(dates.length, dates.length / Math.max(visibleCount, 1));
}

export function buildVisibleDateWindow(
  dates: readonly Date[],
  panOffset: number,
  zoomLevel: number,
): VisibleDateWindow {
  if (dates.length === 0) {
    return { start: null, end: null, dates: [], startIdx: 0, endIdx: 0, totalDates: 0 };
  }
  const visibleCount = getVisiblePointCount(dates.length, zoomLevel);
  const maxPan = Math.max(dates.length - visibleCount, 0);
  const pan = clamp(panOffset, 0, maxPan);
  const endIdx = dates.length - pan;
  const startIdx = Math.max(endIdx - visibleCount, 0);
  const visibleDates = dates.slice(startIdx, endIdx);
  return {
    start: visibleDates[0] ?? null,
    end: visibleDates[visibleDates.length - 1] ?? null,
    dates: visibleDates,
    startIdx,
    endIdx,
    totalDates: dates.length,
  };
}

export function buildVisibleDateWindowFromRange(
  dates: readonly Date[],
  window: DateWindowRange | null | undefined,
  minimumPoints = 2,
): VisibleDateWindow {
  if (dates.length === 0) {
    return { start: null, end: null, dates: [], startIdx: 0, endIdx: 0, totalDates: 0 };
  }

  const normalizedWindow = normalizeDateWindowRange(window);
  if (!normalizedWindow) {
    return {
      start: dates[0] ?? null,
      end: dates[dates.length - 1] ?? null,
      dates: [...dates],
      startIdx: 0,
      endIdx: dates.length,
      totalDates: dates.length,
    };
  }

  const { startIdx, endIdx } = resolveMinimumPointWindow(dates, normalizedWindow.startMs, normalizedWindow.endMs, minimumPoints);
  const visibleDates = dates.slice(startIdx, endIdx);

  return {
    start: visibleDates[0] ?? null,
    end: visibleDates[visibleDates.length - 1] ?? null,
    dates: visibleDates,
    startIdx,
    endIdx,
    totalDates: dates.length,
  };
}

export function getVisibleWindowForDateRange(
  points: readonly PricePoint[],
  window: DateWindowRange | null | undefined,
  minimumPoints = 2,
): VisibleWindow {
  if (points.length === 0) {
    return { points: [], startIdx: 0, endIdx: 0 };
  }

  const pointDates = getPointDates(points);
  const visibleWindow = buildVisibleDateWindowFromRange(pointDates, window, minimumPoints);

  return {
    points: points.slice(visibleWindow.startIdx, visibleWindow.endIdx),
    startIdx: visibleWindow.startIdx,
    endIdx: visibleWindow.endIdx,
  };
}

export function formatVisibleSpanLabel(window: Pick<VisibleDateWindow, "start" | "end">): string {
  if (!window.start || !window.end) return "view: --";
  const sameYear = window.start.getFullYear() === window.end.getFullYear();
  const sameMonth = sameYear && window.start.getMonth() === window.end.getMonth();
  const sameDay = sameMonth && window.start.getDate() === window.end.getDate();
  const spanMs = Math.max(window.end.getTime() - window.start.getTime(), 0);
  const showTime = sameDay || spanMs <= 2 * 24 * 60 * 60_000;

  if (showTime) {
    const startLabel = window.start.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
    });
    const startTime = window.start.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    const endLabel = sameDay
      ? window.end.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })
      : `${window.end.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: sameYear ? undefined : "numeric",
      })} ${window.end.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })}`;
    return `view:${startLabel} ${startTime}-${endLabel}`;
  }

  const startLabel = window.start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const endLabel = window.end.toLocaleDateString("en-US", {
    month: sameMonth ? undefined : "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
  return `view:${startLabel}-${endLabel}`;
}

export function isCanonicalPresetViewport(
  dates: readonly Date[],
  state: Pick<ViewStateWithViewport, "activePreset" | "panOffset" | "zoomLevel" | "resolution">,
): boolean {
  if (!state.activePreset) return false;
  if (state.panOffset !== 0) return false;
  const canonicalZoom = getCanonicalZoomLevel(dates, state.activePreset);
  return Math.abs(state.zoomLevel - canonicalZoom) < 0.001;
}

export function resolvePresetSelectionWithResolution<S extends ViewStateWithViewport>(
  state: S,
  presetRange: TimeRange,
  resolution: ManualChartResolution,
  supportMaxRange: TimeRange | null = null,
): S {
  return {
    ...state,
    presetRange,
    bufferRange: getCompatibleBufferRange(presetRange, supportMaxRange),
    activePreset: presetRange,
    resolution,
    panOffset: 0,
    zoomLevel: 1,
    cursorX: null,
    cursorY: null,
  };
}

export function resolvePresetSelection<S extends ViewStateWithViewport>(
  state: S,
  presetRange: TimeRange,
  supportMaxRange: TimeRange | null = null,
): S {
  return resolvePresetSelectionWithResolution(
    state,
    presetRange,
    getPresetResolution(presetRange),
    supportMaxRange,
  );
}

export function resolveResolutionSelection<S extends ViewStateWithViewport>(
  state: S,
  resolution: ChartResolution,
  support: ReadonlyMap<ManualChartResolution, TimeRange>,
  visibleWindow: Pick<VisibleDateWindow, "start" | "end"> | null,
): S | null {
  if (resolution === "auto") {
    return {
      ...state,
      resolution,
      bufferRange: getNextBufferRange(state.presetRange),
      activePreset: null,
      panOffset: 0,
      zoomLevel: 1,
      cursorX: null,
      cursorY: null,
    };
  }

  const maxRange = getSupportMaxRange(support, resolution);
  if (!maxRange) return null;

  const visibleSpanTooWide = visibleWindow?.start && visibleWindow.end
    ? !isDateWindowWithinTimeRange(visibleWindow.start, visibleWindow.end, maxRange)
    : false;
  const shouldSnap = !isTimeRangeAtOrBelow(state.presetRange, maxRange) || visibleSpanTooWide;
  const presetRange = shouldSnap
    ? getWidestPresetForResolution(resolution, maxRange)
    : clampTimeRangeToMaxRange(state.presetRange, maxRange);

  return {
    ...state,
    presetRange,
    bufferRange: getCompatibleBufferRange(presetRange, maxRange),
    activePreset: shouldSnap ? presetRange : null,
    resolution,
    panOffset: 0,
    zoomLevel: 1,
    cursorX: null,
    cursorY: null,
  };
}

export function resolveStoredChartSelection<S extends ViewStateWithViewport>(
  state: S,
  presetRange: TimeRange,
  resolution: ChartResolution,
  support: ReadonlyMap<ManualChartResolution, TimeRange>,
): S {
  const resetState = {
    ...state,
    presetRange,
    panOffset: 0,
    zoomLevel: 1,
    cursorX: null,
    cursorY: null,
  };

  if (resolution === "auto") {
    return {
      ...resetState,
      resolution,
      bufferRange: getNextBufferRange(presetRange),
      activePreset: null,
    };
  }

  const resolvedSelection = resolveResolutionSelection(
    {
      ...resetState,
      bufferRange: getNextBufferRange(presetRange),
      activePreset: null,
      resolution: "auto",
    },
    resolution,
    support,
    null,
  );

  if (!resolvedSelection) {
    const fallbackResolution = getBestSupportedResolutionForPreset(presetRange, support);
    if (!fallbackResolution) {
      return {
        ...resetState,
        resolution: "auto",
        bufferRange: getNextBufferRange(presetRange),
        activePreset: null,
      };
    }
    return resolvePresetSelectionWithResolution(
      resetState,
      presetRange,
      fallbackResolution,
      getSupportMaxRange(support, fallbackResolution),
    );
  }

  const bestSupportedResolution = getBestSupportedResolutionForPreset(resolvedSelection.presetRange, support);
  return {
    ...resolvedSelection,
    activePreset: resolvedSelection.resolution !== "auto"
      && bestSupportedResolution !== null
      && resolvedSelection.resolution === bestSupportedResolution
      ? resolvedSelection.presetRange
      : null,
  };
}

export function clearActivePreset<S extends Pick<ViewStateWithViewport, "activePreset">>(state: S): S {
  if (state.activePreset === null) return state;
  return {
    ...state,
    activePreset: null,
  };
}

export function resolveChartBodyState<T>(
  entry: QueryEntry<T> | null | undefined,
  hasData: (value: T | null) => boolean,
  emptyMessage: string,
): ChartBodyState<T> {
  const data = entry?.data ?? null;
  const hasCurrentData = hasData(data);

  if (!entry || entry.phase === "idle" || ((entry.phase === "loading" || entry.phase === "refreshing") && !hasCurrentData)) {
    return {
      data: null,
      blocking: true,
      updating: false,
      emptyMessage: null,
      errorMessage: null,
    };
  }

  if (entry.phase === "error" && !hasCurrentData) {
    return {
      data: null,
      blocking: false,
      updating: false,
      emptyMessage: null,
      errorMessage: entry.error?.message ?? "Chart data failed to load.",
    };
  }

  if (!hasCurrentData) {
    return {
      data,
      blocking: false,
      updating: false,
      emptyMessage,
      errorMessage: null,
    };
  }

  return {
    data,
    blocking: false,
    updating: entry.phase === "refreshing",
    emptyMessage: null,
    errorMessage: null,
  };
}
