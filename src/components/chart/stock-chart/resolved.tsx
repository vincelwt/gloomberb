import { memo, type ComponentProps } from "react";
import { useStockChartFooter } from "./footer";
import { useStockChartKeyboardShortcuts } from "./keyboard";
import { useStockChartControlRenderInvalidation } from "./rendering/invalidation";
import { useStockChartRenderOutput } from "./rendering/output";
import { useStockChartSurfaceRuntime } from "./surface-runtime";
import { StockChartView } from "./view";
import { useResolvedStockChartRuntime } from "./resolved/runtime";
import type { ResolvedStockChartProps } from "./types";

type StockChartViewProps = ComponentProps<typeof StockChartView>;
type ResolvedStockChartRuntime = ReturnType<typeof useResolvedStockChartRuntime>;
type ResolvedStockChartRender = ReturnType<typeof useResolvedStockChartRender>;
type ResolvedStockChartSurface = ReturnType<typeof useResolvedStockChartSurface>;

function useResolvedStockChartKeyboard(runtime: ResolvedStockChartRuntime): void {
  const {
    compact,
    focused,
    interactive,
    dataRuntime,
    geometryRuntime,
    interactionRuntime,
    projectionModel,
    resolutionRuntime,
    settings,
    viewportRuntime,
  } = runtime;

  useStockChartKeyboardShortcuts({
    boundsHistory: dataRuntime.boundsHistory,
    boundsHistoryDates: dataRuntime.boundsHistoryDates,
    chartWidth: geometryRuntime.chartWidth,
    commitSelectionCursor: viewportRuntime.commitSelectionCursor,
    compact,
    cursorMotionKindRef: interactionRuntime.cursorMotionKindRef,
    effectiveResolution: dataRuntime.effectiveResolution,
    expandBufferRange: viewportRuntime.expandBufferRange,
    focused,
    history: dataRuntime.history,
    interactive,
    maxCursorX: geometryRuntime.maxCursorX,
    mouseCrosshairDisabledRef: interactionRuntime.mouseCrosshairDisabledRef,
    navigableDateWindow: dataRuntime.navigableDateWindow,
    panStep: geometryRuntime.panStep,
    pendingAutoWindowRef: interactionRuntime.pendingAutoWindowRef,
    pendingCanonicalResetRef: interactionRuntime.pendingCanonicalResetRef,
    persistRenderMode: viewportRuntime.persistRenderMode,
    projection: projectionModel.projection,
    requestAutoWindow: viewportRuntime.requestAutoWindow,
    resolutionChips: dataRuntime.resolutionChips,
    selectedResolution: dataRuntime.selectedResolution,
    selectionSupportMap: resolutionRuntime.selectionSupportMap,
    setPendingAutoWindowOverride: dataRuntime.setPendingAutoWindowOverride,
    setRange: viewportRuntime.setRange,
    setRenderedAutoView: dataRuntime.setRenderedAutoView,
    setResolution: viewportRuntime.setResolution,
    setViewState: settings.setViewState,
    updateDisplayCursorTarget: interactionRuntime.updateDisplayCursorTarget,
    viewState: settings.viewState,
    visibleDateWindow: dataRuntime.visibleDateWindow,
  });
}

function useResolvedStockChartRender(runtime: ResolvedStockChartRuntime) {
  const {
    axisMode,
    chartAssetCategory,
    chartCurrency,
    compact,
    dataRuntime,
    geometryRuntime,
    interactionRuntime,
    layoutMetrics,
    presentationRuntime,
    projectionModel,
    rendererRuntime,
    showVolume,
  } = runtime;

  const output = useStockChartRenderOutput({
    axisMode,
    chartAssetCategory,
    chartColors: presentationRuntime.chartColors,
    chartCurrency,
    chartHeight: layoutMetrics.chartHeight,
    chartWidth: geometryRuntime.chartWidth,
    compact,
    displayCursor: interactionRuntime.displayCursor,
    displayCursorX: geometryRuntime.displayCursorX,
    displayCursorY: geometryRuntime.displayCursorY,
    effectiveRenderer: rendererRuntime.effectiveRenderer,
    indicators: projectionModel.indicators,
    interactive: runtime.interactive,
    marketSession: presentationRuntime.marketSession,
    projection: projectionModel.projection,
    selectionCursorX: geometryRuntime.selectionCursorX,
    selectionCursorY: geometryRuntime.selectionCursorY,
    showVolume,
    timeAxisDates: projectionModel.timeAxisDates,
    useCanvasChart: rendererRuntime.useCanvasChart,
    volumeHeight: layoutMetrics.volumeHeight,
  });

  const status = {
    bodyMessage: compact
      ? null
      : (dataRuntime.renderBodyState.errorMessage ?? dataRuntime.renderBodyState.emptyMessage),
    hasHistory: projectionModel.chartWindow.points.length > 0,
    isBlockingBody: !compact && dataRuntime.renderBodyState.blocking,
    isUpdating: !compact && (dataRuntime.renderBodyState.updating || dataRuntime.boundsBodyState.updating),
    requestedMode: projectionModel.projection.requestedMode,
  };

  return { output, status };
}

