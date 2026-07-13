import { memo, useEffect, useMemo, useState } from "react";
import { Text } from "../../../ui";
import { useNativeRenderer, useUiCapabilities } from "../../../ui";
import { blendHex, colors } from "../../../theme/colors";
import { useThemeColors } from "../../../theme/theme-context";
import { usePaneSettingValue } from "../../../state/app/context";
import { useQuoteStreaming } from "../../../state/hooks/quote-streaming";
import {
  appendQuoteToPriceReturnHistory,
  buildPriceReturnFields,
  type PriceReturnField,
} from "../../../market-data/performance";
import type { QuoteSubscriptionTarget } from "../../../types/data-provider";
import {
  type ChartRendererPreference,
  type ChartResolution,
  type ComparisonChartViewState,
  type ResolvedChartRenderer,
} from "../core/types";
import { usePersistChartControlSelection } from "../core/pane-settings";
import {
  DEFAULT_COMPARISON_CHART_RANGE_PRESET,
  DEFAULT_COMPARISON_CHART_RESOLUTION,
} from "../core/resolution";
import {
  getChartMarketSessionKey,
  resolveChartMarketSession,
} from "../market-session";
import { useResolvedChartRendererState } from "../native/renderer-selection";
import { getNativeSurfaceManager } from "../native/surface/manager";
import { resolveComparisonChartAxisWidth } from "./axis-width";
import {
  useComparisonChartRenderData,
  type ComparisonChartSymbolSource,
} from "./render-data";
import { useComparisonChartControls } from "./controls";
import { getInitialComparisonMode } from "./helpers";
import { ComparisonChartToolbar } from "./toolbar";
import { ComparisonChartLegend } from "./legend";
import { useComparisonChartPointerInteractions } from "./interactions";
import { resolveComparisonChartLayoutMetrics } from "./layout-metrics";
import { useComparisonChartRenderOutput } from "./render-output";
import { ComparisonChartLayout } from "./layout";
import { useComparisonChartViewportRuntime } from "./viewport-runtime";
import { useComparisonChartSelectionRuntime } from "./selection-runtime";
import { useComparisonChartSurfaceRuntime } from "./surface-runtime";
import type { ComparisonStockChartProps } from "./types";

interface ComparisonStockChartViewProps extends ComparisonStockChartProps {
  defaultRenderMode: string | undefined;
  preferredRenderer: ChartRendererPreference;
  symbolSources: ComparisonChartSymbolSource[];
}

function useComparisonChartRendererRuntime(
  preferredRenderer: ChartRendererPreference,
): {
  canvasCharts: boolean | undefined;
  cellHeightPx: number;
  cellWidthPx: number;
  effectiveRenderer: ResolvedChartRenderer;
  nativeSurfaceManager: ReturnType<typeof getNativeSurfaceManager>;
  pixelRatio: number;
  renderer: ReturnType<typeof useNativeRenderer>;
  rendererState: ReturnType<typeof useResolvedChartRendererState>;
  showNativeUnavailable: boolean;
  useCanvasChart: boolean;
} {
  const renderer = useNativeRenderer();
  const { canvasCharts, cellWidthPx = 8, cellHeightPx = 18, pixelRatio = 1 } = useUiCapabilities();
  const nativeSurfaceManager = useMemo(() => getNativeSurfaceManager(renderer), [renderer]);
  const rendererState = useResolvedChartRendererState(preferredRenderer, renderer);
  const effectiveRenderer: ResolvedChartRenderer = rendererState.renderer;
  const useCanvasChart = !!canvasCharts && effectiveRenderer !== "kitty";
  const showNativeUnavailable = rendererState.nativeUnavailable && !useCanvasChart;

  return {
    canvasCharts,
    cellHeightPx,
    cellWidthPx,
    effectiveRenderer,
    nativeSurfaceManager,
    pixelRatio,
    renderer,
    rendererState,
    showNativeUnavailable,
    useCanvasChart,
  };
}

function useComparisonChartSettings({
  defaultRenderMode,
  selectedSymbol,
}: {
  defaultRenderMode: string | undefined;
  selectedSymbol: string | null;
}) {
  const [storedRangePreset] = usePaneSettingValue("rangePreset", DEFAULT_COMPARISON_CHART_RANGE_PRESET);
  const [storedResolution] = usePaneSettingValue<ChartResolution>("chartResolution", DEFAULT_COMPARISON_CHART_RESOLUTION);
  const persistChartControls = usePersistChartControlSelection("rangePreset");
  const [viewState, setViewState] = useState<ComparisonChartViewState>({
    presetRange: storedRangePreset,
    bufferRange: storedRangePreset,
    activePreset: storedRangePreset,
    dateWindow: null,
    resolution: storedResolution,
    panOffset: 0,
    zoomLevel: 1,
    cursorX: null,
    cursorY: null,
    renderMode: getInitialComparisonMode(defaultRenderMode),
    selectedSymbol,
  });

  return {
    persistChartControls,
    setViewState,
    storedRangePreset,
    storedResolution,
    viewState,
  };
}

