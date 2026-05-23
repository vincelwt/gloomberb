import { useMemo } from "react";
import { resolveBarSize } from "../chart-data";
import {
  clampDateWindowToBounds,
  getMinimumDateStepMs,
  getTimeRangeForDateWindow,
  type DateWindowRange,
} from "../chart-controller";
import {
  CHART_RESOLUTION_STEP_MS,
  getBestSupportedResolutionForVisibleWindow,
  type ChartResolutionSupport,
  type ManualChartResolution,
} from "../chart-resolution";
import type { ChartResolution, TimeRange } from "../chart-types";
import {
  resolveAutoPlanningWindow,
  type AutoRenderedView,
} from "./auto";

export interface UseStockChartRenderPlanningOptions {
  baseDateBounds: DateWindowRange | null;
  boundsHistoryDates: Date[];
  canonicalAutoWindow: DateWindowRange | null;
  compact?: boolean;
  effectiveResolution: ChartResolution;
  effectiveResolutionSupport: ChartResolutionSupport[];
  hasResolutionSupportApi: boolean;
  manualVisibleDateWindow: DateWindowRange | null;
  measurementChartWidth: number;
  pendingAutoWindowOverride: DateWindowRange | null;
  renderedAutoView: AutoRenderedView | null;
  resolutionSupport: ChartResolutionSupport[] | null;
  supportMap: ReadonlyMap<ManualChartResolution, TimeRange>;
}

export interface UseStockChartRenderPlanningResult {
  autoMinimumSpanMs: number;
  plannedDateWindow: DateWindowRange | null;
  plannedManualResolution: ManualChartResolution | null;
  plannedWindowRange: TimeRange;
}

export function useStockChartRenderPlanning({
  baseDateBounds,
  boundsHistoryDates,
  canonicalAutoWindow,
  compact,
  effectiveResolution,
  effectiveResolutionSupport,
  hasResolutionSupportApi,
  manualVisibleDateWindow,
  measurementChartWidth,
  pendingAutoWindowOverride,
  renderedAutoView,
  resolutionSupport,
  supportMap,
}: UseStockChartRenderPlanningOptions): UseStockChartRenderPlanningResult {
  const autoMinimumSpanMs = useMemo(() => {
    const finestSupportedResolution = effectiveResolutionSupport[0]?.resolution;
    return finestSupportedResolution
      ? CHART_RESOLUTION_STEP_MS[finestSupportedResolution]
      : getMinimumDateStepMs(boundsHistoryDates);
  }, [boundsHistoryDates, effectiveResolutionSupport]);
  const autoPlanningWindow = useMemo(() => (
    effectiveResolution !== "auto"
      ? null
      : resolveAutoPlanningWindow({
        pendingAutoWindowOverride,
        renderedAutoView,
        canonicalAutoWindow,
      })
  ), [canonicalAutoWindow, effectiveResolution, pendingAutoWindowOverride, renderedAutoView]);
  const plannedAutoWindow = useMemo(() => (
    effectiveResolution !== "auto"
      ? null
      : clampDateWindowToBounds(
        autoPlanningWindow,
        baseDateBounds,
        autoMinimumSpanMs,
      )
  ), [
    autoMinimumSpanMs,
    autoPlanningWindow,
    baseDateBounds,
    effectiveResolution,
  ]);
  const plannedAutoResolution = useMemo<ManualChartResolution | null>(() => {
    if (
      compact
      || effectiveResolution !== "auto"
      || !plannedAutoWindow?.start
      || !plannedAutoWindow.end
    ) {
      return null;
    }

    const spanMs = plannedAutoWindow.end.getTime() - plannedAutoWindow.start.getTime();
    if (!Number.isFinite(spanMs) || spanMs < 0) return null;
    if (hasResolutionSupportApi && resolutionSupport === null) return null;
    return hasResolutionSupportApi
      ? getBestSupportedResolutionForVisibleWindow(plannedAutoWindow, supportMap, measurementChartWidth)
      : (resolveBarSize(spanMs) as ManualChartResolution | null);
  }, [compact, plannedAutoWindow, effectiveResolution, hasResolutionSupportApi, measurementChartWidth, resolutionSupport, supportMap]);
  const plannedDateWindow = effectiveResolution === "auto"
    ? plannedAutoWindow
    : manualVisibleDateWindow;
  const plannedManualResolution = effectiveResolution === "auto"
    ? plannedAutoResolution
    : effectiveResolution;
  const plannedWindowRange = useMemo(
    () => getTimeRangeForDateWindow(plannedDateWindow),
    [plannedDateWindow],
  );

  return {
    autoMinimumSpanMs,
    plannedDateWindow,
    plannedManualResolution,
    plannedWindowRange,
  };
}
