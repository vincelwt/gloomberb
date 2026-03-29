import { RGBA } from "@opentui/core";
import type { ChartAxisMode, ChartColors, Pixel, PixelBuffer, ChartRenderMode } from "./chart-types";
import type { ProjectedChartPoint } from "./chart-data";

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

function getX(index: number, pointCount: number, width: number): number {
  if (pointCount <= 1) return Math.floor(width / 2);
  return Math.round((index / (pointCount - 1)) * (width - 1));
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
    const x = getX(i, points.length, buf.width);
    const y = getScaledY(points[i]!.close, min, max, chartTop, chartBottom);
    if (i < points.length - 1) {
      const x1 = getX(i + 1, points.length, buf.width);
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
    const x = getX(i, points.length, buf.width);
    const y = getScaledY(points[i]!.close, min, max, chartTop, chartBottom);

    fillColumn(buf, x, y + 1, chartBottom, fillColor, LAYER_FILL);

    if (i < points.length - 1) {
      const x1 = getX(i + 1, points.length, buf.width);
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
    const x = getX(i, points.length, buf.width);
    const highY = getScaledY(point.high, min, max, chartTop, chartBottom);
    const lowY = getScaledY(point.low, min, max, chartTop, chartBottom);
    const openY = getScaledY(point.open, min, max, chartTop, chartBottom);
    const closeY = getScaledY(point.close, min, max, chartTop, chartBottom);
    const isUp = point.close >= point.open;
    const wickColor = isUp ? palette.wickUp : palette.wickDown;
    const bodyColor = isUp ? palette.candleUp : palette.candleDown;

    // Wick: thin center line
    drawLine(buf, x, highY, x, lowY, wickColor, LAYER_DATA);

    // Body: proportional width
    const bodyTop = Math.min(openY, closeY);
    const bodyBottom = Math.max(openY, closeY);
    if (bodyTop === bodyBottom) {
      const dojiBottom = Math.min(bodyBottom + 1, chartBottom);
      const dojiTop = Math.max(chartTop, dojiBottom - 1);
      fillRect(buf, x - halfW, dojiTop, x + halfW, dojiBottom, bodyColor, LAYER_DATA);
    } else {
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
    const x = getX(i, points.length, buf.width);
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
) {
  const volumes = points.map((point) => point.volume);
  const maxVol = Math.max(...volumes, 1);
  const volH = yBottom - yTop;
  const halfW = getBarHalfWidth(points.length, buf.width);

  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    const x = getX(i, points.length, buf.width);
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
// Legacy half-block conversion (kept for backward compatibility)
// ---------------------------------------------------------------------------

export function bufferToStyledLines(buf: PixelBuffer, bgColor: string): StyledContent[] {
  const lines: StyledContent[] = [];
  const termRows = Math.ceil(buf.height / 2);

  for (let row = 0; row < termRows; row++) {
    const topY = row * 2;
    const botY = row * 2 + 1;
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

    for (let x = 0; x < buf.width; x++) {
      const topPx = buf.pixels[topY]?.[x] ?? null;
      const botPx = (botY < buf.height ? buf.pixels[botY]?.[x] : null) ?? null;
      const top = topPx?.color ?? null;
      const bot = botPx?.color ?? null;

      let char: string;
      let cellFg: string;
      let cellBg: string;

      if (!top && !bot) {
        char = " ";
        cellFg = bgColor;
        cellBg = bgColor;
      } else if (top && !bot) {
        char = "▀";
        cellFg = top;
        cellBg = bgColor;
      } else if (!top && bot) {
        char = "▄";
        cellFg = bot;
        cellBg = bgColor;
      } else if (top === bot) {
        char = "█";
        cellFg = top!;
        cellBg = bgColor;
      } else {
        char = "▀";
        cellFg = top!;
        cellBg = bot!;
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
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (Math.abs(value) >= 1e3 && Math.abs(value) < 1e5) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

function formatPercentAxisValue(value: number): string {
  const abs = Math.abs(value);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(decimals)}%`;
}

function formatAxisValue(value: number, axisMode: ChartAxisMode, basePrice: number): string {
  if (axisMode === "percent" && basePrice !== 0) {
    return formatPercentAxisValue(((value - basePrice) / basePrice) * 100);
  }
  return formatPrice(value);
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

function formatDateForSpan(date: Date | string | number, spanDays: number): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "—";
  if (spanDays <= 365) {
    return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  }
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function buildTimeAxis(dates: Array<Date | string | number>, width: number): string {
  if (dates.length === 0) return "";

  const first = dates[0] instanceof Date ? dates[0]! : new Date(dates[0]!);
  const lastRaw = dates[dates.length - 1]!;
  const last = lastRaw instanceof Date ? lastRaw : new Date(lastRaw);
  const spanMs = last.getTime() - first.getTime();
  const spanDays = Math.max(spanMs / (1000 * 60 * 60 * 24), 1);
  const sampleLabel = formatDateForSpan(first, spanDays);
  const labelWidth = sampleLabel.length + 2;
  const maxLabels = Math.max(Math.floor(width / labelWidth), 2);
  const numLabels = Math.min(maxLabels, dates.length);

  const labels: { pos: number; text: string }[] = [];
  for (let i = 0; i < numLabels; i++) {
    const frac = numLabels === 1 ? 0 : i / (numLabels - 1);
    const dateIdx = Math.round(frac * (dates.length - 1));
    const xPos = Math.round(frac * (width - 1));
    labels.push({
      pos: xPos,
      text: formatDateForSpan(dates[dateIdx]!, spanDays),
    });
  }

  const axis = new Array(width).fill(" ");
  for (const label of labels) {
    const start = Math.max(Math.min(label.pos - Math.floor(label.text.length / 2), width - label.text.length), 0);
    let overlaps = false;
    for (let j = start; j < start + label.text.length && j < width; j++) {
      if (axis[j] !== " ") {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;
    for (let j = 0; j < label.text.length && start + j < width; j++) {
      axis[start + j] = label.text[j]!;
    }
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
  mode: ChartRenderMode;
  axisMode?: ChartAxisMode;
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
  dateAtCursor: Date;
  changeAtCursor: number;
  changePctAtCursor: number;
  timeLabels: string;
  cursorX: number | null;
  cursorRow: number | null;
}

export interface RenderChartResult {
  lines: StyledContent[];
  axisLabels: { row: number; label: string }[];
  timeLabels: string;
  activePoint: ProjectedChartPoint | null;
  priceAtCursor: number | null;
  dateAtCursor: Date | null;
  changeAtCursor: number | null;
  changePctAtCursor: number | null;
  cursorRow: number | null;
  /** Raw pixel buffer for GPU/Kitty rendering path */
  pixelBuffer: PixelBuffer | null;
}

export function getActivePointIndex(pointCount: number, width: number, cursorX: number | null): number {
  if (pointCount <= 0) return 0;
  if (cursorX === null || cursorX < 0 || cursorX >= width) {
    return pointCount - 1;
  }
  return Math.min(
    Math.max(Math.round((cursorX / Math.max(width - 1, 1)) * (pointCount - 1)), 0),
    pointCount - 1,
  );
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
  const activeIdx = getActivePointIndex(points.length, opts.width, opts.cursorX);
  const activePoint = points[activeIdx]!;
  const range = max - min || 1;
  const chartRows = opts.height - (opts.showVolume ? opts.volumeHeight : 0);
  const cursorRow = opts.cursorX === null
    ? null
    : Math.min(
      Math.max(Math.round((1 - (activePoint.close - min) / range) * Math.max(chartRows - 1, 0)), 0),
      Math.max(chartRows - 1, 0),
    );

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
    dateAtCursor: activePoint.date,
    changeAtCursor: activePoint.close - points[0]!.close,
    changePctAtCursor: points[0]!.close ? ((activePoint.close - points[0]!.close) / points[0]!.close) * 100 : 0,
    timeLabels: buildTimeAxis(points.map((point) => point.date), opts.width),
    cursorX: opts.cursorX,
    cursorRow,
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
      dateAtCursor: null,
      changeAtCursor: null,
      changePctAtCursor: null,
      cursorRow: null,
      pixelBuffer: null,
    };
  }

  const { width, colors: palette, mode } = opts;
  const axisMode = opts.axisMode ?? "price";

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
    );
  }

  // Cursor mapping stays in terminal-column space
  const { activePoint, priceAtCursor, dateAtCursor, changeAtCursor, changePctAtCursor } = scene;

  if (opts.cursorX !== null) {
    // Map terminal column to dot column (center of the cell)
    const dotX = opts.cursorX * 2;
    drawCrosshair(buf, dotX, 0, opts.showVolume ? volDotBottom : chartDotBottom, palette.crosshairColor);
  }

  return {
    lines: bufferToBrailleLines(buf, palette.bgColor),
    axisLabels: gridLines.map((line) => ({
      row: Math.floor(line.y / 4), // 4 dot-rows per terminal row
      label: formatAxisValue(line.price, axisMode, points[0]!.close),
    })),
    timeLabels: buildTimeAxis(points.map((point) => point.date), width),
    activePoint,
    priceAtCursor,
    dateAtCursor,
    changeAtCursor,
    changePctAtCursor,
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
