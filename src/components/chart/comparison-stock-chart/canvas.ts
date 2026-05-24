import { useMemo, type RefObject } from "react";
import type { BoxRenderable, NativeRendererHost } from "../../../ui";
import type {
  ChartAxisMode,
  ChartMarketSession,
  ComparisonChartSeries,
  ComparisonChartViewState,
} from "../core/types";
import {
  renderNativeComparisonChartBase,
  type NativeCrosshairOverlay,
} from "../native/chart-rasterizer";
import { resolveCanvasBitmapSize, useNativeCanvasBitmaps } from "../native/canvas-bitmaps";
import {
  buildComparisonChartScene,
} from "../comparison/renderer";
import {
  projectComparisonChartData,
} from "../comparison/data";
import { buildComparisonNativeBitmapKey } from "./helpers";
import type { ComparisonChartColors } from "./types";

export function useComparisonChartCanvasBitmaps({
  axisMode,
  bodyMessage,
  canvasCharts,
  cellHeightPx,
  cellWidthPx,
  chartColors,
  chartHeight,
  chartWidth,
  hasChartData,
  isBlockingBody,
  marketSession,
  marketSessionKey,
  nativeCrosshair,
  pixelRatio,
  plotRef,
  projectionViewState,
  renderer,
  selectedSymbol,
  series,
  symbolCount,
}: {
  axisMode: ChartAxisMode;
  bodyMessage: string | null;
  canvasCharts: boolean;
  cellHeightPx: number;
  cellWidthPx: number;
  chartColors: ComparisonChartColors;
  chartHeight: number;
  chartWidth: number;
  hasChartData: boolean;
  isBlockingBody: boolean;
  marketSession: ChartMarketSession | null;
  marketSessionKey: string;
  nativeCrosshair: NativeCrosshairOverlay | null;
  pixelRatio: number;
  plotRef: RefObject<BoxRenderable | null>;
  projectionViewState: Pick<ComparisonChartViewState, "panOffset" | "renderMode" | "zoomLevel">;
  renderer: NativeRendererHost;
  selectedSymbol: string | null;
  series: ComparisonChartSeries[];
  symbolCount: number;
}) {
  const canvasBitmapSize = useMemo(() => resolveCanvasBitmapSize({
    enabled: canvasCharts,
    cellHeightPx,
    cellWidthPx,
    chartHeight,
    chartWidth,
    pixelRatio,
  }), [canvasCharts, cellHeightPx, cellWidthPx, chartHeight, chartWidth, pixelRatio]);

  const canvasProjection = useMemo(() => (
    canvasBitmapSize
      ? projectComparisonChartData(
        series,
        Math.max(chartWidth, canvasBitmapSize.pixelWidth),
        projectionViewState,
        axisMode,
      )
      : null
  ), [axisMode, canvasBitmapSize, chartWidth, projectionViewState, series]);

  const canvasBaseScene = useMemo(() => (
    canvasProjection
      ? buildComparisonChartScene(canvasProjection, {
        width: Math.max(chartWidth, canvasBitmapSize?.pixelWidth ?? chartWidth),
        height: chartHeight,
        cursorX: null,
        cursorY: null,
        selectedSymbol,
        colors: chartColors,
        marketSession,
      })
      : null
  ), [canvasBitmapSize?.pixelWidth, canvasProjection, chartColors, chartHeight, chartWidth, marketSession, selectedSymbol]);

  const canvasBaseBitmapKey = useMemo(() => {
    if (!canvasBitmapSize || !canvasProjection || !hasChartData || isBlockingBody || bodyMessage) return null;
    return buildComparisonNativeBitmapKey(
      symbolCount,
      canvasProjection,
      selectedSymbol,
      canvasBitmapSize.pixelWidth,
      canvasBitmapSize.pixelHeight,
      [
        chartColors.bgColor,
        chartColors.gridColor,
        chartColors.crosshairColor,
        chartColors.preMarketBgColor,
        chartColors.postMarketBgColor,
      ].join(","),
      marketSessionKey,
    );
  }, [
    bodyMessage,
    canvasBitmapSize,
    canvasProjection,
    chartColors.bgColor,
    chartColors.crosshairColor,
    chartColors.gridColor,
    chartColors.postMarketBgColor,
    chartColors.preMarketBgColor,
    hasChartData,
    isBlockingBody,
    marketSessionKey,
    selectedSymbol,
    symbolCount,
  ]);

  const { canvasCrosshair, plotBitmaps } = useNativeCanvasBitmaps({
    bitmapKey: canvasBaseBitmapKey,
    bitmapSize: canvasBitmapSize,
    nativeCrosshair,
    plotRef,
    renderBase: renderNativeComparisonChartBase,
    renderer,
    scene: canvasBaseScene,
  });

  return {
    canvasBaseBitmapKey,
    canvasCrosshair,
    plotBitmaps,
  };
}
