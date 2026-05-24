import { useMemo } from "react";
import type { DisplayCursorState } from "../../core/pointer";
import type { ChartProjection } from "../../core/data";
import {
  buildChartScene,
  formatCursorAxisValue,
  getPointTerminalColumn,
  renderChart,
  type ResolvedChartPalette,
} from "../../core/renderer";
import type {
  ChartAxisMode,
  ChartIndicatorOverlays,
  ChartMarketSession,
  ResolvedChartRenderer,
} from "../../core/types";
import type { NativeCrosshairOverlay } from "../../native/chart-rasterizer";
import { clamp } from "../viewport";

interface UseStockChartRenderOutputOptions {
  axisMode: ChartAxisMode;
  chartAssetCategory?: string;
  chartColors: ResolvedChartPalette;
  chartCurrency: string;
  chartHeight: number;
  chartWidth: number;
  compact?: boolean;
  displayCursor: DisplayCursorState;
  displayCursorX: number | null;
  displayCursorY: number | null;
  effectiveRenderer: ResolvedChartRenderer;
  indicators: ChartIndicatorOverlays | null;
  interactive?: boolean;
  marketSession: ChartMarketSession | null;
  projection: ChartProjection;
  selectionCursorX: number | null;
  selectionCursorY: number | null;
  showVolume: boolean;
  timeAxisDates: Array<Date | string | number>;
  useCanvasChart: boolean;
  volumeHeight: number;
}