function useComparisonChartPresentation({
  symbolSources,
}: {
  symbolSources: ComparisonChartSymbolSource[];
}) {
  const chartColors = useMemo(() => ({
    bgColor: colors.bg,
    gridColor: blendHex(colors.bg, colors.border, 0.55),
    crosshairColor: colors.borderFocused,
    preMarketBgColor: blendHex(colors.bg, "#1d4ed8", 0.18),
    postMarketBgColor: blendHex(colors.bg, "#b45309", 0.18),
  }), [colors.bg, colors.border, colors.borderFocused]);
  const marketSession = useMemo(() => resolveChartMarketSession(symbolSources.map((source) => ({
    exchange: source.exchange,
    primaryExchange: source.instrument?.primaryExchange,
    currency: source.currency,
    assetCategory: source.instrument?.secType,
  }))), [symbolSources]);
  const marketSessionKey = useMemo(() => getChartMarketSessionKey(marketSession), [marketSession]);

  return {
    chartColors,
    marketSession,
    marketSessionKey,
  };
}

function useComparisonChartQuoteStreaming({
  selectedSymbol,
  symbolSources,
}: {
  selectedSymbol: string | null;
  symbolSources: ComparisonChartSymbolSource[];
}) {
  const streamingTargets = useMemo<QuoteSubscriptionTarget[]>(() => (
    symbolSources.map((source) => ({
      symbol: source.symbol,
      exchange: source.exchange,
      route: "provider" as const,
      context: {
        brokerId: source.brokerId,
        brokerInstanceId: source.brokerInstanceId,
        instrument: source.instrument ?? null,
      },
      surface: "monitor" as const,
      visible: true,
      selected: source.symbol === selectedSymbol,
      weight: source.symbol === selectedSymbol ? 120 : 80,
    }))
  ), [selectedSymbol, symbolSources]);

  useQuoteStreaming(streamingTargets);
}

function getOneYearReturn(fields: readonly PriceReturnField[]): number | null {
  return fields.find((field) => field.id === "1Y")?.value ?? null;
}

function sortSymbolsByOneYearReturn(
  symbols: readonly string[],
  performanceBySymbol: ReadonlyMap<string, PriceReturnField[]>,
): string[] {
  const originalIndex = new Map(symbols.map((symbol, index) => [symbol, index]));
  return [...symbols].sort((left, right) => {
    const leftReturn = getOneYearReturn(performanceBySymbol.get(left) ?? []);
    const rightReturn = getOneYearReturn(performanceBySymbol.get(right) ?? []);
    if (leftReturn != null && rightReturn != null && leftReturn !== rightReturn) {
      return rightReturn - leftReturn;
    }
    if (leftReturn != null && rightReturn == null) return -1;
    if (leftReturn == null && rightReturn != null) return 1;
    return (originalIndex.get(left) ?? 0) - (originalIndex.get(right) ?? 0);
  });
}

