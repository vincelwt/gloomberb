import { useEffect } from "react";
import type { NativeRendererHost } from "../../../ui";
import type {
  ChartRenderMode,
  ChartResolution,
  TimeRange,
} from "../chart-types";

interface StockChartDataRenderInvalidationOptions {
  chartHeight: number;
  chartWidth: number;
  compact?: boolean;
  historyRenderKey: string;
  renderMode: ChartRenderMode;
  renderer: NativeRendererHost;
  tickerSymbol: string | null | undefined;
}

export function useStockChartDataRenderInvalidation({
  chartHeight,
  chartWidth,
  compact,
  historyRenderKey,
  renderMode,
  renderer,
  tickerSymbol,
}: StockChartDataRenderInvalidationOptions) {
  useEffect(() => {
    queueMicrotask(() => renderer.requestRender());
  }, [
    chartHeight,
    chartWidth,
    compact,
    historyRenderKey,
    renderer,
    renderMode,
    tickerSymbol,
  ]);
}

interface StockChartControlRenderInvalidationOptions {
  activePreset: TimeRange | null;
  bodyMessage: string | null;
  fallbackResolutionLabel: string | null;
  isUpdating: boolean;
  renderer: NativeRendererHost;
  selectedResolution: ChartResolution;
}

export function useStockChartControlRenderInvalidation({
  activePreset,
  bodyMessage,
  fallbackResolutionLabel,
  isUpdating,
  renderer,
  selectedResolution,
}: StockChartControlRenderInvalidationOptions) {
  useEffect(() => {
    queueMicrotask(() => renderer.requestRender());
  }, [
    activePreset,
    bodyMessage,
    fallbackResolutionLabel,
    isUpdating,
    renderer,
    selectedResolution,
  ]);
}
