import { useMemo, type RefObject } from "react";
import type { BoxRenderable, ChartSurfaceProps, NativeRendererHost } from "../../../ui";
import {
  buildBlankPlotLines,
  type DisplayCursorState,
} from "../core/pointer";
import type { StyledContent } from "../core/renderer";
import type { ComparisonChartProjection } from "../comparison/data";
import type { ComparisonChartScene } from "../comparison/renderer";
import type {
  ChartAxisMode,
  ChartMarketSession,
  ComparisonChartSeries,
  ComparisonChartViewState,
  ResolvedChartRenderer,
} from "../core/types";
import type { NativeSurfaceManager } from "../native/surface/manager";
import { useComparisonChartCanvasBitmaps } from "./canvas";
import { useComparisonChartNativeSurfaces } from "./native-surfaces";
import type { ComparisonChartColors } from "./types";

interface UseComparisonChartSurfaceRuntimeOptions {
  axisMode: ChartAxisMode;
  bodyMessage: string | null;
  canvasCharts: boolean;
  cellHeightPx: number;
  cellWidthPx: number;
  chartColors: ComparisonChartColors;
  chartHeight: number;
  chartWidth: number;
  displayCursor: DisplayCursorState;
  effectiveRenderer: ResolvedChartRenderer;
  hasChartData: boolean;
  isBlockingBody: boolean;
  marketSession: ChartMarketSession | null;
  marketSessionKey: string;
  nativeReady: boolean;
  nativeSurfaceManager: NativeSurfaceManager;
  paneId: string;
  pixelRatio: number;
  plotRef: RefObject<BoxRenderable | null>;
  projection: ComparisonChartProjection;
  projectionViewState: Pick<ComparisonChartViewState, "panOffset" | "renderMode" | "zoomLevel">;
  renderer: NativeRendererHost;
  resultLines: StyledContent[];
  selectedSymbol: string | null;
  series: ComparisonChartSeries[];
  staticScene: ComparisonChartScene | null;
  symbolCount: number;
  useCanvasChart: boolean;
}

export function useComparisonChartSurfaceRuntime({
  axisMode,
  bodyMessage,
  canvasCharts,
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
  nativeReady,
  nativeSurfaceManager,
  paneId,
  pixelRatio,
  plotRef,
  projection,
  projectionViewState,
  renderer,
  resultLines,
  selectedSymbol,
  series,
  staticScene,
  symbolCount,
  useCanvasChart,
}: UseComparisonChartSurfaceRuntimeOptions): {
  canvasCrosshair: ChartSurfaceProps["crosshair"];
  hasCanvasContent: boolean;
  plotBitmaps: ChartSurfaceProps["bitmaps"];
  plotLines: StyledContent[];
  pointerEnabled: boolean;
} {
  const nativeCrosshair = useMemo(() => {
    if (displayCursor.cellX === null || displayCursor.cellY === null) return null;
    return {
      width: chartWidth,
      height: chartHeight,
      chartRows: chartHeight,
      pixelX: displayCursor.pixelX,
      pixelY: displayCursor.pixelY,
      colors: {
        crosshairColor: chartColors.crosshairColor,
      },
    };
  }, [chartColors.crosshairColor, chartHeight, chartWidth, displayCursor]);
  const blankPlotLines = useMemo(() => buildBlankPlotLines(chartWidth, chartHeight), [chartHeight, chartWidth]);

  useComparisonChartNativeSurfaces({
    chartColors,
    effectiveRenderer,
    marketSessionKey,
    nativeCrosshair,
    nativeReady,
    nativeSurfaceManager,
    paneId,
    plotRef,
    projection,
    renderer,
    selectedSymbol,
    staticScene,
    symbolCount,
  });

  const {
    canvasBaseBitmapKey,
    canvasCrosshair,
    plotBitmaps,
  } = useComparisonChartCanvasBitmaps({
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
  });

  const plotLines = effectiveRenderer === "kitty"
    ? blankPlotLines
    : resultLines;
  const pointerEnabled = hasChartData && !isBlockingBody && !bodyMessage;

  return {
    canvasCrosshair,
    hasCanvasContent: !!plotBitmaps || (useCanvasChart && !!canvasBaseBitmapKey),
    plotBitmaps,
    plotLines,
    pointerEnabled,
  };
}
