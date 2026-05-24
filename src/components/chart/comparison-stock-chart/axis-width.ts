import {
  projectComparisonChartData,
} from "../comparison/data";
import {
  buildComparisonChartScene,
  formatComparisonCursorAxisValue,
  renderComparisonChart,
} from "../comparison/renderer";
import { resolveIterativeChartAxisWidth } from "../core/axis-measure";
import type {
  ChartAxisMode,
  ComparisonChartSeries,
  ComparisonChartViewState,
} from "../core/types";

interface ComparisonChartColors {
  bgColor: string;
  gridColor: string;
  crosshairColor: string;
  preMarketBgColor: string;
  postMarketBgColor: string;
}

export interface ResolveComparisonChartAxisWidthOptions {
  axisGap: number;
  axisMode: ChartAxisMode;
  axisRightPadding: number;
  axisSectionWidthBudget: number;
  chartColors: ComparisonChartColors;
  chartHeight: number;
  measurementChartWidth: number;
  minChartWidth: number;
  minimumAxisWidth: number;
  selectedSymbol: string | null;
  series: ComparisonChartSeries[];
  viewState: Pick<ComparisonChartViewState, "panOffset" | "renderMode" | "zoomLevel">;
  width: number;
}

export function resolveComparisonChartAxisWidth({
  axisGap,
  axisMode,
  axisRightPadding,
  axisSectionWidthBudget,
  chartColors,
  chartHeight,
  measurementChartWidth,
  minChartWidth,
  minimumAxisWidth,
  selectedSymbol,
  series,
  viewState,
  width,
}: ResolveComparisonChartAxisWidthOptions): number {
  return resolveIterativeChartAxisWidth({
    axisGap,
    axisRightPadding,
    axisSectionWidthBudget,
    measurementChartWidth,
    minChartWidth,
    minimumAxisWidth,
    width,
    measureLabels: (targetWidth) => {
      const measuredProjection = projectComparisonChartData(series, targetWidth, viewState, axisMode);
      const measuredResult = renderComparisonChart(measuredProjection, {
        width: targetWidth,
        height: chartHeight,
        cursorX: null,
        cursorY: null,
        selectedSymbol,
        colors: chartColors,
      });
      const measuredScene = buildComparisonChartScene(measuredProjection, {
        width: targetWidth,
        height: chartHeight,
        cursorX: null,
        cursorY: null,
        selectedSymbol,
        colors: chartColors,
      });
      const cursorSamples = measuredScene
        ? [
          formatComparisonCursorAxisValue(
            measuredScene.min,
            measuredProjection.effectiveAxisMode,
            measuredResult.priceRange ?? undefined,
          ),
          formatComparisonCursorAxisValue(
            measuredScene.max,
            measuredProjection.effectiveAxisMode,
            measuredResult.priceRange ?? undefined,
          ),
        ]
        : [];

      return [...measuredResult.axisLabels.map((entry) => entry.label), ...cursorSamples];
    },
  });
}
