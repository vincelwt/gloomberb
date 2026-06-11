import { useMemo } from "react";
import {
  instrumentFromTicker,
  quoteSubscriptionTargetFromInstrument,
  type InstrumentRef,
} from "../../../../market-data/request-types";
import { getSharedMarketData } from "../../../../plugins/registry";
import { useAppSelector } from "../../../../state/app/context";
import { useQuoteStreaming } from "../../../../state/hooks/quote-streaming";
import { useNativeRenderer, useUiCapabilities } from "../../../../ui";
import { useStockChartDataRuntime } from "../data-runtime";
import { useStockChartGeometry } from "../geometry";
import { useStockChartInteractionRuntime } from "../interaction-runtime";
import { resolveStockChartLayoutMetrics } from "../layout-metrics";
import { useStockChartPresentation } from "../presentation";
import { useStockChartProjectionModel } from "../rendering/projection";
import { useStockChartDataRenderInvalidation } from "../rendering/invalidation";
import { useStockChartResolutionSupport } from "../resolution-support";
import { useStockChartSettings } from "../settings";
import { useResolvedChartRendererState } from "../../native/renderer-selection";
import type { ChartRenderMode, ResolvedChartRenderer } from "../../core/types";
import type { PricePoint } from "../../../../types/financials";
import type { ResolvedStockChartProps } from "../types";
import { useStockChartViewportRuntime } from "../viewport/runtime";

function useStockChartRendererRuntime(): {
  canvasCharts: boolean | undefined;
  cellHeightPx: number;
  cellWidthPx: number;
  defaultRenderMode: ChartRenderMode;
  effectiveRenderer: ResolvedChartRenderer;
  fractionalViewport: boolean;
  pixelRatio: number;
  renderer: ReturnType<typeof useNativeRenderer>;
  rendererState: ReturnType<typeof useResolvedChartRendererState>;
  showNativeUnavailable: boolean;
  useCanvasChart: boolean;
} {
  const renderer = useNativeRenderer();
  const {
    canvasCharts,
    cellWidthPx = 8,
    cellHeightPx = 18,
    pixelRatio = 1,
    fractionalViewport = false,
  } = useUiCapabilities();
  const config = useAppSelector((state) => state.config);
  const defaultRenderMode = config.chartPreferences.defaultRenderMode;
  const preferredRenderer = config.chartPreferences.renderer;
  const rendererState = useResolvedChartRendererState(preferredRenderer, renderer);
  const effectiveRenderer: ResolvedChartRenderer = rendererState.renderer;
  const useCanvasChart = !!canvasCharts && effectiveRenderer !== "kitty";
  const showNativeUnavailable = rendererState.nativeUnavailable && !useCanvasChart;

  return {
    canvasCharts,
    cellHeightPx,
    cellWidthPx,
    defaultRenderMode,
    effectiveRenderer,
    fractionalViewport,
    pixelRatio,
    renderer,
    rendererState,
    showNativeUnavailable,
    useCanvasChart,
  };
}

function useStockChartQuoteStreaming({
  compact,
  focused,
  historyOverride,
  instrumentRef,
}: {
  compact?: boolean;
  focused: boolean;
  historyOverride?: PricePoint[] | null;
  instrumentRef: InstrumentRef | null;
}) {
  const streamingTargets = useMemo(() => {
    if (historyOverride || compact) return [];
    const target = quoteSubscriptionTargetFromInstrument(instrumentRef, "provider");
    return target
      ? [{
        ...target,
        surface: "detail" as const,
        visible: true,
        selected: focused,
        weight: focused ? 120 : 80,
      }]
      : [];
  }, [
    compact,
    focused,
    historyOverride,
    instrumentRef?.brokerId,
    instrumentRef?.brokerInstanceId,
    instrumentRef?.exchange,
    instrumentRef?.instrument,
    instrumentRef?.symbol,
  ]);

  useQuoteStreaming(streamingTargets);
}

