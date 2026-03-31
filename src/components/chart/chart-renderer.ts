import { RGBA } from "@opentui/core";
import type { ChartAxisMode, ChartColors, Pixel, PixelBuffer, ChartRenderMode } from "./chart-types";
import type { ProjectedChartPoint } from "./chart-data";
import { formatCurrency } from "../../utils/format";

// ---------------------------------------------------------------------------
// Styled output types (unchanged public API)
// ---------------------------------------------------------------------------

interface StyledChunk {
  __isChunk: true;
  text: string;
  fg?: RGBA;
  bg?: RGBA;
  attributes: number;
}

export interface StyledContent {
  chunks: StyledChunk[];
}

// ---------------------------------------------------------------------------
// Layer constants — higher values win when pixels overlap
// ---------------------------------------------------------------------------

const LAYER_GRID = 0;
const LAYER_FILL = 1;
const LAYER_DATA = 2;
const LAYER_CROSSHAIR = 3;

// ---------------------------------------------------------------------------
// Braille character mapping
// Each terminal cell maps to a 2×4 dot grid. Unicode braille = U+2800 + bits.
//   Col 0    Col 1
//   bit 0    bit 3   (row 0, top)
//   bit 1    bit 4   (row 1)
//   bit 2    bit 5   (row 2)
//   bit 6    bit 7   (row 3, bottom)
// ---------------------------------------------------------------------------

const BRAILLE_BASE = 0x2800;
const BRAILLE_DOT: number[][] = [
  [0x01, 0x08], // row 0
  [0x02, 0x10], // row 1
  [0x04, 0x20], // row 2
  [0x40, 0x80], // row 3
];

// ---------------------------------------------------------------------------
// Palette resolution
// ---------------------------------------------------------------------------

interface ChartPaletteInput {
  bg: string;
  border: string;
  borderFocused: string;
  text: string;
  textDim: string;
  positive: string;
  negative: string;
}

export interface ResolvedChartPalette extends ChartColors {
  candleUp: string;
  candleDown: string;
  wickUp: string;
  wickDown: string;
}

type VolumeTrendMode = "previousClose" | "openClose";

function makeChunk(text: string, fgColor: string, bgColor: string): StyledChunk {
  return {
    __isChunk: true,
    text,
    fg: RGBA.fromHex(fgColor),
    bg: RGBA.fromHex(bgColor),
    attributes: 0,
  };
}

function blendHex(a: string, b: string, ratio: number): string {
  const parse = (hex: string) => {
    const h = hex.replace("#", "");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] as const;
  };

  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const mix = (x: number, y: number) => Math.round(x + (y - x) * ratio).toString(16).padStart(2, "0");
  return `#${mix(ar, br)}${mix(ag, bg)}${mix(ab, bb)}`;
}

export function resolveChartPalette(
  baseColors: ChartPaletteInput,
  trend: "positive" | "negative" | "neutral" = "positive",
): ResolvedChartPalette {
  const lineColor = trend === "negative"
    ? baseColors.negative
    : trend === "neutral"
      ? baseColors.text
      : baseColors.positive;

  return {
    lineColor,
    fillColor: blendHex(baseColors.bg, lineColor, 0.22),
    volumeUp: blendHex(baseColors.bg, baseColors.positive, 0.35),
    volumeDown: blendHex(baseColors.bg, baseColors.negative, 0.35),
    gridColor: blendHex(baseColors.bg, baseColors.border, 0.55),
    crosshairColor: baseColors.borderFocused,
    bgColor: baseColors.bg,
    axisColor: baseColors.textDim,
    activeRangeColor: baseColors.text,
    inactiveRangeColor: blendHex(baseColors.bg, baseColors.textDim, 0.75),
    candleUp: baseColors.positive,
    candleDown: baseColors.negative,
    wickUp: blendHex(baseColors.positive, baseColors.text, 0.35),
    wickDown: blendHex(baseColors.negative, baseColors.text, 0.35),
  };
}

// ---------------------------------------------------------------------------
// Pixel buffer — now at braille resolution (2× wide, 4× tall)
// ---------------------------------------------------------------------------

export function createPixelBuffer(width: number, heightPixels: number): PixelBuffer {
  const pixels: (Pixel | null)[][] = [];
  for (let y = 0; y < heightPixels; y++) {
    pixels.push(new Array(width).fill(null));
  }
  return { width, height: heightPixels, pixels };
}

function setPixel(buf: PixelBuffer, x: number, y: number, color: string, layer: number) {
  if (x >= 0 && x < buf.width && y >= 0 && y < buf.height) {
    const existing = buf.pixels[y]![x];
    if (!existing || layer >= existing.layer) {
      buf.pixels[y]![x] = { color, layer };
    }
  }
}

// ---------------------------------------------------------------------------
// Drawing primitives
// ---------------------------------------------------------------------------

