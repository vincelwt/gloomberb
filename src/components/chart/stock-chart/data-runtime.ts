import { useCallback, useMemo } from "react";
import type { InstrumentRef } from "../../../market-data/request-types";
import type { DataProvider } from "../../../types/data-provider";
import type { PricePoint, TickerFinancials } from "../../../types/financials";
import { appendLiveQuotePoint, resolveStableOhlcProjectionOptions } from "../core/data";
import type { DateWindowRange } from "../core/controller";
import {
  getChartResolutionLabel,
  sortChartResolutions,
  type ChartResolutionSupport,
  type ManualChartResolution,
} from "../core/resolution";
import type {
  ChartResolution,
  TimeRange,
} from "../core/types";
import { useStockChartRenderData } from "./rendering/data";
import type { StockChartViewportState } from "./viewport";

interface UseStockChartDataRuntimeOptions {
  availableManualResolutions: ManualChartResolution[];
  compact?: boolean;
  dataProvider: DataProvider | null | undefined;
  effectiveResolutionSupport: ChartResolutionSupport[];
  financials: TickerFinancials | null;
  hasIndicators: boolean;
  hasResolutionSupportApi: boolean;
  historyOverride?: PricePoint[] | null;
  indicatorBufferRange: TimeRange;
  instrumentRef: InstrumentRef | null;
  measurementChartWidth: number;
  requestedResolution: ChartResolution;
  resolutionSupport: ChartResolutionSupport[] | null;
  supportMap: ReadonlyMap<ManualChartResolution, TimeRange>;
  viewState: StockChartViewportState;
}

export function useStockChartDataRuntime({
  availableManualResolutions,
  compact,
  dataProvider,
  effectiveResolutionSupport,
  financials,
  hasIndicators,
  hasResolutionSupportApi,
  historyOverride = null,
  indicatorBufferRange,
  instrumentRef,
  measurementChartWidth,
  requestedResolution,
  resolutionSupport,
  supportMap,
  viewState,
}: UseStockChartDataRuntimeOptions) {
  const effectiveResolution: ChartResolution = !compact
    && requestedResolution !== "auto"
    && resolutionSupport !== null
    && !supportMap.has(requestedResolution)
    ? "auto"
    : requestedResolution;
  const resolutionChips = useMemo(
    () => sortChartResolutions(["auto", ...availableManualResolutions] as ChartResolution[]),
    [availableManualResolutions],
  );
  const renderData = useStockChartRenderData({
    compact,
    dataProvider,
    effectiveResolution,
    effectiveResolutionSupport,
    fallbackFinancials: financials,
    hasIndicators,
    hasResolutionSupportApi,
    historyOverride,
    indicatorBufferRange,
    instrumentRef,
    measurementChartWidth,
    resolutionSupport,
    supportMap,
    viewState,
  });
  const renderedResolution: ChartResolution = effectiveResolution === "auto"
    ? "auto"
    : (renderData.resolvedManualResolution ?? effectiveResolution);
  const selectedResolution: ChartResolution = requestedResolution === "auto"
    ? "auto"
    : (resolutionChips.includes(requestedResolution) ? requestedResolution : effectiveResolution);
  const fallbackResolutionLabel = selectedResolution !== "auto" && renderedResolution !== selectedResolution
    ? `showing ${getChartResolutionLabel(renderedResolution)}`
    : null;
  const rawHistory = compact
    ? renderData.fallbackPriceHistory
    : (renderData.renderBodyState.data ?? []);
  const history = useMemo(
    () => appendLiveQuotePoint(rawHistory, financials?.quote),
    [financials?.quote, rawHistory],
  );
  const visibleDateWindow = renderData.displayedDateWindow;
  const navigableDateWindow = effectiveResolution === "auto"
    ? (renderData.pendingAutoWindowOverride ?? renderData.displayedDateWindow ?? renderData.plannedDateWindow)
    : visibleDateWindow;
  const navigationOhlcPointCount = !compact && effectiveResolution !== "auto"
    ? renderData.manualVisibleDateWindow.dates.length
    : 0;
  const resolveOhlcProjectionOptions = useCallback((
    pointCount: number,
    sourceIndexOffset: number,
  ) => (
    resolveStableOhlcProjectionOptions({
      pointCount,
      sourceIndexOffset,
      bucketWidth: measurementChartWidth,
      navigationPointCount: navigationOhlcPointCount,
    })
  ), [measurementChartWidth, navigationOhlcPointCount]);

  return {
    ...renderData,
    effectiveResolution,
    fallbackResolutionLabel,
    history,
    navigableDateWindow,
    navigationOhlcPointCount,
    renderedResolution,
    resolutionChips,
    resolveOhlcProjectionOptions,
    selectedResolution,
    visibleDateWindow,
  };
}
