import type {
  ComparisonChartProjection,
  ComparisonProjectedPoint,
  ComparisonProjectedSeries,
} from "./comparison-chart-data";
import { buildTimeAxis } from "./chart-time-axis";
import type {
  ChartAxisMode,
  ChartColors,
  ChartMarketSession,
  ChartSessionBackgroundSpan,
  ComparisonChartRenderMode,
} from "./chart-types";
import { normalizeCount } from "./chart-render-utils";
import { resolveExtendedHoursBackgroundSpans } from "./market-session";

export type ComparisonChartColors = Pick<ChartColors, "bgColor" | "gridColor" | "crosshairColor" | "preMarketBgColor" | "postMarketBgColor">;

export interface ComparisonChartScene {
  dates: Date[];
  series: ComparisonProjectedSeries[];
  width: number;
  height: number;
  chartRows: number;
  mode: ComparisonChartRenderMode;
  axisMode: ChartAxisMode;
  selectedSymbol: string | null;
  colors: ComparisonChartColors;
  sessionBackgroundSpans: ChartSessionBackgroundSpan[];
  min: number;
  max: number;
  activeIdx: number;
  activeDate: Date;
  selectedSeries: ComparisonProjectedSeries | null;
  selectedPoint: ComparisonProjectedPoint | null;
  crosshairValue: number | null;
  timeLabels: string;
  cursorX: number | null;
  cursorY: number | null;
  cursorColumn: number | null;
  cursorRow: number | null;
  cursorDotX: number | null;
}

export interface RenderComparisonChartOptions {
  width: number;
  height: number;
  cursorX: number | null;
  cursorY: number | null;
  selectedSymbol: string | null;
  colors: ComparisonChartColors;
  marketSession?: ChartMarketSession | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getComparisonDotX(index: number, count: number, width: number): number {
  if (count <= 1) return Math.round(Math.max(width - 1, 0) / 2);
  return Math.round((index / (count - 1)) * Math.max(width - 1, 0));
}

export function getComparisonPointBand(index: number, pointCount: number, width: number): { left: number; right: number } {
  const currentX = getComparisonDotX(index, pointCount, width);
  const previousX = index > 0 ? getComparisonDotX(index - 1, pointCount, width) : currentX;
  const nextX = index < pointCount - 1 ? getComparisonDotX(index + 1, pointCount, width) : currentX;
  return {
    left: index === 0 ? 0 : Math.floor((previousX + currentX) / 2) + 1,
    right: index === pointCount - 1 ? Math.max(width - 1, 0) : Math.floor((currentX + nextX) / 2),
  };
}

export function getScaledComparisonY(value: number, min: number, max: number, chartTop: number, chartBottom: number): number {
  const range = max - min || 1;
  const chartHeight = chartBottom - chartTop;
  return chartTop + Math.round((1 - (value - min) / range) * chartHeight);
}

function getActiveIndex(pointCount: number, width: number, cursorX: number | null): number {
  if (pointCount <= 0) return 0;
  if (cursorX === null || cursorX < 0 || cursorX >= width) {
    return pointCount - 1;
  }

  let bestIndex = pointCount - 1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < pointCount; index += 1) {
    const pointColumn = Math.min(Math.max(Math.floor(getComparisonDotX(index, pointCount, width * 2) / 2), 0), width - 1);
    const distance = Math.abs(pointColumn - cursorX);
    if (distance <= bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

export function getSelectedComparisonSeries(series: ComparisonProjectedSeries[], selectedSymbol: string | null): ComparisonProjectedSeries | null {
  if (series.length === 0) return null;
  if (!selectedSymbol) return series[0] ?? null;
  return series.find((entry) => entry.symbol === selectedSymbol) ?? series[0] ?? null;
}

export function buildComparisonChartScene(
  projection: ComparisonChartProjection,
  opts: RenderComparisonChartOptions,
): ComparisonChartScene | null {
  if (projection.dates.length === 0 || projection.series.length === 0) {
    return null;
  }

  const values = projection.series.flatMap((entry) => entry.points.map((point) => point.value).filter((value): value is number => value !== null));
  if (values.length === 0) {
    return null;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = normalizeCount(opts.width, 1);
  const height = normalizeCount(opts.height, 1);
  const selectedSeries = getSelectedComparisonSeries(projection.series, opts.selectedSymbol);
  const activeIdx = getActiveIndex(projection.dates.length, width, opts.cursorX);
  const activeDate = projection.dates[activeIdx] ?? projection.dates[projection.dates.length - 1]!;
  const selectedPoint = selectedSeries?.points[activeIdx] ?? null;
  const chartRows = height;
  const range = max - min || 1;
  const cursorX = opts.cursorX === null
    ? null
    : clamp(opts.cursorX, 0, Math.max(width - 1, 0));
  const fallbackValue = selectedPoint?.value ?? selectedSeries?.latestValue ?? min;
  const cursorY = cursorX === null
    ? null
    : opts.cursorY !== null
      ? clamp(opts.cursorY, 0, Math.max(chartRows - 1, 0))
      : clamp(
        Math.round((1 - ((fallbackValue ?? min) - min) / range) * Math.max(chartRows - 1, 0)),
        0,
        Math.max(chartRows - 1, 0),
      );
  const cursorColumn = cursorX === null ? null : Math.round(cursorX);
  const cursorDotX = cursorX === null
    ? null
    : Math.round((cursorX / Math.max(width - 1, 1)) * Math.max(width * 2 - 1, 0));
  const cursorRow = cursorY === null ? null : Math.round(cursorY);
  const crosshairValue = cursorY === null
    ? null
    : max - (cursorY / Math.max(chartRows - 1, 1)) * range;
  const sessionBackgroundSpans = resolveExtendedHoursBackgroundSpans(projection.dates, opts.marketSession);

  return {
    dates: projection.dates,
    series: projection.series,
    width,
    height,
    chartRows,
    mode: projection.effectiveMode,
    axisMode: projection.effectiveAxisMode,
    selectedSymbol: selectedSeries?.symbol ?? null,
    colors: opts.colors,
    sessionBackgroundSpans,
    min,
    max,
    activeIdx,
    activeDate,
    selectedSeries,
    selectedPoint,
    crosshairValue,
    timeLabels: buildTimeAxis(projection.dates, opts.width),
    cursorX,
    cursorY,
    cursorColumn,
    cursorRow,
    cursorDotX,
  };
}
