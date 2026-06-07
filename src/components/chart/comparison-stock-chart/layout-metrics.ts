import type { ChartAxisMode } from "../core/types";

export interface ComparisonChartLayoutMetrics {
  axisGap: number;
  axisRightPadding: number;
  axisSectionWidthBudget: number;
  chartHeight: number;
  legendColumns: number;
  legendItemWidth: number;
  legendRows: number;
  measurementChartWidth: number;
  minChartWidth: number;
  minimumAxisWidth: number;
  timeAxisRows: number;
}

interface ResolveComparisonChartLayoutMetricsOptions {
  axisMode: ChartAxisMode;
  height: number;
  symbolCount: number;
  width: number;
}

export function resolveComparisonChartLayoutMetrics({
  axisMode,
  height,
  symbolCount,
  width,
}: ResolveComparisonChartLayoutMetricsOptions): ComparisonChartLayoutMetrics {
  const axisSectionWidthBudget = 11;
  const axisRightPadding = 1;
  const minimumAxisWidth = axisMode === "percent" ? 5 : 4;
  const axisGap = axisSectionWidthBudget > 0 ? 1 : 0;
  const headerRows = 0;
  const controlRows = 2;
  const timeAxisRows = 1;
  const helpRows = 0;
  const legendColumns = 1;
  const legendNeededRows = symbolCount > 0 ? symbolCount + 1 : 0;
  const legendAvailableRows = Math.max(height - (headerRows + controlRows + timeAxisRows + helpRows + 6), 0);
  const legendRows = legendNeededRows > 0 && legendAvailableRows > 0
    ? Math.min(5, Math.max(2, Math.min(legendAvailableRows, legendNeededRows)))
    : 0;
  const chartHeight = Math.max(height - headerRows - controlRows - timeAxisRows - helpRows - legendRows, 4);
  const minChartWidth = 20;
  const measurementChartWidth = Math.max(width - axisSectionWidthBudget - axisGap, minChartWidth);
  const legendItemWidth = Math.max(width, 20);

  return {
    axisGap,
    axisRightPadding,
    axisSectionWidthBudget,
    chartHeight,
    legendColumns,
    legendItemWidth,
    legendRows,
    measurementChartWidth,
    minChartWidth,
    minimumAxisWidth,
    timeAxisRows,
  };
}
