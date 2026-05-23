import { useMemo } from "react";
import type { DisplayCursorState } from "../chart-pointer";
import type { ComparisonChartProjection } from "../comparison-chart-data";
import {
  buildComparisonChartScene,
  formatComparisonCursorAxisValue,
  renderComparisonChart,
  type ComparisonChartScene,
  type RenderComparisonChartResult,
} from "../comparison-chart-renderer";
import type { ChartAxisMode, ChartMarketSession, ResolvedChartRenderer } from "../chart-types";

type ComparisonChartColors = Parameters<typeof buildComparisonChartScene>[1]["colors"];

interface UseComparisonChartRenderOutputOptions {
  axisMode: ChartAxisMode;
  chartColors: ComparisonChartColors;
  chartHeight: number;
  chartWidth: number;
  displayCursor: DisplayCursorState;
  displayCursorX: number | null;
  displayCursorY: number | null;
  effectiveRenderer: ResolvedChartRenderer;
  hasChartData: boolean;
  marketSession: ChartMarketSession | null;
  projection: ComparisonChartProjection;
  selectedSymbol: string | null;
  useCanvasChart: boolean;
}

interface UseComparisonChartRenderOutputResult {
  axisLabels: Map<number, string>;
  cursorAxisLabel: string | null;
  cursorRow: number | null;
  cursorTimeAxisColumn: number | null;
  cursorTimeAxisDate: Date | null;
  displayScene: ComparisonChartScene;
  hasDisplayCursor: boolean;
  legendActiveIndex: number | null;
  result: RenderComparisonChartResult;
  staticResult: RenderComparisonChartResult;
  staticScene: ComparisonChartScene;
  timeAxisLabel: string;
  visiblePriceRange: number | undefined;
}

export function useComparisonChartRenderOutput({
  axisMode,
  chartColors,
  chartHeight,
  chartWidth,
  displayCursor,
  displayCursorX,
  displayCursorY,
  effectiveRenderer,
  hasChartData,
  marketSession,
  projection,
  selectedSymbol,
  useCanvasChart,
}: UseComparisonChartRenderOutputOptions): UseComparisonChartRenderOutputResult {
  const staticScene = useMemo(() => buildComparisonChartScene(projection, {
    width: chartWidth,
    height: chartHeight,
    cursorX: null,
    cursorY: null,
    selectedSymbol,
    colors: chartColors,
    marketSession,
  }), [chartColors, chartHeight, chartWidth, marketSession, projection, selectedSymbol]);

  const displayScene = useMemo(() => buildComparisonChartScene(projection, {
    width: chartWidth,
    height: chartHeight,
    cursorX: displayCursorX,
    cursorY: displayCursorY,
    selectedSymbol,
    colors: chartColors,
    marketSession,
  }), [chartColors, chartHeight, chartWidth, displayCursorX, displayCursorY, marketSession, projection, selectedSymbol]);

  const staticResult = useMemo(() => renderComparisonChart(projection, {
    width: chartWidth,
    height: chartHeight,
    cursorX: null,
    cursorY: null,
    selectedSymbol,
    colors: chartColors,
    marketSession,
  }), [chartColors, chartHeight, chartWidth, marketSession, projection, selectedSymbol]);

  const interactiveResult = useMemo(() => (
    effectiveRenderer === "kitty" || useCanvasChart
      ? null
      : renderComparisonChart(projection, {
        width: chartWidth,
        height: chartHeight,
        cursorX: displayCursorX,
        cursorY: displayCursorY,
        selectedSymbol,
        colors: chartColors,
        marketSession,
      })
  ), [chartColors, chartHeight, chartWidth, displayCursorX, displayCursorY, effectiveRenderer, marketSession, projection, selectedSymbol, useCanvasChart]);

  const result = effectiveRenderer === "kitty" || useCanvasChart ? staticResult : interactiveResult!;
  const timeAxisLabel = result.timeLabels || staticResult.timeLabels;
  const hasDisplayCursor = displayCursorX !== null && displayCursorY !== null;
  const cursorScene = hasDisplayCursor ? displayScene : staticScene;
  const legendActiveIndex = hasChartData
    ? cursorScene?.activeIdx ?? staticScene?.activeIdx ?? null
    : null;
  const visiblePriceRange = result.priceRange ?? staticResult.priceRange ?? undefined;
  const axisLabels = useMemo(
    () => new Map(staticResult.axisLabels.map((entry) => [entry.row, entry.label])),
    [staticResult.axisLabels],
  );
  const cursorRow = useCanvasChart ? cursorScene?.cursorRow ?? null : result.cursorRow;
  const crosshairValue = useCanvasChart ? cursorScene?.crosshairValue ?? null : result.crosshairValue;
  const cursorAxisLabel = cursorRow !== null && crosshairValue !== null
    ? formatComparisonCursorAxisValue(
      crosshairValue,
      projection.effectiveAxisMode,
      visiblePriceRange,
    )
    : null;
  const cursorTimeAxisColumn = hasDisplayCursor ? displayScene?.cursorColumn ?? null : null;
  const cursorTimeAxisDate = hasDisplayCursor ? displayScene?.activeDate ?? null : null;

  return {
    axisLabels,
    cursorAxisLabel,
    cursorRow,
    cursorTimeAxisColumn,
    cursorTimeAxisDate,
    displayScene,
    hasDisplayCursor,
    legendActiveIndex,
    result,
    staticResult,
    staticScene,
    timeAxisLabel,
    visiblePriceRange,
  };
}
