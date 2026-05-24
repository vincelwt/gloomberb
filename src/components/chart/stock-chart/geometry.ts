import { useMemo } from "react";
import { getKeyboardPanCellCount } from "../core/scroll";
import {
  resolveStockChartAxisWidth,
  type ResolveStockChartAxisWidthOptions,
} from "./axis-width";
import { clamp } from "./viewport";

export interface StockChartGeometry {
  axisSectionWidth: number;
  axisWidth: number;
  chartWidth: number;
  displayCursorX: number | null;
  displayCursorY: number | null;
  maxCursorX: number;
  panStep: number;
  selectionCursorX: number | null;
  selectionCursorY: number | null;
}

interface ResolveStockChartGeometryArgs extends Pick<
  ResolveStockChartAxisWidthOptions,
  "axisGap" | "axisRightPadding" | "chartHeight" | "minChartWidth" | "width"
> {
  axisWidth: number;
  displayCursorCellX: number | null;
  displayCursorCellY: number | null;
  interactive: boolean | undefined;
  viewCursorX: number | null;
  viewCursorY: number | null;
}

function resolveStockChartGeometry({
  axisGap,
  axisRightPadding,
  axisWidth,
  chartHeight,
  displayCursorCellX,
  displayCursorCellY,
  interactive,
  minChartWidth,
  viewCursorX,
  viewCursorY,
  width,
}: ResolveStockChartGeometryArgs): StockChartGeometry {
  const axisSectionWidth = axisWidth + axisRightPadding;
  const chartWidth = Math.max(width - axisSectionWidth - axisGap, minChartWidth);
  const maxCursorX = chartWidth - 1;
  const cursorX = viewCursorX !== null ? clamp(viewCursorX, 0, maxCursorX) : null;
  const cursorY = viewCursorY !== null ? clamp(viewCursorY, 0, chartHeight - 1) : null;
  const displayCursorX = interactive && displayCursorCellX !== null
    ? clamp(displayCursorCellX, 0, maxCursorX)
    : null;
  const displayCursorY = interactive && displayCursorCellY !== null
    ? clamp(displayCursorCellY, 0, chartHeight - 1)
    : null;

  return {
    axisSectionWidth,
    axisWidth,
    chartWidth,
    displayCursorX,
    displayCursorY,
    maxCursorX,
    panStep: getKeyboardPanCellCount(chartWidth),
    selectionCursorX: interactive ? cursorX : null,
    selectionCursorY: interactive ? cursorY : null,
  };
}

interface UseStockChartGeometryArgs extends ResolveStockChartAxisWidthOptions {
  displayCursorCellX: number | null;
  displayCursorCellY: number | null;
  interactive: boolean | undefined;
  viewCursorX: number | null;
  viewCursorY: number | null;
}

export function useStockChartGeometry({
  axisGap,
  axisMode,
  axisRightPadding,
  axisSectionWidthBudget,
  chartAssetCategory,
  chartCurrency,
  chartHeight,
  compact,
  displayedDateWindow,
  displayCursorCellX,
  displayCursorCellY,
  history,
  historyOverride,
  interactive,
  measurementChartWidth,
  minChartWidth,
  minimumAxisWidth,
  renderMode,
  resolveOhlcProjectionOptions,
  showVolume,
  viewCursorX,
  viewCursorY,
  volumeHeight,
  width,
}: UseStockChartGeometryArgs): StockChartGeometry {
  const axisWidth = useMemo(() => resolveStockChartAxisWidth({
    axisGap,
    axisMode,
    axisRightPadding,
    axisSectionWidthBudget,
    chartAssetCategory,
    chartCurrency,
    chartHeight,
    compact,
    displayedDateWindow,
    history,
    historyOverride,
    measurementChartWidth,
    minChartWidth,
    minimumAxisWidth,
    renderMode,
    resolveOhlcProjectionOptions,
    showVolume,
    volumeHeight,
    width,
  }), [
    axisGap,
    axisMode,
    axisRightPadding,
    axisSectionWidthBudget,
    chartAssetCategory,
    chartCurrency,
    chartHeight,
    compact,
    displayedDateWindow,
    history,
    historyOverride,
    measurementChartWidth,
    minChartWidth,
    minimumAxisWidth,
    renderMode,
    resolveOhlcProjectionOptions,
    showVolume,
    volumeHeight,
    width,
  ]);

  return resolveStockChartGeometry({
    axisGap,
    axisRightPadding,
    axisWidth,
    chartHeight,
    displayCursorCellX,
    displayCursorCellY,
    interactive,
    minChartWidth,
    viewCursorX,
    viewCursorY,
    width,
  });
}
