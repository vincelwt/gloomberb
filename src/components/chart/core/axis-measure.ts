import { resolveChartAxisWidth } from "./renderer";

export interface ResolveIterativeChartAxisWidthOptions {
  axisGap: number;
  axisRightPadding: number;
  axisSectionWidthBudget: number;
  measurementChartWidth: number;
  minChartWidth: number;
  minimumAxisWidth: number;
  width: number;
  measureLabels: (targetWidth: number) => Array<string | null | undefined>;
}

export function resolveIterativeChartAxisWidth({
  axisGap,
  axisRightPadding,
  axisSectionWidthBudget,
  measurementChartWidth,
  minChartWidth,
  minimumAxisWidth,
  width,
  measureLabels,
}: ResolveIterativeChartAxisWidthOptions): number {
  const measureAxisWidth = (targetWidth: number) => resolveChartAxisWidth(
    measureLabels(targetWidth),
    minimumAxisWidth,
    Math.max(axisSectionWidthBudget - axisRightPadding, minimumAxisWidth),
  );

  const firstPassWidth = measureAxisWidth(measurementChartWidth);
  const refinedChartWidth = Math.max(width - firstPassWidth - axisRightPadding - axisGap, minChartWidth);
  return refinedChartWidth === measurementChartWidth ? firstPassWidth : measureAxisWidth(refinedChartWidth);
}