export function drawLine(
  buf: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  layer: number = LAYER_DATA,
) {
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;

  while (true) {
    setPixel(buf, x, y, color, layer);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

function fillColumn(buf: PixelBuffer, x: number, y0: number, y1: number, color: string, layer: number) {
  const start = Math.min(y0, y1);
  const end = Math.max(y0, y1);
  for (let y = start; y <= end; y++) {
    setPixel(buf, x, y, color, layer);
  }
}

function fillRect(buf: PixelBuffer, x0: number, y0: number, x1: number, y1: number, color: string, layer: number) {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    fillColumn(buf, x, y0, y1, color, layer);
  }
}

function drawWickOutsideBody(
  buf: PixelBuffer,
  x: number,
  highY: number,
  lowY: number,
  bodyTop: number,
  bodyBottom: number,
  color: string,
) {
  if (highY < bodyTop) {
    drawLine(buf, x, highY, x, bodyTop, color, LAYER_DATA);
  }
  if (bodyBottom < lowY) {
    drawLine(buf, x, bodyBottom, x, lowY, color, LAYER_DATA);
  }
}

function getSeriesPosition(
  index: number,
  pointCount: number,
  width: number,
  startPadding = 0,
  endPadding = startPadding,
): number {
  const start = Math.max(startPadding, 0);
  const end = Math.max(start, width - 1 - Math.max(endPadding, 0));
  if (pointCount <= 1) return Math.round((start + end) / 2);
  return Math.round(start + (index / (pointCount - 1)) * (end - start));
}

function getScaledY(value: number, min: number, max: number, chartTop: number, chartBottom: number): number {
  const range = max - min || 1;
  const chartH = chartBottom - chartTop;
  return chartTop + Math.round((1 - (value - min) / range) * chartH);
}

// ---------------------------------------------------------------------------
// Proportional element widths for braille resolution
// ---------------------------------------------------------------------------

function getCandleHalfWidth(pointCount: number, bufWidth: number): number {
  if (pointCount <= 1) return 2;
  const spacing = bufWidth / pointCount;
  const bodyW = Math.min(Math.max(Math.round(spacing * 0.55), 2), 10);
  return Math.floor(bodyW / 2);
}

function getBarHalfWidth(pointCount: number, bufWidth: number): number {
  if (pointCount <= 1) return 2;
  const spacing = bufWidth / pointCount;
  const barW = Math.min(Math.max(Math.round(spacing * 0.45), 1), 10);
  return Math.floor(barW / 2);
}

function getDotX(index: number, pointCount: number, width: number, mode: ChartRenderMode): number {
  switch (mode) {
    case "candles": {
      const pad = getCandleHalfWidth(pointCount, width);
      return getSeriesPosition(index, pointCount, width, pad, pad);
    }
    case "ohlc": {
      const tickLen = Math.max(getCandleHalfWidth(pointCount, width), 2);
      const pad = Math.max(tickLen - 1, 0);
      return getSeriesPosition(index, pointCount, width, pad, pad);
    }
    default:
      return getSeriesPosition(index, pointCount, width);
  }
}

function getPointDotX(index: number, pointCount: number, width: number, mode: ChartRenderMode): number {
  return getDotX(index, pointCount, Math.max(width * 2, 1), mode);
}

export function getPointTerminalColumn(index: number, pointCount: number, width: number, mode: ChartRenderMode): number {
  if (width <= 1) return 0;
  return Math.min(Math.max(Math.floor(getPointDotX(index, pointCount, width, mode) / 2), 0), width - 1);
}

// ---------------------------------------------------------------------------
// Chart mode renderers
// ---------------------------------------------------------------------------

function drawLineSeries(
  buf: PixelBuffer,
  points: ProjectedChartPoint[],
  chartTop: number,
  chartBottom: number,
  lineColor: string,
  min: number,
  max: number,
) {
  if (points.length === 0) return;

  for (let i = 0; i < points.length; i++) {
    const x = getDotX(i, points.length, buf.width, "line");
    const y = getScaledY(points[i]!.close, min, max, chartTop, chartBottom);
    if (i < points.length - 1) {
      const x1 = getDotX(i + 1, points.length, buf.width, "line");
      const y1 = getScaledY(points[i + 1]!.close, min, max, chartTop, chartBottom);
      drawLine(buf, x, y, x1, y1, lineColor, LAYER_DATA);
    } else {
      setPixel(buf, x, y, lineColor, LAYER_DATA);
    }
  }
}

function drawAreaChart(
  buf: PixelBuffer,
  points: ProjectedChartPoint[],
  chartTop: number,
  chartBottom: number,
  lineColor: string,
  fillColor: string,
  min: number,
  max: number,
) {
  if (points.length === 0) return;

  // Draw fill first (lower layer), then line on top
  for (let i = 0; i < points.length; i++) {
    const x = getDotX(i, points.length, buf.width, "area");
    const y = getScaledY(points[i]!.close, min, max, chartTop, chartBottom);

    fillColumn(buf, x, y + 1, chartBottom, fillColor, LAYER_FILL);

    if (i < points.length - 1) {
      const x1 = getDotX(i + 1, points.length, buf.width, "area");
      const y1 = getScaledY(points[i + 1]!.close, min, max, chartTop, chartBottom);

      // Interpolate fill between consecutive points
      for (let cx = Math.min(x, x1); cx <= Math.max(x, x1); cx++) {
        if (cx === x || cx === x1) continue;
        const t = (cx - x) / Math.max(Math.abs(x1 - x), 1);
        const iy = Math.round(y + t * (y1 - y));
        fillColumn(buf, cx, iy + 1, chartBottom, fillColor, LAYER_FILL);
      }

      // Line on top
      drawLine(buf, x, y, x1, y1, lineColor, LAYER_DATA);
    } else {
      setPixel(buf, x, y, lineColor, LAYER_DATA);
    }
  }
}

function drawCandlestickChart(
  buf: PixelBuffer,
  points: ProjectedChartPoint[],
  chartTop: number,
  chartBottom: number,
  palette: ResolvedChartPalette,
  min: number,
  max: number,
) {
  const halfW = getCandleHalfWidth(points.length, buf.width);

  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    const x = getDotX(i, points.length, buf.width, "candles");
    const highY = getScaledY(point.high, min, max, chartTop, chartBottom);
    const lowY = getScaledY(point.low, min, max, chartTop, chartBottom);
    const openY = getScaledY(point.open, min, max, chartTop, chartBottom);
    const closeY = getScaledY(point.close, min, max, chartTop, chartBottom);
    const isUp = point.close >= point.open;
    const wickColor = isUp ? palette.wickUp : palette.wickDown;
    const bodyColor = isUp ? palette.candleUp : palette.candleDown;

    // Body: proportional width
    const bodyTop = Math.min(openY, closeY);
    const bodyBottom = Math.max(openY, closeY);
    if (bodyTop === bodyBottom) {
      drawLine(buf, x, highY, x, lowY, wickColor, LAYER_DATA);
      const dojiBottom = Math.min(bodyBottom + 1, chartBottom);
      const dojiTop = Math.max(chartTop, dojiBottom - 1);
      fillRect(buf, x - halfW, dojiTop, x + halfW, dojiBottom, bodyColor, LAYER_DATA);
    } else {
      drawWickOutsideBody(buf, x, highY, lowY, bodyTop, bodyBottom, wickColor);
      fillRect(buf, x - halfW, bodyTop, x + halfW, bodyBottom, bodyColor, LAYER_DATA);
    }
  }
}

