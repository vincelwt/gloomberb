import type { ChartAxisMode, ResolvedChartRenderer } from "../chart-types";

export interface StockChartLayoutMetrics {
  axisGap: number;
  axisRightPadding: number;
  axisSectionWidthBudget: number;
  chartHeight: number;
  measurementChartWidth: number;
  minChartWidth: number;
  minimumAxisWidth: number;
  nativeSurfaceGuardRow: number;
  volumeHeight: number;
}

interface ResolveStockChartLayoutMetricsOptions {
  axisMode: ChartAxisMode;
  compact?: boolean;
  effectiveRenderer: ResolvedChartRenderer;
  fractionalViewport: boolean;
  height: number;
  showVolume: boolean;
  useCanvasChart: boolean;
  width: number;
}

export function resolveStockChartLayoutMetrics({
  axisMode,
  compact,
  effectiveRenderer,
  fractionalViewport,
  height,
  showVolume,
  useCanvasChart,
  width,
}: ResolveStockChartLayoutMetricsOptions): StockChartLayoutMetrics {
  const axisSectionWidthBudget = compact
    ? axisMode === "percent" ? 11 : 8
    : axisMode === "percent" ? 11 : 10;
  const axisRightPadding = compact || fractionalViewport ? 0 : 1;
  const minimumAxisWidth = axisMode === "percent" ? 5 : 4;
  const axisGap = axisSectionWidthBudget > 0 ? fractionalViewport ? 0.5 : 1 : 0;
  const minChartWidth = compact ? 12 : 20;
  const measurementChartWidth = Math.max(width - axisSectionWidthBudget - axisGap, minChartWidth);
  const headerRows = compact ? 0 : 2;
  const helpRow = compact ? 1 : 0;
  const timeAxisRow = 1;
  const nativeSurfaceGuardRow = !compact && fractionalViewport && (useCanvasChart || effectiveRenderer === "kitty") ? 1 : 0;
  const volumeHeight = showVolume && !compact ? 3 : 0;
  const chartHeight = Math.max(height - headerRows - helpRow - timeAxisRow - nativeSurfaceGuardRow, 4);

  return {
    axisGap,
    axisRightPadding,
    axisSectionWidthBudget,
    chartHeight,
    measurementChartWidth,
    minChartWidth,
    minimumAxisWidth,
    nativeSurfaceGuardRow,
    volumeHeight,
  };
}
