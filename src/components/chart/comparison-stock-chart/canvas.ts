import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { BoxRenderable, NativeRendererHost } from "../../../ui";
import {
  cancelAnimationFrameSafe,
  getRenderablePixelSize,
  requestAnimationFrameSafe,
  scaleLocalPixelCoordinate,
} from "../chart-pointer";
import type {
  ChartAxisMode,
  ChartMarketSession,
  ComparisonChartSeries,
  ComparisonChartViewState,
} from "../chart-types";
import {
  renderNativeComparisonChartBase,
  type NativeChartBitmap,
  type NativeCrosshairOverlay,
} from "../native/chart-rasterizer";
import {
  buildComparisonChartScene,
} from "../comparison-chart-renderer";
import {
  projectComparisonChartData,
} from "../comparison-chart-data";
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
  const [canvasBaseBitmapState, setCanvasBaseBitmapState] = useState<{ key: string; bitmap: NativeChartBitmap } | null>(null);
  const lastCanvasBaseBitmapRef = useRef<{ key: string; bitmap: NativeChartBitmap } | null>(null);

  const canvasBitmapSize = useMemo(() => {
    if (!canvasCharts) return null;
    const resolutionScale = Math.max(1, pixelRatio);
    return {
      pixelWidth: Math.max(1, Math.round(chartWidth * cellWidthPx * resolutionScale)),
      pixelHeight: Math.max(1, Math.round(chartHeight * cellHeightPx * resolutionScale)),
    };
  }, [canvasCharts, cellHeightPx, cellWidthPx, chartHeight, chartWidth, pixelRatio]);

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

  const canvasBaseBitmap = useMemo<NativeChartBitmap | null>(() => {
    return canvasBaseBitmapKey && canvasBaseBitmapState?.key === canvasBaseBitmapKey
      ? canvasBaseBitmapState.bitmap
      : null;
  }, [canvasBaseBitmapKey, canvasBaseBitmapState]);

  const visibleCanvasBaseBitmap = useMemo<NativeChartBitmap | null>(() => {
    if (canvasBaseBitmap) return canvasBaseBitmap;
    if (!canvasBaseBitmapKey || !canvasBitmapSize || !canvasBaseBitmapState) return null;
    return canvasBaseBitmapState.bitmap.width === canvasBitmapSize.pixelWidth
      && canvasBaseBitmapState.bitmap.height === canvasBitmapSize.pixelHeight
      ? canvasBaseBitmapState.bitmap
      : null;
  }, [canvasBaseBitmap, canvasBaseBitmapKey, canvasBaseBitmapState, canvasBitmapSize]);

  useEffect(() => {
    if (!canvasBitmapSize || !canvasBaseBitmapKey || !canvasBaseScene) {
      lastCanvasBaseBitmapRef.current = null;
      setCanvasBaseBitmapState((current) => (current === null ? current : null));
      return;
    }

    const cachedBitmap = lastCanvasBaseBitmapRef.current?.key === canvasBaseBitmapKey
      ? lastCanvasBaseBitmapRef.current.bitmap
      : null;
    if (cachedBitmap) {
      setCanvasBaseBitmapState((current) => (
        current?.key === canvasBaseBitmapKey ? current : { key: canvasBaseBitmapKey, bitmap: cachedBitmap }
      ));
      return;
    }

    let cancelled = false;
    const frame = requestAnimationFrameSafe(() => {
      const bitmap = renderNativeComparisonChartBase(canvasBaseScene, canvasBitmapSize.pixelWidth, canvasBitmapSize.pixelHeight);
      if (cancelled) return;
      lastCanvasBaseBitmapRef.current = { key: canvasBaseBitmapKey, bitmap };
      setCanvasBaseBitmapState((current) => (
        current?.key === canvasBaseBitmapKey ? current : { key: canvasBaseBitmapKey, bitmap }
      ));
    });

    return () => {
      cancelled = true;
      cancelAnimationFrameSafe(frame);
    };
  }, [canvasBaseBitmapKey, canvasBaseScene, canvasBitmapSize]);

  const canvasCrosshair = useMemo(() => {
    if (!canvasBitmapSize || !visibleCanvasBaseBitmap || !nativeCrosshair) return null;
    const renderablePixelSize = getRenderablePixelSize(plotRef.current, renderer);
    const overlayPixelX = scaleLocalPixelCoordinate(
      nativeCrosshair.pixelX,
      renderablePixelSize?.pixelWidth ?? canvasBitmapSize.pixelWidth,
      canvasBitmapSize.pixelWidth,
    );
    const overlayPixelY = scaleLocalPixelCoordinate(
      nativeCrosshair.pixelY,
      renderablePixelSize?.pixelHeight ?? canvasBitmapSize.pixelHeight,
      canvasBitmapSize.pixelHeight,
    );
    if (overlayPixelX === null || overlayPixelY === null) return null;
    return {
      pixelX: overlayPixelX,
      pixelY: overlayPixelY,
      color: nativeCrosshair.colors.crosshairColor,
    };
  }, [canvasBitmapSize, nativeCrosshair, plotRef, renderer, visibleCanvasBaseBitmap]);

  const plotBitmaps = useMemo<NativeChartBitmap[] | null>(() => {
    if (!visibleCanvasBaseBitmap) return null;
    return [visibleCanvasBaseBitmap];
  }, [visibleCanvasBaseBitmap]);

  return {
    canvasBaseBitmapKey,
    canvasCrosshair,
    plotBitmaps,
  };
}