export function useStockChartRenderOutput({
  axisMode,
  chartAssetCategory,
  chartColors,
  chartCurrency,
  chartHeight,
  chartWidth,
  compact,
  displayCursor,
  displayCursorX,
  displayCursorY,
  effectiveRenderer,
  indicators,
  interactive,
  marketSession,
  projection,
  selectionCursorX,
  selectionCursorY,
  showVolume,
  timeAxisDates,
  useCanvasChart,
  volumeHeight,
}: UseStockChartRenderOutputOptions) {
  const renderVolume = showVolume && !compact;
  const renderMode = projection.effectiveMode;

  const selectionScene = useMemo(() => buildChartScene(projection.points, {
    width: chartWidth,
    height: chartHeight,
    showVolume: renderVolume,
    volumeHeight,
    cursorX: selectionCursorX,
    cursorY: selectionCursorY,
    mode: renderMode,
    axisMode,
    colors: chartColors,
    timeAxisDates,
    marketSession,
  }), [
    axisMode,
    chartColors,
    chartHeight,
    chartWidth,
    marketSession,
    projection.points,
    renderMode,
    renderVolume,
    selectionCursorX,
    selectionCursorY,
    timeAxisDates,
    volumeHeight,
  ]);

  const displayScene = useMemo(() => buildChartScene(projection.points, {
    width: chartWidth,
    height: chartHeight,
    showVolume: renderVolume,
    volumeHeight,
    cursorX: displayCursorX,
    cursorY: displayCursorY,
    mode: renderMode,
    axisMode,
    colors: chartColors,
    timeAxisDates,
    indicators,
    marketSession,
  }), [
    axisMode,
    chartColors,
    chartHeight,
    chartWidth,
    displayCursorX,
    displayCursorY,
    indicators,
    marketSession,
    projection.points,
    renderMode,
    renderVolume,
    timeAxisDates,
    volumeHeight,
  ]);

  const snappedSelectionCursorX = selectionScene
    ? getPointTerminalColumn(selectionScene.activeIdx, projection.points.length, chartWidth, renderMode)
    : null;

  const nativeBaseScene = useMemo(() => buildChartScene(projection.points, {
    width: chartWidth,
    height: chartHeight,
    showVolume: renderVolume,
    volumeHeight,
    cursorX: null,
    cursorY: null,
    mode: renderMode,
    axisMode,
    colors: chartColors,
    timeAxisDates,
    indicators,
    marketSession,
  }), [
    axisMode,
    chartColors,
    chartHeight,
    chartWidth,
    indicators,
    marketSession,
    projection.points,
    renderMode,
    renderVolume,
    timeAxisDates,
    volumeHeight,
  ]);

  const staticResult = useMemo(() => renderChart(projection.points, {
    width: chartWidth,
    height: chartHeight,
    showVolume: renderVolume,
    volumeHeight,
    cursorX: null,
    cursorY: null,
    mode: renderMode,
    axisMode,
    currency: chartCurrency,
    assetCategory: chartAssetCategory,
    colors: chartColors,
    timeAxisDates,
    indicators,
    marketSession,
  }), [
    axisMode,
    chartAssetCategory,
    chartColors,
    chartCurrency,
    chartHeight,
    chartWidth,
    indicators,
    marketSession,
    projection.points,
    renderMode,
    renderVolume,
    timeAxisDates,
    volumeHeight,
  ]);

  const interactiveResult = useMemo(() => (
    effectiveRenderer === "kitty" || useCanvasChart
      ? null
      : renderChart(projection.points, {
        width: chartWidth,
        height: chartHeight,
        showVolume: renderVolume,
        volumeHeight,
        cursorX: displayCursorX,
        cursorY: displayCursorY,
        mode: renderMode,
        axisMode,
        currency: chartCurrency,
        assetCategory: chartAssetCategory,
        colors: chartColors,
        timeAxisDates,
        indicators,
        marketSession,
      })
  ), [
    axisMode,
    chartAssetCategory,
    chartColors,
    chartCurrency,
    chartHeight,
    chartWidth,
    displayCursorX,
    displayCursorY,
    effectiveRenderer,
    indicators,
    marketSession,
    projection.points,
    renderMode,
    renderVolume,
    timeAxisDates,
    useCanvasChart,
    volumeHeight,
  ]);

  const result = effectiveRenderer === "kitty" || useCanvasChart ? staticResult : interactiveResult!;
  const usesRasterCursor = effectiveRenderer === "kitty" || useCanvasChart;
  const rasterCursorRow = usesRasterCursor && displayCursorY !== null && nativeBaseScene
    ? Math.round(clamp(displayCursorY, 0, Math.max(nativeBaseScene.chartRows - 1, 0)))
    : null;
  const rasterCrosshairPrice = usesRasterCursor && displayCursorY !== null && nativeBaseScene
    ? nativeBaseScene.max
      - (clamp(displayCursorY, 0, Math.max(nativeBaseScene.chartRows - 1, 0)) / Math.max(nativeBaseScene.chartRows - 1, 1))
      * (nativeBaseScene.max - nativeBaseScene.min)
    : null;
  const cursorRow = usesRasterCursor ? rasterCursorRow : result.cursorRow;
  const crosshairPrice = usesRasterCursor ? rasterCrosshairPrice : result.crosshairPrice;

  const nativeCrosshair = useMemo<NativeCrosshairOverlay | null>(() => {
    if (!interactive || displayCursor.cellX === null || displayCursor.cellY === null) return null;
    return {
      width: chartWidth,
      height: chartHeight,
      chartRows: chartHeight - (showVolume && !compact ? volumeHeight : 0),
      pixelX: displayCursor.pixelX,
      pixelY: displayCursor.pixelY,
      colors: {
        crosshairColor: chartColors.crosshairColor,
      },
    };
  }, [
    chartColors.crosshairColor,
    chartHeight,
    chartWidth,
    compact,
    displayCursor.cellX,
    displayCursor.cellY,
    displayCursor.pixelX,
    displayCursor.pixelY,
    interactive,
    showVolume,
    volumeHeight,
  ]);

  const showOhlcSummary = renderMode === "candles" || renderMode === "ohlc" || renderMode === "hlc";
  const hasDisplayCursor = displayCursorX !== null && displayCursorY !== null;
  const activePoint = showOhlcSummary ? (selectionScene?.activePoint ?? null) : null;
  const visiblePriceRange = selectionScene
    ? Math.max(selectionScene.max - selectionScene.min, 0)
    : (staticResult.priceRange ?? undefined);
  const axisLabels = new Map(staticResult.axisLabels.map((entry) => [entry.row, entry.label]));
  const cursorAxisLabel = hasDisplayCursor && cursorRow !== null && crosshairPrice !== null
    ? formatCursorAxisValue(
      crosshairPrice,
      axisMode,
      projection.points[0]?.close ?? 0,
      chartCurrency,
      chartAssetCategory,
      visiblePriceRange,
    )
    : null;

  return {
    activePoint,
    axisLabels,
    crosshairPrice,
    cursorAxisLabel,
    cursorRow,
    cursorTimeAxisColumn: hasDisplayCursor ? displayScene?.cursorColumn ?? null : null,
    cursorTimeAxisDate: hasDisplayCursor ? displayScene?.dateAtCursor ?? null : null,
    displayScene,
    hasDisplayCursor,
    nativeBaseScene,
    nativeCrosshair,
    result,
    selectionScene,
    showOhlcSummary,
    snappedSelectionCursorX,
    staticResult,
    timeAxisLabel: selectionScene?.timeLabels ?? staticResult.timeLabels,
    visiblePriceRange,
  };
}
