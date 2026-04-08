import type { QueryEntry } from "../../market-data/result-types";
import type { PricePoint } from "../../types/financials";
import { clampChartZoom, getVisiblePointCount } from "./chart-viewport";
import type { ChartResolution, ChartViewState, ComparisonChartViewState, TimeRange } from "./chart-types";
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function coerceDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

export function getPointDates(points: readonly Pick<PricePoint, "date">[]): Date[] {
  return points.map((point) => coerceDate(point.date as Date | string | number));
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

export function formatVisibleSpanLabel(window: Pick<VisibleDateWindow, "start" | "end">): string {
  if (!window.start || !window.end) return "view: --";
  const sameYear = window.start.getFullYear() === window.end.getFullYear();
  const sameMonth = sameYear && window.start.getMonth() === window.end.getMonth();
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

  return {
    ...resolvedSelection,
    activePreset: resolvedSelection.resolution === getBestSupportedResolutionForPreset(resolvedSelection.presetRange, support)
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
