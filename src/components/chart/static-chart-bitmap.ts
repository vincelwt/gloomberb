import { useMemo } from "react";
import { useNativeRenderer, useUiCapabilities } from "../../ui";
import { computeBitmapSize } from "./native/chart-rasterizer";

export interface StaticChartBitmapSize {
  pixelWidth: number;
  pixelHeight: number;
}

export function useStaticChartBitmapSize(width: number, height: number): StaticChartBitmapSize | null {
  const {
    canvasCharts,
    nativeCharts,
    cellWidthPx = 8,
    cellHeightPx = 18,
    pixelRatio = 1,
  } = useUiCapabilities();
  const nativeRenderer = useNativeRenderer();
  const rendererResolution = nativeRenderer.resolution;
  const rendererTerminalWidth = nativeRenderer.terminalWidth;
  const rendererTerminalHeight = nativeRenderer.terminalHeight;

  return useMemo(() => {
    if (nativeCharts && rendererResolution && rendererTerminalWidth > 0 && rendererTerminalHeight > 0) {
      return computeBitmapSize(
        { x: 0, y: 0, width, height },
        rendererResolution,
        rendererTerminalWidth,
        rendererTerminalHeight,
      );
    }
    if (!canvasCharts && !nativeCharts) return null;
    const scale = Math.max(1, pixelRatio);
    return {
      pixelWidth: Math.max(1, Math.round(width * cellWidthPx * scale)),
      pixelHeight: Math.max(1, Math.round(height * cellHeightPx * scale)),
    };
  }, [
    canvasCharts,
    cellHeightPx,
    cellWidthPx,
    height,
    nativeCharts,
    pixelRatio,
    rendererResolution,
    rendererTerminalHeight,
    rendererTerminalWidth,
    width,
  ]);
}