export function useResolvedStockChartRuntime({
  width,
  height,
  focused,
  interactive,
  onActivate,
  compact,
  axisMode = "price",
  historyOverride = null,
  currencyOverride = null,
  indicatorConfig: indicatorConfigOverride,
  showVolume: showVolumeOverride,
  ticker,
  financials,
}: ResolvedStockChartProps) {
  const rendererRuntime = useStockChartRendererRuntime();
  const settings = useStockChartSettings({
    compact,
    defaultRenderMode: rendererRuntime.defaultRenderMode,
    indicatorConfigOverride,
  });
  const renderMode = settings.viewState.renderMode ?? rendererRuntime.defaultRenderMode;
  const instrumentRef = useMemo(
    () => instrumentFromTicker(ticker, ticker?.metadata.ticker ?? null),
    [ticker],
  );
  const dataProvider = getSharedMarketData();
  const resolutionRuntime = useStockChartResolutionSupport({
    compact,
    dataProvider,
    instrumentRef,
  });
  const showVolume = showVolumeOverride ?? !compact;
  const interactionRuntime = useStockChartInteractionRuntime({ focused });

  useStockChartQuoteStreaming({
    compact,
    focused,
    historyOverride,
    instrumentRef,
  });

  const layoutMetrics = resolveStockChartLayoutMetrics({
    axisMode,
    compact,
    effectiveRenderer: rendererRuntime.effectiveRenderer,
    fractionalViewport: rendererRuntime.fractionalViewport,
    height,
    showVolume,
    useCanvasChart: rendererRuntime.useCanvasChart,
    width,
  });
  const chartCurrency = currencyOverride ?? financials?.quote?.currency ?? ticker?.metadata.currency ?? "USD";
  const chartAssetCategory = ticker?.metadata.assetCategory;
  const dataRuntime = useStockChartDataRuntime({
    availableManualResolutions: resolutionRuntime.availableManualResolutions,
    compact,
    dataProvider,
    effectiveResolutionSupport: resolutionRuntime.effectiveResolutionSupport,
    financials,
    hasIndicators: settings.hasIndicators,
    hasResolutionSupportApi: resolutionRuntime.hasResolutionSupportApi,
    historyOverride,
    indicatorBufferRange: settings.indicatorBufferRange,
    instrumentRef,
    measurementChartWidth: layoutMetrics.measurementChartWidth,
    requestedResolution: settings.requestedResolution,
    resolutionSupport: resolutionRuntime.resolutionSupport,
    supportMap: resolutionRuntime.supportMap,
    viewState: settings.viewState,
  });
  const geometryRuntime = useStockChartGeometry({
    axisGap: layoutMetrics.axisGap,
    axisMode,
    axisRightPadding: layoutMetrics.axisRightPadding,
    axisSectionWidthBudget: layoutMetrics.axisSectionWidthBudget,
    chartAssetCategory,
    chartCurrency,
    chartHeight: layoutMetrics.chartHeight,
    compact,
    displayedDateWindow: dataRuntime.displayedDateWindow,
    displayCursorCellX: interactionRuntime.displayCursor.cellX,
    displayCursorCellY: interactionRuntime.displayCursor.cellY,
    history: dataRuntime.history,
    historyOverride,
    interactive,
    measurementChartWidth: layoutMetrics.measurementChartWidth,
    minChartWidth: layoutMetrics.minChartWidth,
    minimumAxisWidth: layoutMetrics.minimumAxisWidth,
    renderMode,
    resolveOhlcProjectionOptions: dataRuntime.resolveOhlcProjectionOptions,
    showVolume,
    viewCursorX: settings.viewState.cursorX,
    viewCursorY: settings.viewState.cursorY,
    volumeHeight: layoutMetrics.volumeHeight,
    width,
  });
  const viewportRuntime = useStockChartViewportRuntime({
    availableManualResolutions: resolutionRuntime.availableManualResolutions,
    autoMinimumSpanMs: dataRuntime.autoMinimumSpanMs,
    baseDateBounds: dataRuntime.baseDateBounds,
    boundsHistoryDates: dataRuntime.boundsHistoryDates,
    canonicalAutoWindow: dataRuntime.canonicalAutoWindow,
    chartWidth: geometryRuntime.chartWidth,
    compact,
    cursorMotionKindRef: interactionRuntime.cursorMotionKindRef,
    displayedDateWindow: dataRuntime.displayedDateWindow,
    effectiveResolution: dataRuntime.effectiveResolution,
    effectiveResolutionSupport: resolutionRuntime.effectiveResolutionSupport,
    interactive,
    manualVisibleDateWindow: dataRuntime.manualVisibleDateWindow,
    navigableDateWindow: dataRuntime.navigableDateWindow,
    pendingAutoWindowOverride: dataRuntime.pendingAutoWindowOverride,
    pendingAutoWindowRef: interactionRuntime.pendingAutoWindowRef,
    pendingCanonicalResetRef: interactionRuntime.pendingCanonicalResetRef,
    pendingExpansionRef: interactionRuntime.pendingExpansionRef,
    persistChartControls: settings.persistChartControls,
    persistChartRenderMode: settings.persistChartRenderMode,
    renderedResolution: dataRuntime.renderedResolution,
    selectionSupportMap: resolutionRuntime.selectionSupportMap,
    setPendingAutoWindowOverride: dataRuntime.setPendingAutoWindowOverride,
    setRenderedAutoView: dataRuntime.setRenderedAutoView,
    setRequestedResolution: settings.setRequestedResolution,
    setViewState: settings.setViewState,
    storedRangePreset: settings.storedRangePreset,
    storedRenderMode: settings.storedRenderMode,
    storedResolution: settings.storedResolution,
    supportMap: resolutionRuntime.supportMap,
    updateDisplayCursorTarget: interactionRuntime.updateDisplayCursorTarget,
    viewState: settings.viewState,
    visibleDateWindow: dataRuntime.visibleDateWindow,
  });
  const projectionModel = useStockChartProjectionModel({
    chartWidth: geometryRuntime.chartWidth,
    compact,
    displayedDateWindow: dataRuntime.displayedDateWindow,
    hasIndicators: settings.hasIndicators,
    history: dataRuntime.history,
    historyOverride,
    indicatorConfig: settings.indicatorConfig,
    renderMode,
    resolveOhlcProjectionOptions: dataRuntime.resolveOhlcProjectionOptions,
  });

  useStockChartDataRenderInvalidation({
    chartHeight: layoutMetrics.chartHeight,
    chartWidth: geometryRuntime.chartWidth,
    compact,
    historyRenderKey: projectionModel.historyRenderKey,
    renderMode,
    renderer: rendererRuntime.renderer,
    tickerSymbol: ticker?.metadata.ticker,
  });

  const presentationRuntime = useStockChartPresentation({
    chartWindowPoints: projectionModel.projection.points,
    ticker,
  });

  return {
    axisMode,
    chartAssetCategory,
    chartCurrency,
    compact,
    focused,
    height,
    historyOverride,
    interactive,
    onActivate,
    showVolume,
    width,
    dataRuntime,
    geometryRuntime,
    interactionRuntime,
    layoutMetrics,
    presentationRuntime,
    projectionModel,
    rendererRuntime,
    resolutionRuntime,
    settings,
    viewportRuntime,
  };
}