function drawOhlcChart(
  buf: PixelBuffer,
  points: ProjectedChartPoint[],
  chartTop: number,
  chartBottom: number,
  palette: ResolvedChartPalette,
  min: number,
  max: number,
) {
  const tickLen = Math.max(getCandleHalfWidth(points.length, buf.width), 2);

  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    const x = getDotX(i, points.length, buf.width, "ohlc");
    const highY = getScaledY(point.high, min, max, chartTop, chartBottom);
    const lowY = getScaledY(point.low, min, max, chartTop, chartBottom);
    const openY = getScaledY(point.open, min, max, chartTop, chartBottom);
    const closeY = getScaledY(point.close, min, max, chartTop, chartBottom);
    const isUp = point.close >= point.open;
    const color = isUp ? palette.candleUp : palette.candleDown;

    // Vertical line
    drawLine(buf, x, highY, x, lowY, color, LAYER_DATA);

    // Open tick extends left
    for (let dx = 0; dx < tickLen; dx++) {
      setPixel(buf, x - dx, openY, color, LAYER_DATA);
    }
    // Close tick extends right
    for (let dx = 0; dx < tickLen; dx++) {
      setPixel(buf, x + dx, closeY, color, LAYER_DATA);
    }
  }
}

// ---------------------------------------------------------------------------
// Volume bars
// ---------------------------------------------------------------------------

export function drawVolumeBars(
  buf: PixelBuffer,
  points: ProjectedChartPoint[],
  yTop: number,
  yBottom: number,
  upColor: string,
  downColor: string,
  trendMode: VolumeTrendMode,
  mode: ChartRenderMode,
) {
  const volumes = points.map((point) => point.volume);
  const maxVol = Math.max(...volumes, 1);
  const volH = yBottom - yTop;
  const halfW = getBarHalfWidth(points.length, buf.width);

  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    const x = getDotX(i, points.length, buf.width, mode);
    const barH = Math.round((point.volume / maxVol) * volH);
    if (barH === 0) continue;

    const isUp = trendMode === "openClose"
      ? point.close >= point.open
      : i === 0 || point.close >= points[i - 1]!.close;
    const color = isUp ? upColor : downColor;

    fillRect(buf, x - halfW, yBottom - barH, x + halfW, yBottom, color, LAYER_FILL);
  }
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