function useResolvedStockChartControls(
  { footerHints }: ResolvedStockChartProps,
  runtime: ResolvedStockChartRuntime,
  render: ResolvedStockChartRender,
): void {
  const {
    chartAssetCategory,
    chartCurrency,
    compact,
    dataRuntime,
    interactionRuntime,
    projectionModel,
    rendererRuntime,
    resolutionRuntime,
    settings,
    viewportRuntime,
    width,
  } = runtime;
  const { output, status } = render;

  useStockChartFooter({
    activePoint: output.activePoint,
    activePreset: viewportRuntime.activePreset,
    boundsHistory: dataRuntime.boundsHistory,
    boundsHistoryDates: dataRuntime.boundsHistoryDates,
    chartAssetCategory,
    chartCurrency,
    compact,
    effectiveResolution: dataRuntime.effectiveResolution,
    footerHints,
    history: dataRuntime.history,
    navigableDateWindow: dataRuntime.navigableDateWindow,
    pendingAutoWindowRef: interactionRuntime.pendingAutoWindowRef,
    pendingCanonicalResetRef: interactionRuntime.pendingCanonicalResetRef,
    persistRenderMode: viewportRuntime.persistRenderMode,
    projectionMode: projectionModel.projection.effectiveMode,
    requestAutoWindow: viewportRuntime.requestAutoWindow,
    resolutionChips: dataRuntime.resolutionChips,
    selectedResolution: dataRuntime.selectedResolution,
    selectionSupportMap: resolutionRuntime.selectionSupportMap,
    setPendingAutoWindowOverride: dataRuntime.setPendingAutoWindowOverride,
    setRange: viewportRuntime.setRange,
    setRenderedAutoView: dataRuntime.setRenderedAutoView,
    setResolution: viewportRuntime.setResolution,
    setViewState: settings.setViewState,
    showOhlcSummary: output.showOhlcSummary,
    updateDisplayCursorTarget: interactionRuntime.updateDisplayCursorTarget,
    visibleDateWindow: dataRuntime.visibleDateWindow,
    visiblePriceRange: output.visiblePriceRange,
    width,
  });

  useStockChartControlRenderInvalidation({
    activePreset: viewportRuntime.activePreset,
    bodyMessage: status.bodyMessage,
    fallbackResolutionLabel: dataRuntime.fallbackResolutionLabel,
    isUpdating: status.isUpdating,
    renderer: rendererRuntime.renderer,
    selectedResolution: dataRuntime.selectedResolution,
  });
}

function useResolvedStockChartSurface(
  runtime: ResolvedStockChartRuntime,
  render: ResolvedStockChartRender,
) {
  const {
    axisMode,
    compact,
    dataRuntime,
    geometryRuntime,
    interactionRuntime,
    layoutMetrics,
    onActivate,
    presentationRuntime,
    projectionModel,
    rendererRuntime,
    settings,
    showVolume,
    viewportRuntime,
  } = runtime;
  const { output, status } = render;

  return useStockChartSurfaceRuntime({
    axisMode,
    bodyMessage: status.bodyMessage,
    boundsHistory: dataRuntime.boundsHistory,
    canvasCharts: !!rendererRuntime.canvasCharts,
    cellHeightPx: rendererRuntime.cellHeightPx,
    cellWidthPx: rendererRuntime.cellWidthPx,
    chartColors: presentationRuntime.chartColors,
    chartHeight: layoutMetrics.chartHeight,
    chartWidth: geometryRuntime.chartWidth,
    chartWindowPoints: projectionModel.chartWindow.points,
    chartWindowStartIdx: projectionModel.chartWindow.startIdx,
    compact,
    commitDisplayCursor: interactionRuntime.commitDisplayCursor,
    commitSelectionCursor: viewportRuntime.commitSelectionCursor,
    cursorMotionKindRef: interactionRuntime.cursorMotionKindRef,
    displayCursorRef: interactionRuntime.displayCursorRef,
    effectiveRenderer: rendererRuntime.effectiveRenderer,
    effectiveResolution: dataRuntime.effectiveResolution,
    expandBufferRange: viewportRuntime.expandBufferRange,
    focusPaneForMouseInteraction: interactionRuntime.focusPaneForMouseInteraction,
    hasHistory: status.hasHistory,
    indicatorRenderKey: projectionModel.indicatorRenderKey,
    interactive: runtime.interactive,
    isBlockingBody: status.isBlockingBody,
    marketSession: presentationRuntime.marketSession,
    marketSessionKey: presentationRuntime.marketSessionKey,
    mouseCrosshairDisabledRef: interactionRuntime.mouseCrosshairDisabledRef,
    nativeBaseScene: output.nativeBaseScene,
    nativeCrosshair: output.nativeCrosshair,
    nativeShowVolume: showVolume && !compact,
    navigableDateWindow: dataRuntime.navigableDateWindow,
    navigationOhlcPointCount: dataRuntime.navigationOhlcPointCount,
    onActivate,
    paneId: interactionRuntime.paneId,
    pixelRatio: rendererRuntime.pixelRatio,
    plotRef: interactionRuntime.plotRef,
    pointCount: projectionModel.projection.points.length,
    projectionMode: projectionModel.projection.effectiveMode,
    projectionPoints: projectionModel.projection.points,
    renderMode: settings.viewState.renderMode,
    renderer: rendererRuntime.renderer,
    rendererNativeReady: rendererRuntime.rendererState.nativeReady,
    requestAutoWindow: viewportRuntime.requestAutoWindow,
    resultLines: output.result.lines,
    scrollPanCellRemainderRef: interactionRuntime.scrollPanCellRemainderRef,
    selectionCursorX: geometryRuntime.selectionCursorX,
    selectionCursorY: geometryRuntime.selectionCursorY,
    selectionSceneCursorY: output.selectionScene?.cursorY ?? null,
    showVolume,
    snappedSelectionCursorX: output.snappedSelectionCursorX,
    sourceIndicatorOverlays: projectionModel.sourceIndicatorOverlays,
    setViewState: settings.setViewState,
    targetCursorRef: interactionRuntime.targetCursorRef,
    timeAxisDates: projectionModel.timeAxisDates,
    updateDisplayCursorTarget: interactionRuntime.updateDisplayCursorTarget,
    viewState: settings.viewState,
    volumeHeight: layoutMetrics.volumeHeight,
  });
}

