import { useMemo } from "react";
import { buildBlankPlotLines } from "../core/pointer";
import { useChartDisplayCursorLayoutRemap } from "../display-cursor";
import { useStockChartCanvasBitmaps } from "./canvas";
import {
  useStockChartSelectionDisplayCursorSync,
} from "./cursor";
import { useStockChartPointerInteractions } from "./interactions";
import { useStockChartNativeSurfaces } from "./native-surfaces";
import type { useStockChartRenderOutput } from "./rendering/output";

type DisplayCursorRemapOptions = Parameters<typeof useChartDisplayCursorLayoutRemap>[0];
type SelectionCursorSyncOptions = Parameters<typeof useStockChartSelectionDisplayCursorSync>[0];
type NativeSurfaceOptions = Parameters<typeof useStockChartNativeSurfaces>[0];
type PointerInteractionOptions = Parameters<typeof useStockChartPointerInteractions>[0];
type CanvasBitmapOptions = Parameters<typeof useStockChartCanvasBitmaps>[0];
type RenderOutput = ReturnType<typeof useStockChartRenderOutput>;

type StockChartSurfaceRuntimeOptions =
  & DisplayCursorRemapOptions
  & SelectionCursorSyncOptions
  & Omit<NativeSurfaceOptions, "showVolume">
  & PointerInteractionOptions
  & CanvasBitmapOptions
  & {
    effectiveRenderer: NativeSurfaceOptions["effectiveRenderer"];
    nativeShowVolume: NativeSurfaceOptions["showVolume"];
    resultLines: RenderOutput["result"]["lines"];
  };

export function useStockChartSurfaceRuntime(options: StockChartSurfaceRuntimeOptions) {
  const {
    chartHeight,
    chartWidth,
    effectiveRenderer,
    nativeShowVolume,
    resultLines,
  } = options;

  useChartDisplayCursorLayoutRemap(options);
  useStockChartSelectionDisplayCursorSync(options);
  useStockChartNativeSurfaces({
    ...options,
    showVolume: nativeShowVolume,
  });

  const blankPlotLines = useMemo(
    () => buildBlankPlotLines(chartWidth, chartHeight),
    [chartHeight, chartWidth],
  );
  const pointerInteractions = useStockChartPointerInteractions(options);
  const canvasBitmaps = useStockChartCanvasBitmaps(options);
  const plotLines = effectiveRenderer === "kitty"
    ? blankPlotLines
    : resultLines;

  return {
    ...pointerInteractions,
    ...canvasBitmaps,
    plotLines,
  };
}
