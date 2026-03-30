import type {
  ComparisonChartProjection,
  ComparisonProjectedPoint,
  ComparisonProjectedSeries,
} from "./comparison-chart-data";
import {
  buildTimeAxis,
  bufferToBrailleLines,
  computeGridLines,
  createPixelBuffer,
  drawCrosshair,
  drawGridLines,
  drawLine,
  formatPrice,
  type StyledContent,
} from "./chart-renderer";
import type { ChartAxisMode, ComparisonChartRenderMode } from "./chart-types";

const LAYER_FILL = 1;
const LAYER_DATA = 2;

export interface ComparisonChartScene {
  dates: Date[];
  series: ComparisonProjectedSeries[];
  width: number;
  height: number;
  chartRows: number;
  mode: ComparisonChartRenderMode;
  axisMode: ChartAxisMode;
  selectedSymbol: string | null;
  colors: {
    bgColor: string;
    gridColor: string;
    crosshairColor: string;
  };
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
  colors: {
    bgColor: string;
    gridColor: string;
    crosshairColor: string;
  };
}

export interface RenderComparisonChartResult {
  lines: StyledContent[];
  axisLabels: { row: number; label: string }[];
  timeLabels: string;
  activeDate: Date | null;
  selectedSeries: ComparisonProjectedSeries | null;
  selectedPoint: ComparisonProjectedPoint | null;
  crosshairValue: number | null;
  cursorColumn: number | null;
  cursorRow: number | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getComparisonDotX(index: number, count: number, width: number): number {
  if (count <= 1) return Math.round(Math.max(width - 1, 0) / 2);
  return Math.round((index / (count - 1)) * Math.max(width - 1, 0));
}

function getScaledY(value: number, min: number, max: number, chartTop: number, chartBottom: number): number {
  const range = max - min || 1;
  const chartHeight = chartBottom - chartTop;
  return chartTop + Math.round((1 - (value - min) / range) * chartHeight);
}

function formatPercentAxisValue(value: number): string {
  const abs = Math.abs(value);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(decimals)}%`;
}

export function formatComparisonAxisValue(value: number, axisMode: ChartAxisMode): string {
  return axisMode === "percent"
    ? formatPercentAxisValue(value)
    : formatPrice(value);
}

function fillColumn(
  buf: ReturnType<typeof createPixelBuffer>,
  x: number,
  y0: number,
  y1: number,
  color: string,
  layer: number,
) {
  drawLine(buf, x, Math.min(y0, y1), x, Math.max(y0, y1), color, layer);
}

function drawComparisonLineSeries(
  buf: ReturnType<typeof createPixelBuffer>,
  points: ComparisonProjectedPoint[],
  chartTop: number,
  chartBottom: number,
  color: string,
  min: number,
  max: number,
) {
  let previousIndex: number | null = null;
  let previousY: number | null = null;
  let previousX: number | null = null;

  for (let index = 0; index < points.length; index += 1) {
    const value = points[index]!.value;
    if (value === null) {
      previousIndex = null;
      previousY = null;
      previousX = null;
      continue;
    }

    const x = getComparisonDotX(index, points.length, buf.width);
    const y = getScaledY(value, min, max, chartTop, chartBottom);

    if (previousIndex !== null && previousY !== null && previousX !== null) {
      drawLine(buf, previousX, previousY, x, y, color, LAYER_DATA);
    } else {
      drawLine(buf, x, y, x, y, color, LAYER_DATA);
    }

    previousIndex = index;
    previousY = y;
    previousX = x;
  }
}

function drawComparisonAreaSeries(
  buf: ReturnType<typeof createPixelBuffer>,
  points: ComparisonProjectedPoint[],
  chartTop: number,
  chartBottom: number,
  lineColor: string,
  fillColor: string,
  min: number,
  max: number,
) {
  let previousY: number | null = null;
  let previousX: number | null = null;

  for (let index = 0; index < points.length; index += 1) {
    const value = points[index]!.value;
    if (value === null) {
      previousY = null;
      previousX = null;
      continue;
    }

    const x = getComparisonDotX(index, points.length, buf.width);
    const y = getScaledY(value, min, max, chartTop, chartBottom);
    fillColumn(buf, x, y + 1, chartBottom, fillColor, LAYER_FILL);

    if (previousY !== null && previousX !== null) {
      const left = Math.min(previousX, x);
      const right = Math.max(previousX, x);
      for (let column = left; column <= right; column += 1) {
        if (column === previousX || column === x) continue;
        const t = x === previousX ? 0 : (column - previousX) / (x - previousX);
        const interpolatedY = Math.round(previousY + t * (y - previousY));
        fillColumn(buf, column, interpolatedY + 1, chartBottom, fillColor, LAYER_FILL);
      }
      drawLine(buf, previousX, previousY, x, y, lineColor, LAYER_DATA);
    } else {
      drawLine(buf, x, y, x, y, lineColor, LAYER_DATA);
    }

    previousY = y;
    previousX = x;
  }
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

function getSelectedSeries(series: ComparisonProjectedSeries[], selectedSymbol: string | null): ComparisonProjectedSeries | null {
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
  const selectedSeries = getSelectedSeries(projection.series, opts.selectedSymbol);
  const activeIdx = getActiveIndex(projection.dates.length, opts.width, opts.cursorX);
  const activeDate = projection.dates[activeIdx] ?? projection.dates[projection.dates.length - 1]!;
  const selectedPoint = selectedSeries?.points[activeIdx] ?? null;
  const chartRows = opts.height;
  const range = max - min || 1;
  const cursorX = opts.cursorX === null
    ? null
    : clamp(opts.cursorX, 0, Math.max(opts.width - 1, 0));
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
    : Math.round((cursorX / Math.max(opts.width - 1, 1)) * Math.max(opts.width * 2 - 1, 0));
  const cursorRow = cursorY === null ? null : Math.round(cursorY);
  const crosshairValue = cursorY === null
    ? null
    : max - (cursorY / Math.max(chartRows - 1, 1)) * range;

  return {
    dates: projection.dates,
    series: projection.series,
    width: opts.width,
    height: opts.height,
    chartRows,
    mode: projection.effectiveMode,
    axisMode: projection.effectiveAxisMode,
    selectedSymbol: selectedSeries?.symbol ?? null,
    colors: opts.colors,
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

export function renderComparisonChart(
  projection: ComparisonChartProjection,
  opts: RenderComparisonChartOptions,
): RenderComparisonChartResult {
  const scene = buildComparisonChartScene(projection, opts);
  if (!scene) {
    return {
      lines: [],
      axisLabels: [],
      timeLabels: "",
      activeDate: null,
      selectedSeries: null,
      selectedPoint: null,
      crosshairValue: null,
      cursorColumn: null,
      cursorRow: null,
    };
  }

  const dotWidth = scene.width * 2;
  const chartDotBottom = scene.chartRows * 4 - 1;
  const buf = createPixelBuffer(dotWidth, scene.height * 4);
  const gridLines = computeGridLines(scene.min, scene.max, 0, chartDotBottom, 3);
  drawGridLines(buf, gridLines.map((line) => line.y), scene.colors.gridColor);

  const selectedSeries = getSelectedSeries(scene.series, scene.selectedSymbol);
  const orderedSeries = [
    ...scene.series.filter((entry) => entry.symbol !== selectedSeries?.symbol),
    ...(selectedSeries ? [selectedSeries] : []),
  ];

  for (const series of orderedSeries) {
    if (scene.mode === "area") {
      drawComparisonAreaSeries(buf, series.points, 0, chartDotBottom, series.color, series.fillColor, scene.min, scene.max);
    } else {
      drawComparisonLineSeries(buf, series.points, 0, chartDotBottom, series.color, scene.min, scene.max);
    }
  }

  if (scene.cursorDotX !== null) {
    drawCrosshair(buf, scene.cursorDotX, 0, chartDotBottom, scene.colors.crosshairColor);
  }

  const axisLabelsByRow = new Map<number, string>();
  for (const line of gridLines) {
    axisLabelsByRow.set(
      Math.min(Math.floor(line.y / 4), Math.max(scene.chartRows - 1, 0)),
      formatComparisonAxisValue(line.price, scene.axisMode),
    );
  }

  return {
    lines: bufferToBrailleLines(buf, scene.colors.bgColor),
    axisLabels: [...axisLabelsByRow.entries()].map(([row, label]) => ({ row, label })),
    timeLabels: scene.timeLabels,
    activeDate: scene.activeDate,
    selectedSeries: scene.selectedSeries,
    selectedPoint: scene.selectedPoint,
    crosshairValue: scene.crosshairValue,
    cursorColumn: scene.cursorColumn,
    cursorRow: scene.cursorRow,
  };
}
