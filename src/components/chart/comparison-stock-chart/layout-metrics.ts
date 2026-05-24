import type { ChartAxisMode } from "../core/types";
import { getLegendColumns } from "./helpers";

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
  const legendColumns = getLegendColumns(width);
  const legendNeededRows = symbolCount > 0 ? Math.ceil(symbolCount / legendColumns) : 0;
  const legendRows = legendNeededRows > 0
    ? Math.min(4, Math.max(Math.min(height - (headerRows + controlRows + timeAxisRows + helpRows + 4), legendNeededRows), 1))
    : 0;
  const chartHeight = Math.max(height - headerRows - controlRows - timeAxisRows - helpRows - legendRows, 4);
  const minChartWidth = 20;
  const measurementChartWidth = Math.max(width - axisSectionWidthBudget - axisGap, minChartWidth);
  const legendItemWidth = Math.max(Math.floor((width - Math.max(legendColumns - 1, 0)) / legendColumns), 20);

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