function ComparisonStockChartView({
  paneId,
  width,
  height,
  focused,
  symbols,
  axisMode,
  defaultRenderMode,
  preferredRenderer,
  symbolSources,
  onOpenSymbol,
  onEditTickers,
}: ComparisonStockChartViewProps) {
  useThemeColors();
  const {
    canvasCharts,
    cellHeightPx,
    cellWidthPx,
    effectiveRenderer,
    nativeSurfaceManager,
    pixelRatio,
    renderer,
    rendererState,
    showNativeUnavailable,
    useCanvasChart,
  } = useComparisonChartRendererRuntime(preferredRenderer);
  const {
    persistChartControls,
    setViewState,
    storedRangePreset,
    storedResolution,
    viewState,
  } = useComparisonChartSettings({
    defaultRenderMode,
    selectedSymbol: symbols[0] ?? null,
  });

  const {
    axisGap,
    axisRightPadding,
    axisSectionWidthBudget,
    chartHeight,
    legendColumns,
    legendItemWidth,
    legendRows,
    measurementChartWidth,
    minChartWidth,
    minimumAxisWidth,
    timeAxisRows,
  } = resolveComparisonChartLayoutMetrics({
    axisMode,
    height,
    symbolCount: symbols.length,
    width,
  });
  const {
    chartColors,
    marketSession,
    marketSessionKey,
  } = useComparisonChartPresentation({ symbolSources });
  useComparisonChartQuoteStreaming({
    selectedSymbol: viewState.selectedSymbol,
    symbolSources,
  });

  const {
    availableManualResolutions,
    bodyMessage,
    effectiveResolution,
    effectiveResolutionSupport,
    isBlockingBody,
    isUpdating,
    resolutionChips,
    selectionSupportMap,
    performanceHistoryBySymbol,
    series,
    supportMap,
  } = useComparisonChartRenderData({
    symbolSources,
    viewState,
  });
  const performanceBySymbol = useMemo(() => {
    const bySymbol = new Map<string, PriceReturnField[]>();
    for (const source of symbolSources) {
      const baselineHistory = performanceHistoryBySymbol.get(source.symbol) ?? [];
      const sourceHistory = appendQuoteToPriceReturnHistory(
        baselineHistory.length >= 2 ? baselineHistory : source.priceHistory,
        source.quote,
      );
      const fallbackHistory = series.find((entry) => entry.symbol === source.symbol)?.points ?? [];
      bySymbol.set(
        source.symbol,
        buildPriceReturnFields(sourceHistory.length >= 2 ? sourceHistory : fallbackHistory),
      );
    }
    return bySymbol;
  }, [performanceHistoryBySymbol, series, symbolSources]);
  const summarySymbols = useMemo(
    () => sortSymbolsByOneYearReturn(symbols, performanceBySymbol),
    [performanceBySymbol, symbols],
  );

  useEffect(() => {
    if (symbols.includes(viewState.selectedSymbol ?? "")) return;
    setViewState((current) => ({
      ...current,
      selectedSymbol: symbols[0] ?? null,
    }));
  }, [setViewState, symbols, viewState.selectedSymbol]);

  const axisWidth = useMemo(() => resolveComparisonChartAxisWidth({
    axisGap,
    axisMode,
    axisRightPadding,
    axisSectionWidthBudget,
    chartColors,
    chartHeight,
    measurementChartWidth,
    minChartWidth,
    minimumAxisWidth,
    selectedSymbol: viewState.selectedSymbol,
    series,
    viewState,
    width,
  }), [
    axisGap,
    axisMode,
    axisRightPadding,
    axisSectionWidthBudget,
    chartColors,
    chartHeight,
    measurementChartWidth,
    minChartWidth,
    minimumAxisWidth,
    series,
    viewState.panOffset,
    viewState.dateWindow,
    viewState.renderMode,
    viewState.selectedSymbol,
    viewState.zoomLevel,
    width,
  ]);
  const axisSectionWidth = axisWidth + axisRightPadding;
  const chartWidth = Math.max(width - axisSectionWidth - axisGap, minChartWidth);
  const {
    commitSelectionCursor,
    displayCursor,
    displayCursorX,
    displayCursorY,
    focusPaneForMouseInteraction,
    mouseCrosshairDisabledRef,
    plotRef,
    scrollPanCellRemainderRef,
    selectSymbolByOffset,
    setSelectedSymbol,
    updateDisplayCursorTarget,
  } = useComparisonChartSelectionRuntime({
    chartHeight,
    chartWidth,
    cursorX: viewState.cursorX,
    cursorY: viewState.cursorY,
    focused,
    renderer,
    setViewState,
    symbols: summarySymbols,
  });
  const {
    activePreset,
    expandBufferRange,
    pendingCanonicalResetRef,
    projection,
    projectionViewState,
    seriesDates,
    setRangePreset,
    setResolution,
    visibleDateWindow,
    visibleWindow,
  } = useComparisonChartViewportRuntime({
    availableManualResolutions,
    axisMode,
    chartWidth,
    effectiveResolution,
    effectiveResolutionSupport,
    persistChartControls,
    selectionSupportMap,
    series,
    setViewState,
    storedRangePreset,
    storedResolution,
    supportMap,
    updateDisplayCursorTarget,
    viewState,
  });
  const hasChartData = series.some((entry) => entry.points.length > 0);
  const {
    axisLabels,
    cursorAxisLabel,
    cursorRow,
    cursorTimeAxisColumn,
    cursorTimeAxisDate,
    hasDisplayCursor,
    legendActiveIndex,
    result,
    staticScene,
    timeAxisLabel,
  } = useComparisonChartRenderOutput({
    chartColors,
    chartHeight,
    chartWidth,
    displayCursorX,
    displayCursorY,
    effectiveRenderer,
    hasChartData,
    marketSession,
    projection,
    selectedSymbol: viewState.selectedSymbol,
    useCanvasChart,
  });
  useComparisonChartControls({
    chartWidth,
    effectiveResolution,
    expandBufferRange,
    focused,
    legendColumns,
    mouseCrosshairDisabledRef,
    onEditTickers,
    onOpenSymbol,
    pendingCanonicalResetRef,
    resolutionChips,
    selectSymbolByOffset,
    series,
    seriesDates,
    setRangePreset,
    setResolution,
    setViewState,
    supportMap,
    symbols: summarySymbols,
    updateDisplayCursorTarget,
    viewState,
    visibleDateWindow,
    width,
  });

  const {
    handlePlotDown,
    handlePlotDrag,
    handlePlotMove,
    handlePlotScroll,
    resetDrag,
  } = useComparisonChartPointerInteractions({
    chartWidth,
    commitSelectionCursor,
    expandBufferRange,
    focusPaneForMouseInteraction,
    mouseCrosshairDisabledRef,
    plotRef,
    pointCount: projection.dates.length,
    renderer,
    scrollPanCellRemainderRef,
    series,
    seriesDates,
    setViewState,
    updateDisplayCursorTarget,
    viewState,
    visibleDateWindow,
  });

  const {
    canvasCrosshair,
    hasCanvasContent,
    plotBitmaps,
    plotLines,
    pointerEnabled,
  } = useComparisonChartSurfaceRuntime({
    axisMode,
    bodyMessage,
    canvasCharts: !!canvasCharts,
    cellHeightPx,
    cellWidthPx,
    chartColors,
    chartHeight,
    chartWidth,
    displayCursor,
    effectiveRenderer,
    hasChartData,
    isBlockingBody,
    marketSession,
    marketSessionKey,
    nativeReady: rendererState.nativeReady,
    nativeSurfaceManager,
    paneId,
    pixelRatio,
    plotRef,
    projection,
    projectionViewState,
    renderer,
    resultLines: result.lines,
    selectedSymbol: viewState.selectedSymbol,
    series,
    staticScene,
    symbolCount: symbols.length,
    useCanvasChart,
  });

  if (symbols.length === 0) {
    return <Text fg={colors.textDim}>No comparison tickers configured.</Text>;
  }

  return (
    <ComparisonChartLayout
      axisGap={axisGap}
      axisLabels={axisLabels}
      axisSectionWidth={axisSectionWidth}
      axisWidth={axisWidth}
      bodyMessage={bodyMessage}
      canvasCrosshair={canvasCrosshair}
      chartHeight={chartHeight}
      chartWidth={chartWidth}
      cursorAxisLabel={cursorAxisLabel}
      cursorColor={chartColors.crosshairColor}
      cursorPixelX={hasDisplayCursor ? displayCursor.pixelX : null}
      cursorPixelY={hasDisplayCursor ? displayCursor.pixelY : null}
      cursorRow={cursorRow}
      cursorTimeAxisColumn={cursorTimeAxisColumn}
      cursorTimeAxisDate={cursorTimeAxisDate}
      hasCanvasContent={hasCanvasContent}
      isBlockingBody={isBlockingBody}
      legend={(
        <ComparisonChartLegend
          legendActiveIndex={legendActiveIndex}
          legendItemWidth={legendItemWidth}
          legendRows={legendRows}
          onFocusInteraction={focusPaneForMouseInteraction}
          onOpenSymbol={onOpenSymbol}
          onSelectSymbol={setSelectedSymbol}
          performanceBySymbol={performanceBySymbol}
          projection={projection}
          selectedSymbol={viewState.selectedSymbol}
          symbols={summarySymbols}
        />
      )}
      plotBitmaps={plotBitmaps}
      plotLines={plotLines}
      plotRef={plotRef}
      pointerEnabled={pointerEnabled}
      timeAxisDates={visibleWindow.dates}
      timeAxisLabel={timeAxisLabel}
      timeAxisRows={timeAxisRows}
      toolbar={(
        <ComparisonChartToolbar
          activePreset={activePreset}
          availableManualResolutions={availableManualResolutions}
          effectiveResolution={effectiveResolution}
          focusPaneForMouseInteraction={focusPaneForMouseInteraction}
          isUpdating={isUpdating}
          onRangeSelect={setRangePreset}
          onRenderModeSelect={(mode) => setViewState((current) => ({ ...current, renderMode: mode }))}
          onResolutionSelect={setResolution}
          projectionWarning={projection.warning}
          renderMode={viewState.renderMode ?? getInitialComparisonMode(defaultRenderMode)}
          resolutionChips={resolutionChips}
          showNativeUnavailable={showNativeUnavailable}
        />
      )}
      onPlotDown={handlePlotDown}
      onPlotDrag={handlePlotDrag}
      onPlotMove={handlePlotMove}
      onPlotScroll={handlePlotScroll}
      onResetDrag={resetDrag}
    />
  );
}

export const MemoizedComparisonStockChartView = memo(ComparisonStockChartView);
