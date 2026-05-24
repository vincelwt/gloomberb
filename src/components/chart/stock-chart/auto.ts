import type { PricePoint } from "../../../types/financials";
import {
  buildVisibleDateWindowFromRange,
  getMinimumDateStepMs,
  getPointDates,
  type ChartBodyState,
  type DateWindowRange,
} from "../core/controller";
import type { ManualChartResolution } from "../core/resolution";

export interface AutoRenderedView {
  window: DateWindowRange;
  resolution: ManualChartResolution;
  data: PricePoint[];
}

export interface AutoDisplayState {
  bodyState: ChartBodyState<PricePoint[]>;
  resolution: ManualChartResolution | null;
  window: DateWindowRange | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function resolveAutoDisplayState(options: {
  shouldUseRenderedAutoView: boolean;
  renderedAutoView: AutoRenderedView | null;
  isRenderedAutoViewUpdating: boolean;
  plannedRenderBodyState: ChartBodyState<PricePoint[]>;
  plannedResolvedManualResolution: ManualChartResolution | null;
  plannedDateWindow: DateWindowRange | null;
}): AutoDisplayState {
  const {
    shouldUseRenderedAutoView,
    renderedAutoView,
    isRenderedAutoViewUpdating,
    plannedRenderBodyState,
    plannedResolvedManualResolution,
    plannedDateWindow,
  } = options;

  if (shouldUseRenderedAutoView && renderedAutoView) {
    return {
      bodyState: {
        data: renderedAutoView.data,
        blocking: false,
        updating: isRenderedAutoViewUpdating,
        emptyMessage: null,
        errorMessage: null,
      },
      resolution: renderedAutoView.resolution,
      window: renderedAutoView.window,
    };
  }

  return {
    bodyState: plannedRenderBodyState,
    resolution: plannedResolvedManualResolution,
    window: plannedDateWindow,
  };
}

export function resolveAutoPlanningWindow(options: {
  pendingAutoWindowOverride: DateWindowRange | null;
  renderedAutoView: { window: DateWindowRange } | null;
  canonicalAutoWindow: DateWindowRange | null;
}): DateWindowRange | null {
  return options.pendingAutoWindowOverride
    ?? options.canonicalAutoWindow
    ?? options.renderedAutoView?.window
    ?? null;
}

function buildDateWindowFromIndices(dates: readonly Date[], startIdx: number, endIdx: number): DateWindowRange | null {
  if (dates.length === 0 || endIdx <= startIdx) return null;
  return {
    start: dates[startIdx] ?? null,
    end: dates[endIdx - 1] ?? null,
  };
}

function inferAutoZoomStepMs(
  dates: readonly Date[],
  window: Pick<ReturnType<typeof buildVisibleDateWindowFromRange>, "startIdx" | "endIdx">,
  fallbackWindow: DateWindowRange,
): number {
  const visibleCount = window.endIdx - window.startIdx;
  if (visibleCount >= 2) {
    const start = dates[window.startIdx]?.getTime() ?? null;
    const end = dates[window.endIdx - 1]?.getTime() ?? null;
    if (start !== null && end !== null && end > start) {
      return Math.max((end - start) / Math.max(visibleCount - 1, 1), 1);
    }
  }

  if (dates.length >= 2) {
    return Math.max(getMinimumDateStepMs(dates), 1);
  }

  if (fallbackWindow.start && fallbackWindow.end) {
    return Math.max(fallbackWindow.end.getTime() - fallbackWindow.start.getTime(), 1);
  }

  return 1;
}

export function resolveAutoZoomWindow(options: {
  historyPoints: readonly PricePoint[];
  boundsDates: readonly Date[];
  currentWindow: DateWindowRange | null | undefined;
  direction: "in" | "out";
  anchorRatio: number;
  zoomFactor?: number;
}): DateWindowRange | null {
  const {
    historyPoints,
    boundsDates,
    currentWindow,
    direction,
    anchorRatio,
    zoomFactor = 1.5,
  } = options;

  if (!currentWindow?.start || !currentWindow.end) return currentWindow ?? null;

  const historyDates = getPointDates(historyPoints);
  if (historyDates.length === 0) return currentWindow;

  const currentHistoryWindow = buildVisibleDateWindowFromRange(historyDates, currentWindow, 0);
  const canExpandWithinHistory = direction === "out"
    && (
      currentHistoryWindow.startIdx > 0
      || currentHistoryWindow.endIdx < historyDates.length
    );

  const navigationDates = direction === "out" && !canExpandWithinHistory && boundsDates.length > 0
    ? boundsDates
    : historyDates;
  const currentNavigationWindow = buildVisibleDateWindowFromRange(navigationDates, currentWindow, 0);
  const currentVisibleCount = currentNavigationWindow.endIdx - currentNavigationWindow.startIdx;

  if (currentVisibleCount <= 0) {
    return currentWindow;
  }

  const ratio = clamp(anchorRatio, 0, 1);
  let targetVisibleCount: number;
  if (direction === "in") {
    if (currentVisibleCount <= 2) {
      const currentSpanMs = Math.max(currentWindow.end.getTime() - currentWindow.start.getTime(), 1);
      const targetSpanMs = Math.max(currentSpanMs / zoomFactor, 1);
      const anchorMs = currentWindow.start.getTime() + currentSpanMs * ratio;
      const nextStartMs = anchorMs - targetSpanMs * ratio;
      return {
        start: new Date(nextStartMs),
        end: new Date(nextStartMs + targetSpanMs),
      };
    }
    targetVisibleCount = Math.max(2, Math.floor(currentVisibleCount / zoomFactor));
    if (targetVisibleCount >= currentVisibleCount) {
      targetVisibleCount = currentVisibleCount - 1;
    }
  } else {
    targetVisibleCount = Math.ceil(currentVisibleCount * zoomFactor);
    if (targetVisibleCount <= currentVisibleCount) {
      targetVisibleCount = currentVisibleCount + 1;
    }

    if (targetVisibleCount > navigationDates.length) {
      const stepMs = inferAutoZoomStepMs(navigationDates, currentNavigationWindow, currentWindow);
      const targetSpanMs = Math.max(stepMs * Math.max(targetVisibleCount - 1, 1), stepMs);
      const currentSpanMs = Math.max(currentWindow.end.getTime() - currentWindow.start.getTime(), stepMs);
      const anchorMs = currentWindow.start.getTime() + currentSpanMs * ratio;
      const nextStartMs = anchorMs - targetSpanMs * ratio;

      return {
        start: new Date(nextStartMs),
        end: new Date(nextStartMs + targetSpanMs),
      };
    }
  }

  const anchorIndex = currentNavigationWindow.startIdx + ratio * Math.max(currentVisibleCount - 1, 0);
  let nextStartIdx = clamp(
    Math.round(anchorIndex - ratio * Math.max(targetVisibleCount - 1, 0)),
    0,
    Math.max(navigationDates.length - targetVisibleCount, 0),
  );
  let nextEndIdx = Math.min(nextStartIdx + targetVisibleCount, navigationDates.length);

  if (nextStartIdx === currentNavigationWindow.startIdx && nextEndIdx === currentNavigationWindow.endIdx) {
    if (direction === "in" && currentVisibleCount > 2) {
      nextStartIdx = Math.min(currentNavigationWindow.startIdx + 1, currentNavigationWindow.endIdx - 2);
      nextEndIdx = currentNavigationWindow.endIdx;
    } else if (direction === "out" && currentNavigationWindow.startIdx > 0) {
      nextStartIdx = currentNavigationWindow.startIdx - 1;
      nextEndIdx = currentNavigationWindow.endIdx;
    } else if (direction === "out" && currentNavigationWindow.endIdx < navigationDates.length) {
      nextStartIdx = currentNavigationWindow.startIdx;
      nextEndIdx = currentNavigationWindow.endIdx + 1;
    }
  }

  return buildDateWindowFromIndices(navigationDates, nextStartIdx, nextEndIdx) ?? currentWindow;
}