function createResolvedStockChartViewProps(
  runtime: ResolvedStockChartRuntime,
  render: ResolvedStockChartRender,
  surface: ResolvedStockChartSurface,
): StockChartViewProps {
  const {
    compact,
    dataRuntime,
    geometryRuntime,
    interactionRuntime,
    layoutMetrics,
    presentationRuntime,
    projectionModel,
    rendererRuntime,
    resolutionRuntime,
    viewportRuntime,
  } = runtime;
  const { output, status } = render;

  return {
    activePreset: viewportRuntime.activePreset,
    axisGap: layoutMetrics.axisGap,
    axisLabels: output.axisLabels,
    axisSectionWidth: geometryRuntime.axisSectionWidth,
    axisWidth: geometryRuntime.axisWidth,
    availableManualResolutions: resolutionRuntime.availableManualResolutions,
    bodyMessage: status.bodyMessage,
    canvasBaseBitmapKey: surface.canvasBaseBitmapKey,
    canvasCrosshair: surface.canvasCrosshair,
    chartColors: presentationRuntime.chartColors,
    chartHeight: layoutMetrics.chartHeight,
    chartWidth: geometryRuntime.chartWidth,
    compact,
    cursorAxisLabel: output.cursorAxisLabel,
    cursorPixelX: interactionRuntime.displayCursor.pixelX,
    cursorPixelY: interactionRuntime.displayCursor.pixelY,
    cursorRow: output.cursorRow,
    cursorTimeAxisColumn: output.cursorTimeAxisColumn,
    cursorTimeAxisDate: output.cursorTimeAxisDate,
    fallbackMode: projectionModel.projection.fallbackMode,
    fallbackResolutionLabel: dataRuntime.fallbackResolutionLabel,
    focusPaneForMouseInteraction: interactionRuntime.focusPaneForMouseInteraction,
    hasDisplayCursor: output.hasDisplayCursor,
    hasHistory: status.hasHistory,
    isBlockingBody: status.isBlockingBody,
    isUpdating: status.isUpdating,
    plotBitmaps: surface.plotBitmaps,
    plotLines: surface.plotLines,
    plotRef: interactionRuntime.plotRef,
    requestedMode: status.requestedMode,
    resolutionChips: dataRuntime.resolutionChips,
    selectedResolution: dataRuntime.selectedResolution,
    setRange: viewportRuntime.setRange,
    setRenderMode: viewportRuntime.setRenderMode,
    setResolution: viewportRuntime.setResolution,
    showNativeUnavailable: rendererRuntime.showNativeUnavailable,
    timeAxisDates: projectionModel.timeAxisDates,
    timeAxisLabel: output.timeAxisLabel,
    useCanvasChart: rendererRuntime.useCanvasChart,
    onPlotDown: surface.handlePlotDown,
    onPlotDrag: surface.handlePlotDrag,
    onPlotMove: surface.handlePlotMove,
    onPlotScroll: surface.handlePlotScroll,
    onResetDrag: surface.resetDrag,
  };
}

export const ResolvedStockChart = memo(function ResolvedStockChart(props: ResolvedStockChartProps) {
  const runtime = useResolvedStockChartRuntime(props);
  useResolvedStockChartKeyboard(runtime);
  const render = useResolvedStockChartRender(runtime);
  useResolvedStockChartControls(props, runtime, render);
  const surface = useResolvedStockChartSurface(runtime, render);

  return <StockChartView {...createResolvedStockChartViewProps(runtime, render, surface)} />;
});
