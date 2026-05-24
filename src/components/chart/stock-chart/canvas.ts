import { useMemo, type RefObject } from "react";
import type { BoxRenderable, NativeRendererHost } from "../../../ui";
import type { PricePoint } from "../../../types/financials";
import {
  projectChartData,
  resolveStableOhlcProjectionOptions,
} from "../chart-data";
import { buildChartScene, type ResolvedChartPalette } from "../chart-renderer";
import type {
  ChartAxisMode,
  ChartIndicatorOverlays,
  ChartMarketSession,
  ChartRenderMode,
} from "../chart-types";
import {
  renderNativeChartBase,
  type NativeCrosshairOverlay,
} from "../native/chart-rasterizer";
import { useNativeCanvasBitmaps } from "../native/canvas-bitmaps";
import { buildIndicatorRenderKey, reindexIndicatorOverlaysForProjection } from "./indicators";
import { buildNativeBitmapKey } from "./bitmaps";

export function useStockChartCanvasBitmaps({
  axisMode,
  bodyMessage,
  canvasCharts,
  cellHeightPx,
  cellWidthPx,
  chartColors,
  chartHeight,
  chartWidth,
  chartWindowPoints,
  chartWindowStartIdx,
  compact,
  hasHistory,
  isBlockingBody,
  marketSession,
  marketSessionKey,
  nativeCrosshair,
  navigationOhlcPointCount,
  pixelRatio,
  plotRef,
  renderMode,
  renderer,
  showVolume,
  sourceIndicatorOverlays,
  timeAxisDates,
  volumeHeight,
}: {
  axisMode: ChartAxisMode;
  bodyMessage: string | null;
  canvasCharts: boolean;
  cellHeightPx: number;
  cellWidthPx: number;
  chartColors: ResolvedChartPalette;
  chartHeight: number;
  chartWidth: number;
  chartWindowPoints: PricePoint[];
  chartWindowStartIdx: number;
  compact?: boolean;
  hasHistory: boolean;
  isBlockingBody: boolean;
  marketSession: ChartMarketSession | null;
  marketSessionKey: string;
  nativeCrosshair: NativeCrosshairOverlay | null;
  navigationOhlcPointCount: number | null;
  pixelRatio: number;
  plotRef: RefObject<BoxRenderable | null>;
  renderMode: ChartRenderMode | undefined;
  renderer: NativeRendererHost;
  showVolume: boolean;
  sourceIndicatorOverlays: ChartIndicatorOverlays | null;
  timeAxisDates: Array<Date | string | number>;
  volumeHeight: number;
}) {
  const canvasBitmapSize = useMemo(() => {
    if (!canvasCharts) return null;
    const resolutionScale = Math.max(1, pixelRatio);
    return {
      pixelWidth: Math.max(1, Math.round(chartWidth * cellWidthPx * resolutionScale)),
      pixelHeight: Math.max(1, Math.round(chartHeight * cellHeightPx * resolutionScale)),
    };
  }, [canvasCharts, cellHeightPx, cellWidthPx, chartHeight, chartWidth, pixelRatio]);

  const canvasProjection = useMemo(() => {
    if (!canvasBitmapSize) return null;
    const canvasWidth = Math.max(chartWidth, canvasBitmapSize.pixelWidth);
    const canvasOhlcOptions = resolveStableOhlcProjectionOptions({
      pointCount: chartWindowPoints.length,
      sourceIndexOffset: chartWindowStartIdx,
      bucketWidth: canvasWidth,
      navigationPointCount: navigationOhlcPointCount ?? undefined,
    });
    return projectChartData(
      chartWindowPoints,
      canvasWidth,
      renderMode,
      !!compact,
      canvasOhlcOptions,
    );
  }, [
    canvasBitmapSize,
    chartWidth,
    chartWindowPoints,
    chartWindowStartIdx,
    compact,
    navigationOhlcPointCount,
    renderMode,
  ]);

  const canvasIndicators = useMemo(() => (
    sourceIndicatorOverlays && chartWindowPoints.length && canvasProjection?.points.length
      ? reindexIndicatorOverlaysForProjection(
        sourceIndicatorOverlays,
        chartWindowPoints,
        canvasProjection.points,
        chartWindowStartIdx,
      )
      : null
  ), [canvasProjection?.points, chartWindowPoints, chartWindowStartIdx, sourceIndicatorOverlays]);

  const canvasIndicatorRenderKey = useMemo(() => buildIndicatorRenderKey(canvasIndicators), [canvasIndicators]);

  const canvasBaseScene = useMemo(() => (
    canvasProjection
      ? buildChartScene(canvasProjection.points, {
        width: canvasProjection.points.length,
        height: chartHeight,
        showVolume: showVolume && !compact,
        volumeHeight,
        cursorX: null,
        cursorY: null,
        mode: canvasProjection.effectiveMode,
        axisMode,
        colors: chartColors,
        timeAxisDates,
        indicators: canvasIndicators,
        marketSession,
      })
      : null
  ), [axisMode, canvasIndicators, canvasProjection, chartColors, chartHeight, compact, marketSession, showVolume, timeAxisDates, volumeHeight]);

  const canvasBaseBitmapKey = useMemo(() => {
    if (!canvasBitmapSize || !canvasProjection || !hasHistory || isBlockingBody || bodyMessage) return null;
    return buildNativeBitmapKey(
      canvasProjection.points.length,
      canvasProjection.points,
      canvasBitmapSize.pixelWidth,
      canvasBitmapSize.pixelHeight,
      canvasProjection.effectiveMode,
      showVolume && !compact,
      [
        chartColors.lineColor,
        chartColors.fillColor,
        chartColors.gridColor,
        chartColors.volumeUp,
        chartColors.volumeDown,
        chartColors.candleUp,
        chartColors.candleDown,
        chartColors.preMarketBgColor,
        chartColors.postMarketBgColor,
      ].join(","),
      canvasIndicatorRenderKey,
      marketSessionKey,
    );
  }, [
    bodyMessage,
    canvasBitmapSize,
    canvasIndicatorRenderKey,
    canvasProjection,
    chartColors.candleDown,
    chartColors.candleUp,
    chartColors.fillColor,
    chartColors.gridColor,
    chartColors.lineColor,
    chartColors.postMarketBgColor,
    chartColors.preMarketBgColor,
    chartColors.volumeDown,
    chartColors.volumeUp,
    compact,
    hasHistory,
    isBlockingBody,
    marketSessionKey,
    showVolume,
  ]);

  const { canvasCrosshair, plotBitmaps } = useNativeCanvasBitmaps({
    bitmapKey: canvasBaseBitmapKey,
    bitmapSize: canvasBitmapSize,
    nativeCrosshair,
    plotRef,
    renderBase: renderNativeChartBase,
    renderer,
    scene: canvasBaseScene,
  });

  return {
    canvasBaseBitmapKey,
    canvasCrosshair,
    plotBitmaps,
  };
}
