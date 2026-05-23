import type { QueryEntry } from "../../market-data/result-types";
import type { ChartResolution, ChartViewState, ComparisonChartViewState, TimeRange } from "./chart-types";
import {
  clampTimeRangeToMaxRange,
  getBestSupportedResolutionForPreset,
  getCompatibleBufferRange,
  getNextBufferRange,
  getPresetResolution,
  getSupportMaxRange,
  getWidestPresetForResolution,
  isTimeRangeAtOrBelow,
  type ManualChartResolution,
} from "./chart-resolution";
import {
  getCanonicalZoomLevel,
  isDateWindowWithinTimeRange,
  type VisibleDateWindow,
} from "./chart-date-window";

export {
  buildPresetDateWindow,
  buildVisibleDateWindow,
  buildVisibleDateWindowFromRange,
  clampDateWindowToBounds,
  getCanonicalZoomLevel,
  getDateWindowBounds,
  getMinimumDateStepMs,
  getPointDates,
  getTimeRangeForDateWindow,
  getVisibleWindowForDateRange,
  sameDateWindow,
  shiftDateWindow,
  subtractTimeRange,
  type DateWindowRange,
  type VisibleDateWindow,
} from "./chart-date-window";

type ViewStateWithViewport = Pick<ChartViewState, "presetRange" | "bufferRange" | "activePreset" | "resolution" | "panOffset" | "zoomLevel" | "cursorX" | "cursorY">
  | Pick<ComparisonChartViewState, "presetRange" | "bufferRange" | "activePreset" | "resolution" | "panOffset" | "zoomLevel" | "cursorX" | "cursorY">;

export interface ChartBodyState<T> {
  data: T | null;
  blocking: boolean;
  updating: boolean;
  emptyMessage: string | null;
  errorMessage: string | null;
}

function isCanonicalPresetViewport(
  dates: readonly Date[],
  state: Pick<ViewStateWithViewport, "activePreset" | "panOffset" | "zoomLevel" | "resolution">,
): boolean {
  if (!state.activePreset) return false;
  if (state.panOffset !== 0) return false;
  const canonicalZoom = getCanonicalZoomLevel(dates, state.activePreset);
  return Math.abs(state.zoomLevel - canonicalZoom) < 0.001;
}

type CanonicalPresetViewportState = Pick<ViewStateWithViewport, "presetRange" | "activePreset" | "panOffset" | "zoomLevel" | "cursorX" | "cursorY">;

export function needsCanonicalPresetViewportReset(
  dates: readonly Date[],
  state: Pick<CanonicalPresetViewportState, "presetRange" | "activePreset" | "panOffset" | "zoomLevel">,
): boolean {
  if (dates.length === 0) return false;
  if (state.activePreset !== state.presetRange) return false;
  if (state.panOffset !== 0) return false;
  const canonicalZoom = getCanonicalZoomLevel(dates, state.presetRange);
  return Math.abs(state.zoomLevel - canonicalZoom) >= 0.001;
}

export function resolvePresetRangeViewport<S extends CanonicalPresetViewportState>(
  state: S,
  dates: readonly Date[],
): S {
  if (dates.length === 0) return state;
  const canonicalZoom = getCanonicalZoomLevel(dates, state.presetRange);
  if (state.zoomLevel === canonicalZoom && state.panOffset === 0) return state;
  return {
    ...state,
    panOffset: 0,
    zoomLevel: canonicalZoom,
    cursorX: null,
    cursorY: null,
  };
}

export function resolveCanonicalPresetViewport<S extends CanonicalPresetViewportState>(
  state: S,
  dates: readonly Date[],
): S {
  if (!needsCanonicalPresetViewportReset(dates, state)) return state;
  return resolvePresetRangeViewport(state, dates);
}

export function resolveVisibleActivePreset(
  dates: readonly Date[],
  state: Pick<ViewStateWithViewport, "presetRange" | "activePreset" | "panOffset" | "zoomLevel" | "resolution">,
): TimeRange | null {
  if (!state.activePreset) return null;
  if (isCanonicalPresetViewport(dates, state)) return state.activePreset;
  return needsCanonicalPresetViewportReset(dates, state) ? state.activePreset : null;
}

function resolvePresetSelectionWithResolution<S extends ViewStateWithViewport>(
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