export function drawCrosshair(
  buf: PixelBuffer,
  x: number,
  yTop: number,
  yBottom: number,
  color: string,
) {
  if (x < 0 || x >= buf.width) return;
  // Dashed pattern: 2 dots on, 2 dots off
  for (let y = yTop; y <= yBottom; y++) {
    if (y % 4 < 2) {
      setPixel(buf, x, y, color, LAYER_CROSSHAIR);
    }
  }
}

export function drawGridLines(
  buf: PixelBuffer,
  yPositions: number[],
  color: string,
) {
  for (const y of yPositions) {
    if (y < 0 || y >= buf.height) continue;
    // Dotted horizontal line — dot every 6th column (≈ every 3 terminal columns)
    for (let x = 0; x < buf.width; x++) {
      if (x % 6 === 0 && !buf.pixels[y]![x]) {
        setPixel(buf, x, y, color, LAYER_GRID);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Braille buffer → styled terminal output
// ---------------------------------------------------------------------------

export function bufferToBrailleLines(buf: PixelBuffer, bgColor: string): StyledContent[] {
  const lines: StyledContent[] = [];
  const termCols = Math.ceil(buf.width / 2);
  const termRows = Math.ceil(buf.height / 4);

  for (let row = 0; row < termRows; row++) {
    const chunks: StyledChunk[] = [];
    let runChar = "";
    let runFg = "";
    let runBg = "";
    let runLen = 0;

    const flushRun = () => {
      if (runLen > 0) {
        chunks.push(makeChunk(runChar.repeat(runLen), runFg, runBg));
        runLen = 0;
      }
    };

    for (let col = 0; col < termCols; col++) {
      let topLayer = -1;

      // Track dots per layer so we can render only the top layer's dots
      const dotsByLayer: Map<number, number> = new Map(); // layer → braille bits
      const colorByLayer: Map<number, Map<string, number>> = new Map();

      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const px = col * 2 + dx;
          const py = row * 4 + dy;
          if (px >= buf.width || py >= buf.height) continue;
          const pixel = buf.pixels[py]?.[px] ?? null;
          if (pixel) {
            const bit = BRAILLE_DOT[dy]![dx]!;
            dotsByLayer.set(pixel.layer, (dotsByLayer.get(pixel.layer) || 0) | bit);
            if (!colorByLayer.has(pixel.layer)) colorByLayer.set(pixel.layer, new Map());
            const counts = colorByLayer.get(pixel.layer)!;
            counts.set(pixel.color, (counts.get(pixel.color) || 0) + 1);
            if (pixel.layer > topLayer) {
              topLayer = pixel.layer;
            }
          }
        }
      }

      let char: string;
      let cellFg: string;
      let cellBg: string;

      if (topLayer < 0) {
        char = " ";
        cellFg = bgColor;
        cellBg = bgColor;
      } else {
        // Only show dots from the highest layer — keeps lines thin in mixed
        // cells (e.g. area chart where line and fill overlap).
        const pattern = dotsByLayer.get(topLayer) || 0;
        char = String.fromCharCode(BRAILLE_BASE + pattern);

        const topCounts: Map<string, number> = colorByLayer.get(topLayer) ?? new Map();
        let topColor = "";
        let bestCount = 0;
        for (const [c, n] of topCounts) {
          if (n > bestCount) { bestCount = n; topColor = c; }
        }

        cellFg = topColor;
        cellBg = bgColor;
      }

      if (char === runChar && cellFg === runFg && cellBg === runBg) {
        runLen++;
      } else {
        flushRun();
        runChar = char;
        runFg = cellFg;
        runBg = cellBg;
        runLen = 1;
      }
    }

    flushRun();
    lines.push({ chunks });
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatPrice(value: number): string {
  return formatPriceWithCurrency(value);
}

function formatPercentAxisValue(value: number): string {
  const abs = Math.abs(value);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(decimals)}%`;
}

const currencySymbols = new Map<string, string>();

function getCurrencySymbol(currency: string): string {
  const cached = currencySymbols.get(currency);
  if (cached) return cached;

  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    currencyDisplay: "symbol",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  const symbol = formatter.formatToParts(0).find((part) => part.type === "currency")?.value ?? currency;
  currencySymbols.set(currency, symbol);
  return symbol;
}

export function formatPriceWithCurrency(value: number, currency = "USD"): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const symbol = getCurrencySymbol(currency);

  if (abs >= 1e6) return `${sign}${symbol}${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3 && abs < 1e5) return `${sign}${symbol}${(abs / 1e3).toFixed(1)}K`;
  return formatCurrency(value, currency);
}

export function formatAxisValue(value: number, axisMode: ChartAxisMode, basePrice: number, currency = "USD"): string {
  if (axisMode === "percent" && basePrice !== 0) {
    return formatPercentAxisValue(((value - basePrice) / basePrice) * 100);
  }
  return formatPriceWithCurrency(value, currency);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "—";
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDateShort(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "—";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

const AXIS_MS_SECOND = 1_000;
const AXIS_MS_MINUTE = 60 * AXIS_MS_SECOND;
const AXIS_MS_HOUR = 60 * AXIS_MS_MINUTE;
const AXIS_MS_DAY = 24 * AXIS_MS_HOUR;
const AXIS_MS_MONTH = 30 * AXIS_MS_DAY;
const AXIS_MS_YEAR = 365 * AXIS_MS_DAY;

type AxisLabelUnit = "year" | "month" | "day" | "hour" | "minute" | "second" | "millisecond";

function formatClockTime(date: Date, unit: AxisLabelUnit): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");

  switch (unit) {
    case "hour":
    case "minute":
      return `${hours}:${minutes}`;
    case "second":
      return `${hours}:${minutes}:${seconds}`;
    case "millisecond":
      return `${hours}:${minutes}:${seconds}.${milliseconds}`;
    default:
      return `${hours}:${minutes}`;
  }
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function isSameCalendarMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth();
}

function getMinPositiveGapMs(dates: Date[]): number {
  let minGapMs = Number.POSITIVE_INFINITY;

  for (let index = 1; index < dates.length; index += 1) {
    const current = dates[index]!;
    const previous = dates[index - 1]!;
    const gapMs = Math.abs(current.getTime() - previous.getTime());
    if (gapMs > 0 && gapMs < minGapMs) {
      minGapMs = gapMs;
    }
  }

  return Number.isFinite(minGapMs) ? minGapMs : 0;
}

function resolveAxisLabelUnit(stepMs: number): AxisLabelUnit {
  if (stepMs >= AXIS_MS_YEAR) return "year";
  if (stepMs >= AXIS_MS_MONTH) return "month";
  if (stepMs >= AXIS_MS_DAY) return "day";
  if (stepMs >= AXIS_MS_HOUR) return "hour";
  if (stepMs >= AXIS_MS_MINUTE) return "minute";
  if (stepMs >= AXIS_MS_SECOND) return "second";
  return "millisecond";
}

function estimateAxisLabelWidth(unit: AxisLabelUnit, first: Date, last: Date): number {
  const spansMultipleDays = !isSameCalendarDay(first, last);
  const spansMultipleYears = first.getFullYear() !== last.getFullYear();

  switch (unit) {
    case "year":
      return 4;
    case "month":
      return spansMultipleYears ? 8 : 5;
    case "day":
      return spansMultipleYears ? 10 : 6;
    case "hour":
    case "minute":
      return spansMultipleDays ? 12 : 8;
    case "second":
      return spansMultipleDays ? 17 : 12;
    case "millisecond":
      return spansMultipleDays ? 21 : 16;
  }
}

function formatTimeAxisLabel(
  date: Date,
  previousDate: Date | null,
  unit: AxisLabelUnit,
): string {
  if (isNaN(date.getTime())) return "—";

  switch (unit) {
    case "year":
      return `${date.getFullYear()}`;
    case "month":
      if (previousDate && previousDate.getFullYear() === date.getFullYear()) {
        return MONTHS[date.getMonth()]!;
      }
      return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
    case "day":
      if (previousDate && isSameCalendarMonth(previousDate, date)) {
        return `${date.getDate()}`;
      }
      if (previousDate && previousDate.getFullYear() === date.getFullYear()) {
        return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
      }
      return `${MONTHS[date.getMonth()]} ${date.getDate()} ${date.getFullYear()}`;
    case "hour":
    case "minute":
    case "second":
    case "millisecond": {
      const timeLabel = formatClockTime(date, unit);
      if (previousDate && isSameCalendarDay(previousDate, date)) {
        return timeLabel;
      }
      if (previousDate && previousDate.getFullYear() === date.getFullYear()) {
        return `${MONTHS[date.getMonth()]} ${date.getDate()} ${timeLabel}`;
      }
      return `${MONTHS[date.getMonth()]} ${date.getDate()} ${date.getFullYear()} ${timeLabel}`;
    }
  }
}

function formatTimeAxisBoundaryLabel(date: Date, unit: AxisLabelUnit, counterpart: Date): string {
  if (isNaN(date.getTime())) return "—";

  switch (unit) {
    case "year":
      return `${date.getFullYear()}`;
    case "month":
      return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
    case "day":
      return counterpart.getFullYear() === date.getFullYear()
        ? `${MONTHS[date.getMonth()]} ${date.getDate()}`
        : `${MONTHS[date.getMonth()]} ${date.getDate()} ${date.getFullYear()}`;
    case "hour":
    case "minute":
    case "second":
    case "millisecond": {
      const timeLabel = formatClockTime(date, unit);
      if (isSameCalendarDay(date, counterpart)) {
        return timeLabel;
      }
      if (counterpart.getFullYear() === date.getFullYear()) {
        return `${MONTHS[date.getMonth()]} ${date.getDate()} ${timeLabel}`;
      }
      return `${MONTHS[date.getMonth()]} ${date.getDate()} ${date.getFullYear()} ${timeLabel}`;
    }
  }
}

function resolveAxisLabelStart(pos: number, label: string, width: number): number {
  return Math.max(Math.min(pos - Math.floor(label.length / 2), width - label.length), 0);
}

function resolveCenteredAxisLabelStart(label: string, width: number): number {
  return Math.max(Math.floor((width - label.length) / 2), 0);
}

function writeAxisLabel(axis: string[], start: number, label: string) {
  for (let index = 0; index < label.length && start + index < axis.length; index += 1) {
    axis[start + index] = label[index]!;
  }
}

export function buildTimeAxis(dates: Array<Date | string | number>, width: number): string {
  if (dates.length === 0 || width <= 0) return "";

  const normalizedDates = dates.map((value) => (value instanceof Date ? value : new Date(value)));
  const first = normalizedDates[0]!;
  const last = normalizedDates[normalizedDates.length - 1]!;
  const rawSpanMs = last.getTime() - first.getTime();
  const spanMs = Math.max(rawSpanMs, 1);
  const roughLabelCount = Math.max(Math.floor(width / 10), 2);
  const minGapMs = getMinPositiveGapMs(normalizedDates);
  const effectiveStepMs = Math.max(spanMs / Math.max(roughLabelCount - 1, 1), minGapMs || 0);
  const unit = resolveAxisLabelUnit(effectiveStepMs);
  const allSameTimestamp = rawSpanMs === 0 && minGapMs === 0;
  const axis = new Array(width).fill(" ");
  const minGap = unit === "year" || unit === "month" ? 2 : 1;
  const idealLabelWidth = estimateAxisLabelWidth(unit, first, last);
  const targetLabelCount = Math.min(
    normalizedDates.length,
    Math.max(Math.floor(width / (idealLabelWidth + minGap)), 2),
  );
  const candidateIndices = [...new Set(
    Array.from({ length: targetLabelCount }, (_, index) => (
      targetLabelCount === 1
        ? 0
        : Math.round((index / (targetLabelCount - 1)) * (normalizedDates.length - 1))
    )),
  )];

  const firstLabel = formatTimeAxisBoundaryLabel(first, unit, last);
  if (allSameTimestamp) {
    const centeredStart = resolveCenteredAxisLabelStart(firstLabel, width);
    writeAxisLabel(axis, centeredStart, firstLabel);
    return axis.join("");
  }

  const firstStart = resolveAxisLabelStart(0, firstLabel, width);
  writeAxisLabel(axis, firstStart, firstLabel);
  const placedLabels = new Set<string>([firstLabel]);

  let lastPlacedDate = first;
  let lastEnd = firstStart + firstLabel.length - 1;

  const lastPos = width - 1;
  const lastLabel = normalizedDates.length === 1
    ? firstLabel
    : formatTimeAxisBoundaryLabel(last, unit, first);
  const lastStart = resolveAxisLabelStart(lastPos, lastLabel, width);
  const lastFits = normalizedDates.length === 1 || lastStart > lastEnd + minGap;

  for (const index of candidateIndices.slice(1, -1)) {
    const date = normalizedDates[index]!;
    if (isNaN(date.getTime())) continue;

    const pos = Math.round((index / (normalizedDates.length - 1)) * (width - 1));
    const label = formatTimeAxisLabel(date, lastPlacedDate, unit);
    if (placedLabels.has(label)) continue;
    const start = resolveAxisLabelStart(pos, label, width);
    const end = start + label.length - 1;

    if (label === axis.slice(start, end + 1).join("")) continue;
    if (start <= lastEnd + minGap) continue;
    if (lastFits && end >= lastStart - minGap) continue;

    writeAxisLabel(axis, start, label);
    placedLabels.add(label);
    lastPlacedDate = date;
    lastEnd = end;
  }

  if (normalizedDates.length > 1 && lastFits && !placedLabels.has(lastLabel)) {
    writeAxisLabel(axis, lastStart, lastLabel);
  }

  return axis.join("");
}

// ---------------------------------------------------------------------------
// Grid lines & price axis
// ---------------------------------------------------------------------------

export function computeGridLines(
  min: number,
  max: number,
  chartTop: number,
  chartBottom: number,
  numLines: number,
): { y: number; price: number }[] {
  const range = max - min || 1;
  const chartH = chartBottom - chartTop;
  const result: { y: number; price: number }[] = [];

  for (let i = 0; i <= numLines; i++) {
    const frac = i / numLines;
    result.push({
      y: chartTop + Math.round(frac * chartH),
      price: max - frac * range,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main render entry point
// ---------------------------------------------------------------------------

export interface RenderChartOptions {
  width: number;
  height: number;
  showVolume: boolean;
  volumeHeight: number;
  cursorX: number | null;
  cursorY: number | null;
  mode: ChartRenderMode;
  axisMode?: ChartAxisMode;
  currency?: string;
  colors: ResolvedChartPalette;
}

export interface ChartScene {
  points: ProjectedChartPoint[];
  width: number;
  height: number;
  showVolume: boolean;
  volumeHeight: number;
  chartRows: number;
  mode: ChartRenderMode;
  colors: ResolvedChartPalette;
  min: number;
  max: number;
  activeIdx: number;
  activePoint: ProjectedChartPoint;
  priceAtCursor: number;
  crosshairPrice: number | null;
  dateAtCursor: Date;
  changeAtCursor: number;
  changePctAtCursor: number;
  timeLabels: string;
  cursorX: number | null;
  cursorY: number | null;
  cursorColumn: number | null;
  cursorRow: number | null;
  cursorDotX: number | null;
}

export interface RenderChartResult {
  lines: StyledContent[];
  axisLabels: { row: number; label: string }[];
  timeLabels: string;
  activePoint: ProjectedChartPoint | null;
  priceAtCursor: number | null;
  crosshairPrice: number | null;
  dateAtCursor: Date | null;
  changeAtCursor: number | null;
  changePctAtCursor: number | null;
  cursorColumn: number | null;
  cursorRow: number | null;
  /** Raw pixel buffer for GPU/Kitty rendering path */
  pixelBuffer: PixelBuffer | null;
}

export function getActivePointIndex(
  pointCount: number,
  width: number,
  cursorX: number | null,
  mode: ChartRenderMode,
): number {
  if (pointCount <= 0) return 0;
  if (cursorX === null || cursorX < 0 || cursorX >= width) {
    return pointCount - 1;
  }

  let bestIndex = pointCount - 1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < pointCount; index += 1) {
    const pointColumn = getPointTerminalColumn(index, pointCount, width, mode);
    const distance = Math.abs(pointColumn - cursorX);
    if (distance <= bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

export function buildChartScene(
  points: ProjectedChartPoint[],
  opts: RenderChartOptions,
): ChartScene | null {
  if (points.length === 0) return null;

  const min = opts.mode === "candles" || opts.mode === "ohlc"
    ? Math.min(...points.map((point) => point.low))
    : Math.min(...points.map((point) => point.close));
  const max = opts.mode === "candles" || opts.mode === "ohlc"
    ? Math.max(...points.map((point) => point.high))
    : Math.max(...points.map((point) => point.close));
  const activeIdx = getActivePointIndex(points.length, opts.width, opts.cursorX, opts.mode);
  const activePoint = points[activeIdx]!;
  const range = max - min || 1;
  const chartRows = opts.height - (opts.showVolume ? opts.volumeHeight : 0);
  const cursorX = opts.cursorX === null
    ? null
    : Math.min(Math.max(opts.cursorX, 0), Math.max(opts.width - 1, 0));
  const cursorColumn = cursorX === null
    ? null
    : Math.round(cursorX);
  const cursorDotX = cursorX === null
    ? null
    : Math.round((cursorX / Math.max(opts.width - 1, 1)) * Math.max(opts.width * 2 - 1, 0));
  const cursorY = cursorX === null
    ? null
    : opts.cursorY !== null
      ? Math.min(Math.max(opts.cursorY, 0), Math.max(chartRows - 1, 0))
      : Math.min(
        Math.max(Math.round((1 - (activePoint.close - min) / range) * Math.max(chartRows - 1, 0)), 0),
        Math.max(chartRows - 1, 0),
      );
  const cursorRow = cursorY === null
    ? null
    : Math.round(cursorY);
  const crosshairPrice = cursorY === null
    ? null
    : max - (cursorY / Math.max(chartRows - 1, 1)) * range;

  return {
    points,
    width: opts.width,
    height: opts.height,
    showVolume: opts.showVolume,
    volumeHeight: opts.volumeHeight,
    chartRows,
    mode: opts.mode,
    colors: opts.colors,
    min,
    max,
    activeIdx,
    activePoint,
    priceAtCursor: activePoint.close,
    crosshairPrice,
    dateAtCursor: activePoint.date,
    changeAtCursor: activePoint.close - points[0]!.close,
    changePctAtCursor: points[0]!.close ? ((activePoint.close - points[0]!.close) / points[0]!.close) * 100 : 0,
    timeLabels: buildTimeAxis(points.map((point) => point.date), opts.width),
    cursorX,
    cursorY,
    cursorColumn,
    cursorRow,
    cursorDotX,
  };
}

export function renderChart(
  points: ProjectedChartPoint[],
  opts: RenderChartOptions,
): RenderChartResult {
  const scene = buildChartScene(points, opts);
  if (!scene) {
    return {
      lines: [],
      axisLabels: [],
      timeLabels: "",
      activePoint: null,
      priceAtCursor: null,
      crosshairPrice: null,
      dateAtCursor: null,
      changeAtCursor: null,
      changePctAtCursor: null,
      cursorColumn: null,
      cursorRow: null,
      pixelBuffer: null,
    };
  }

  const { width, colors: palette, mode } = opts;
  const axisMode = opts.axisMode ?? "price";
  const currency = opts.currency ?? "USD";

  // Braille resolution: 2 dot-columns per terminal column, 4 dot-rows per terminal row
  const dotWidth = width * 2;
  const volTermRows = opts.showVolume ? opts.volumeHeight : 0;
  const chartTermRows = opts.height - volTermRows;
  const totalDotH = opts.height * 4;
  const chartDotBottom = chartTermRows * 4 - 1;
  const volDotTop = chartTermRows * 4;
  const volDotBottom = totalDotH - 1;

  const buf = createPixelBuffer(dotWidth, totalDotH);
  const { min, max } = scene;

  const gridLines = computeGridLines(min, max, 0, chartDotBottom, 3);
  drawGridLines(buf, gridLines.map((line) => line.y), palette.gridColor);

  switch (mode) {
    case "area":
      drawAreaChart(buf, points, 0, chartDotBottom, palette.lineColor, palette.fillColor, min, max);
      break;
    case "line":
      drawLineSeries(buf, points, 0, chartDotBottom, palette.lineColor, min, max);
      break;
    case "candles":
      drawCandlestickChart(buf, points, 0, chartDotBottom, palette, min, max);
      break;
    case "ohlc":
      drawOhlcChart(buf, points, 0, chartDotBottom, palette, min, max);
      break;
  }

  if (opts.showVolume && volTermRows > 0) {
    drawVolumeBars(
      buf,
      points,
      volDotTop,
      volDotBottom,
      palette.volumeUp,
      palette.volumeDown,
      mode === "candles" || mode === "ohlc" ? "openClose" : "previousClose",
      mode,
    );
  }

  // Cursor mapping stays in terminal-column space
  const { activePoint, priceAtCursor, crosshairPrice, dateAtCursor, changeAtCursor, changePctAtCursor } = scene;

  if (scene.cursorDotX !== null) {
    drawCrosshair(buf, scene.cursorDotX, 0, opts.showVolume ? volDotBottom : chartDotBottom, palette.crosshairColor);
  }

  const axisLabelsByRow = new Map<number, string>();
  for (const line of gridLines) {
    axisLabelsByRow.set(
      Math.min(Math.floor(line.y / 4), Math.max(chartTermRows - 1, 0)),
      formatAxisValue(line.price, axisMode, points[0]!.close, currency),
    );
  }

  return {
    lines: bufferToBrailleLines(buf, palette.bgColor),
    axisLabels: [...axisLabelsByRow.entries()].map(([row, label]) => ({ row, label })),
    timeLabels: buildTimeAxis(points.map((point) => point.date), width),
    activePoint,
    priceAtCursor,
    crosshairPrice,
    dateAtCursor,
    changeAtCursor,
    changePctAtCursor,
    cursorColumn: scene.cursorColumn,
    cursorRow: scene.cursorRow,
    pixelBuffer: buf,
  };
}

// ---------------------------------------------------------------------------
// Pixel buffer → RGBA conversion for Kitty graphics protocol
// ---------------------------------------------------------------------------

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * Convert a PixelBuffer to RGBA pixel data for use with drawSuperSampleBuffer.
 * Each pixel in the buffer maps to one RGBA pixel in the output.
 */
export function pixelBufferToRGBA(buf: PixelBuffer, bgColor: string): Uint8Array {
  const [bgR, bgG, bgB] = parseHex(bgColor);
  const data = new Uint8Array(buf.width * buf.height * 4);
  const colorCache = new Map<string, [number, number, number]>();

  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      const offset = (y * buf.width + x) * 4;
      const pixel = buf.pixels[y]?.[x] ?? null;
      if (pixel) {
        let rgb = colorCache.get(pixel.color);
        if (!rgb) {
          rgb = parseHex(pixel.color);
          colorCache.set(pixel.color, rgb);
        }
        data[offset] = rgb[0];
        data[offset + 1] = rgb[1];
        data[offset + 2] = rgb[2];
        data[offset + 3] = 255;
      } else {
        data[offset] = bgR;
        data[offset + 1] = bgG;
        data[offset + 2] = bgB;
        data[offset + 3] = 255;
      }
    }
  }

  return data;
}
