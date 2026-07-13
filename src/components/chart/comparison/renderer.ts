import type {
  ComparisonChartProjection,
  ComparisonProjectedPoint,
  ComparisonProjectedSeries,
} from "./data";
import {
  bufferToBrailleLines,
  computeGridLines,
  createPixelBuffer,
  drawCrosshair,
  drawGridLines,
  drawLine,
  formatPrice,
  resolveAxisFractionDigits,
  type StyledContent,
} from "../core/renderer";
import type { ChartAxisMode, ChartSessionBackgroundSpan } from "../core/types";
import {
  buildComparisonChartScene,
  getComparisonDotX,
  getComparisonPointBand,
  getScaledComparisonY,
  getSelectedComparisonSeries,
  type ComparisonChartColors,
  type RenderComparisonChartOptions,
} from "./scene";

const LAYER_FILL = 1;
const LAYER_DATA = 2;
export {
  buildComparisonChartScene,
  type ComparisonChartScene,
  type RenderComparisonChartOptions,
} from "./scene";

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
  axisFractionDigits: number | null;
  priceRange: number | null;
}

function formatPercentAxisValue(value: number): string {
  const abs = Math.abs(value);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(decimals)}%`;
}

function getComparisonAxisFractionDigitFloor(priceRange: number | undefined): number {
  if (priceRange === undefined || !Number.isFinite(priceRange) || priceRange <= 0) return 0;
  const visibleStep = priceRange / 3;
  if (!Number.isFinite(visibleStep) || visibleStep <= 0) return 0;
  return Math.max(0, Math.ceil(-Math.log10(visibleStep)) + 1);
}

export function formatComparisonAxisValue(
  value: number,
  axisMode: ChartAxisMode,
  priceRange?: number,
  fixedFractionDigits?: number,
): string {
  return axisMode === "percent"
    ? formatPercentAxisValue(value)
    : formatPrice(value, undefined, priceRange, 0, 0, fixedFractionDigits);
}

export function formatComparisonCursorAxisValue(
  value: number,
  axisMode: ChartAxisMode,
  priceRange?: number,
): string {
  return axisMode === "percent"
    ? formatPercentAxisValue(value)
    : formatPrice(value, undefined, priceRange, 2, Math.abs(value) >= 1 ? 2 : 4);
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
    const y = getScaledComparisonY(value, min, max, chartTop, chartBottom);

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
    const y = getScaledComparisonY(value, min, max, chartTop, chartBottom);
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

function drawSessionBackgrounds(
  buf: ReturnType<typeof createPixelBuffer>,
  spans: readonly ChartSessionBackgroundSpan[],
  pointCount: number,
  yTop: number,
  yBottom: number,
  colors: ComparisonChartColors,
) {
  if (spans.length === 0 || pointCount === 0) return;
  for (const span of spans) {
    const startIndex = Math.max(Math.min(span.startIndex, pointCount - 1), 0);
    const endIndex = Math.max(Math.min(span.endIndex, pointCount - 1), startIndex);
    const startBand = getComparisonPointBand(startIndex, pointCount, buf.width);
    const endBand = getComparisonPointBand(endIndex, pointCount, buf.width);
    const color = span.kind === "pre" ? colors.preMarketBgColor : colors.postMarketBgColor;
    for (let y = Math.max(yTop, 0); y <= Math.min(yBottom, Math.max(buf.height - 1, 0)); y += 1) {
      for (let x = Math.max(startBand.left, 0); x <= Math.min(endBand.right, Math.max(buf.width - 1, 0)); x += 1) {
        buf.backgrounds[y]![x] = color;
      }
    }
  }
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
      axisFractionDigits: null,
      priceRange: null,
    };
  }

  const dotWidth = scene.width * 2;
  const chartDotBottom = scene.chartRows * 4 - 1;
  const priceRange = scene.max - scene.min;
  const buf = createPixelBuffer(dotWidth, scene.height * 4);
  const gridLines = computeGridLines(scene.min, scene.max, 0, chartDotBottom, 3);
  const axisFractionDigits = scene.axisMode === "price"
    ? resolveAxisFractionDigits(
      gridLines.map((line) => line.price),
      (price, fixedFractionDigits) => formatComparisonAxisValue(price, scene.axisMode, priceRange, fixedFractionDigits),
      getComparisonAxisFractionDigitFloor(priceRange),
    )
    : null;
  drawSessionBackgrounds(
    buf,
    scene.sessionBackgroundSpans,
    scene.dates.length,
    0,
    chartDotBottom,
    scene.colors,
  );
  drawGridLines(buf, gridLines.map((line) => line.y), scene.colors.gridColor);

  const selectedSeries = getSelectedComparisonSeries(scene.series, scene.selectedSymbol);
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
      formatComparisonAxisValue(line.price, scene.axisMode, priceRange, axisFractionDigits ?? undefined),
    );
  }

  return {
    lines: bufferToBrailleLines(buf),
    axisLabels: [...axisLabelsByRow.entries()].map(([row, label]) => ({ row, label })),
    timeLabels: scene.timeLabels,
    activeDate: scene.activeDate,
    selectedSeries: scene.selectedSeries,
    selectedPoint: scene.selectedPoint,
    crosshairValue: scene.crosshairValue,
    cursorColumn: scene.cursorColumn,
    cursorRow: scene.cursorRow,
    axisFractionDigits,
    priceRange,
  };
}
