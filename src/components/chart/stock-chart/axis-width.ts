import type { PricePoint } from "../../../types/financials";
import { colors } from "../../../theme/colors";
import {
  projectChartData,
  type ProjectChartDataOptions,
} from "../chart-data";
import {
  getVisibleWindowForDateRange,
  type DateWindowRange,
} from "../chart-controller";
import {
  buildChartScene,
  formatCursorAxisValue,
  renderChart,
  resolveChartPalette,
} from "../chart-renderer";
import type { ChartAxisMode, ChartRenderMode } from "../chart-types";
import { resolveIterativeChartAxisWidth } from "../chart-axis-measure";

const AXIS_MEASURE_PALETTE = resolveChartPalette({
  bg: colors.bg,
  border: colors.border,
  borderFocused: colors.borderFocused,
  text: colors.text,
  textDim: colors.textDim,
  positive: colors.positive,
  negative: colors.negative,
}, "neutral");

export interface ResolveStockChartAxisWidthOptions {
  axisGap: number;
  axisMode: ChartAxisMode;
  axisRightPadding: number;
  axisSectionWidthBudget: number;
  chartAssetCategory?: string;
  chartCurrency: string;
  chartHeight: number;
  compact?: boolean;
  displayedDateWindow: DateWindowRange | null;
  history: PricePoint[];
  historyOverride?: PricePoint[] | null;
  measurementChartWidth: number;
  minChartWidth: number;
  minimumAxisWidth: number;
  renderMode: ChartRenderMode | undefined;
  resolveOhlcProjectionOptions: (
    pointCount: number,
    sourceIndexOffset: number,
  ) => ProjectChartDataOptions;
  showVolume: boolean;
  volumeHeight: number;
  width: number;
}

export function resolveStockChartAxisWidth({
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
}: ResolveStockChartAxisWidthOptions): number {
  return resolveIterativeChartAxisWidth({
    axisGap,
    axisRightPadding,
    axisSectionWidthBudget,
    measurementChartWidth,
    minChartWidth,
    minimumAxisWidth,
    width,
    measureLabels: (targetWidth) => {
      const measuredWindow = historyOverride || !displayedDateWindow?.start || !displayedDateWindow.end
        ? { points: history, startIdx: 0, endIdx: history.length }
        : getVisibleWindowForDateRange(history, displayedDateWindow, 0);
      const measuredTimeAxisDates = measuredWindow.points.map((point) => point.date);
      const measuredProjection = projectChartData(
        measuredWindow.points,
        targetWidth,
        renderMode,
        !!compact,
        resolveOhlcProjectionOptions(measuredWindow.points.length, measuredWindow.startIdx),
      );
      const measuredResult = renderChart(measuredProjection.points, {
        width: targetWidth,
        height: chartHeight,
        showVolume: showVolume && !compact,
        volumeHeight,
        cursorX: null,
        cursorY: null,
        mode: measuredProjection.effectiveMode,
        axisMode,
        currency: chartCurrency,
        assetCategory: chartAssetCategory,
        colors: AXIS_MEASURE_PALETTE,
        timeAxisDates: measuredTimeAxisDates,
      });
      const measuredScene = buildChartScene(measuredProjection.points, {
        width: targetWidth,
        height: chartHeight,
        showVolume: showVolume && !compact,
        volumeHeight,
        cursorX: null,
        cursorY: null,
        mode: measuredProjection.effectiveMode,
        axisMode,
        colors: AXIS_MEASURE_PALETTE,
        timeAxisDates: measuredTimeAxisDates,
      });
      const cursorSamples = !compact && measuredScene
        ? [
          formatCursorAxisValue(
            measuredScene.min,
            axisMode,
            measuredProjection.points[0]?.close ?? 0,
            chartCurrency,
            chartAssetCategory,
            measuredResult.priceRange ?? undefined,
          ),
          formatCursorAxisValue(
            measuredScene.max,
            axisMode,
            measuredProjection.points[0]?.close ?? 0,
            chartCurrency,
            chartAssetCategory,
            measuredResult.priceRange ?? undefined,
          ),
        ]
        : [];

      return [...measuredResult.axisLabels.map((entry) => entry.label), ...cursorSamples];
    },
  });
}
