import { RGBA } from "@opentui/core";
import type { PricePoint } from "../../types/financials";
import type { PixelBuffer, ChartColors } from "./chart-types";

/** A styled chunk for OpenTUI text rendering */
interface StyledChunk {
  __isChunk: true;
  text: string;
  fg?: RGBA;
  bg?: RGBA;
  attributes: number;
}

/** Styled content object passable to <text content={...}> */
export interface StyledContent {
  chunks: StyledChunk[];
}

function makeChunk(text: string, fgColor: string, bgColor: string): StyledChunk {
  return {
    __isChunk: true,
    text,
    fg: RGBA.fromHex(fgColor),
    bg: RGBA.fromHex(bgColor),
    attributes: 0,
  };
}

// ─── Pixel Buffer ───────────────────────────────────────────────

export function createPixelBuffer(width: number, heightPixels: number): PixelBuffer {
  const pixels: (string | null)[][] = [];
  for (let y = 0; y < heightPixels; y++) {
    pixels.push(new Array(width).fill(null));
  }
  return { width, height: heightPixels, pixels };
}

function setPixel(buf: PixelBuffer, x: number, y: number, color: string) {
  if (x >= 0 && x < buf.width && y >= 0 && y < buf.height) {
    buf.pixels[y]![x] = color;
  }
}

// ─── Drawing Primitives ─────────────────────────────────────────

/** Bresenham line drawing */
export function drawLine(
  buf: PixelBuffer,
  x0: number, y0: number,
  x1: number, y1: number,
  color: string,
) {
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0, y = y0;

  while (true) {
    setPixel(buf, x, y, color);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

/** Fill a vertical column from y0 down to yMax */
function fillColumn(buf: PixelBuffer, x: number, y0: number, yMax: number, color: string) {
  for (let y = y0; y <= yMax; y++) {
    setPixel(buf, x, y, color);
  }
}

// ─── Chart Drawing ──────────────────────────────────────────────

/**
 * Draw area chart: line + filled area below.
 */
export function drawAreaChart(
  buf: PixelBuffer,
  points: PricePoint[],
  chartTop: number,
  chartBottom: number,
  lineColor: string,
  fillColor: string,
) {
  if (points.length === 0) return;

  const closes = points.map(p => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const chartH = chartBottom - chartTop;

  const pixelYs = closes.map(v =>
    chartTop + Math.round((1 - (v - min) / range) * chartH)
  );

  const getX = (i: number) =>
    points.length === 1 ? Math.floor(buf.width / 2) :
    Math.round((i / (points.length - 1)) * (buf.width - 1));

  for (let i = 0; i < points.length; i++) {
    const x = getX(i);
    const y = pixelYs[i]!;

    // Fill area below line
    fillColumn(buf, x, y + 1, chartBottom, fillColor);

    if (i < points.length - 1) {
      const x1 = getX(i + 1);
      const y1 = pixelYs[i + 1]!;
      drawLine(buf, x, y, x1, y1, lineColor);

      // Fill area between line segments
      for (let cx = Math.min(x, x1); cx <= Math.max(x, x1); cx++) {
        if (cx === x || cx === x1) continue;
        const tVal = (cx - x) / (x1 - x);
        const iy = Math.round(y + tVal * (y1 - y));
        fillColumn(buf, cx, iy + 1, chartBottom, fillColor);
      }
    } else {
      setPixel(buf, x, y, lineColor);
    }
  }
}

/**
 * Draw volume bars at the bottom of the chart.
 */
export function drawVolumeBars(
  buf: PixelBuffer,
  points: PricePoint[],
  yTop: number,
  yBottom: number,
  upColor: string,
  downColor: string,
) {
  const volumes = points.map(p => p.volume ?? 0);
  const maxVol = Math.max(...volumes, 1);
  const volH = yBottom - yTop;

  const getX = (i: number) =>
    points.length === 1 ? Math.floor(buf.width / 2) :
    Math.round((i / (points.length - 1)) * (buf.width - 1));

  for (let i = 0; i < points.length; i++) {
    const x = getX(i);
    const vol = volumes[i]!;
    const barH = Math.round((vol / maxVol) * volH);
    if (barH === 0) continue;

    const isUp = i === 0 || points[i]!.close >= points[i - 1]!.close;
    const color = isUp ? upColor : downColor;

    for (let y = yBottom - barH; y <= yBottom; y++) {
      setPixel(buf, x, y, color);
    }
  }
}

/**
 * Draw vertical crosshair line (dashed).
 */
export function drawCrosshair(
  buf: PixelBuffer,
  x: number,
  yTop: number,
  yBottom: number,
  color: string,
) {
  if (x < 0 || x >= buf.width) return;
  for (let y = yTop; y <= yBottom; y++) {
    if (Math.floor(y / 2) % 2 === 0) {
      setPixel(buf, x, y, color);
    }
  }
}

/**
 * Draw subtle horizontal grid lines (dotted).
 */
export function drawGridLines(
  buf: PixelBuffer,
  yPositions: number[],
  color: string,
) {
  for (const y of yPositions) {
    if (y < 0 || y >= buf.height) continue;
    for (let x = 0; x < buf.width; x++) {
      if (x % 3 === 0 && !buf.pixels[y]![x]) {
        setPixel(buf, x, y, color);
      }
    }
  }
}

// ─── Output Conversion ─────────────────────────────────────────

/**
 * Convert pixel buffer to styled content lines using half-block characters.
 * Each terminal row = 2 virtual pixel rows.
 * Returns StyledContent objects for <text content={...}>.
 */
export function bufferToStyledLines(buf: PixelBuffer, bgColor: string): StyledContent[] {
  const lines: StyledContent[] = [];
  const termRows = Math.ceil(buf.height / 2);

  for (let row = 0; row < termRows; row++) {
    const topY = row * 2;
    const botY = row * 2 + 1;
    const chunks: StyledChunk[] = [];

    // Track runs of identical styling for coalescing
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
      const top = buf.pixels[topY]?.[x] ?? null;
      const bot = (botY < buf.height ? buf.pixels[botY]?.[x] : null) ?? null;

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

      // Coalesce runs of identical char+fg+bg
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

// ─── Axis Rendering ─────────────────────────────────────────────

export function formatPrice(value: number): string {
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (Math.abs(value) >= 1e3 && Math.abs(value) < 1e5) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(date: Date): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "—";
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDateShort(date: Date): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "—";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/**
 * Format a date label appropriate to the time span being displayed.
 * - < 30 days: "Mar 15"
 * - 30-365 days: "Mar 15" (but labels placed at month boundaries)
 * - > 365 days: "Mar 2025"
 */
function formatDateForSpan(date: Date, spanDays: number): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "—";
  if (spanDays <= 365) {
    return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  }
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Build a smart time axis string with evenly-spaced labels
 * that adapt to the zoom level and time span.
 */
export function buildTimeAxis(dates: Date[], width: number): string {
  if (dates.length === 0) return "";

  const toDate = (d: Date | string | number) => d instanceof Date ? d : new Date(d);
  const first = toDate(dates[0]!);
  const last = toDate(dates[dates.length - 1]!);
  const spanMs = last.getTime() - first.getTime();
  const spanDays = Math.max(spanMs / (1000 * 60 * 60 * 24), 1);

  // Determine label format and compute how wide each label is
  const sampleLabel = formatDateForSpan(first, spanDays);
  const labelWidth = sampleLabel.length + 2; // padding between labels

  // How many labels can fit
  const maxLabels = Math.max(Math.floor(width / labelWidth), 2);
  const numLabels = Math.min(maxLabels, dates.length);

  // Pick evenly-spaced date indices
  const labels: { pos: number; text: string }[] = [];
  for (let i = 0; i < numLabels; i++) {
    const frac = numLabels === 1 ? 0 : i / (numLabels - 1);
    const dateIdx = Math.round(frac * (dates.length - 1));
    const xPos = Math.round(frac * (width - 1));
    const text = formatDateForSpan(toDate(dates[dateIdx]!), spanDays);
    labels.push({ pos: xPos, text });
  }

  // Render into a fixed-width string, avoiding overlaps
  const axis = new Array(width).fill(" ");
  for (const label of labels) {
    // Center the label around its position
    const start = Math.max(Math.min(label.pos - Math.floor(label.text.length / 2), width - label.text.length), 0);
    // Check for overlap with existing text
    let overlaps = false;
    for (let j = start; j < start + label.text.length && j < width; j++) {
      if (axis[j] !== " ") { overlaps = true; break; }
    }
    if (overlaps) continue;
    for (let j = 0; j < label.text.length && start + j < width; j++) {
      axis[start + j] = label.text[j]!;
    }
  }

  return axis.join("");
}

/**
 * Compute grid line Y positions and their price labels.
 */
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
    const price = max - frac * range;
    const y = chartTop + Math.round(frac * chartH);
    result.push({ y, price });
  }

  return result;
}

// ─── Full Chart Render ──────────────────────────────────────────

export interface RenderChartOptions {
  width: number;
  height: number;
  showVolume: boolean;
  volumeHeight: number;
  cursorX: number | null;
  colors: ChartColors;
}

export interface RenderChartResult {
  lines: StyledContent[];
  axisLabels: { row: number; label: string }[];
  timeLabels: string;
  priceAtCursor: number | null;
  dateAtCursor: Date | null;
  changeAtCursor: number | null;
  changePctAtCursor: number | null;
}

export function renderChart(
  points: PricePoint[],
  opts: RenderChartOptions,
): RenderChartResult {
  if (points.length === 0) {
    return {
      lines: [],
      axisLabels: [],
      timeLabels: "",
      priceAtCursor: null,
      dateAtCursor: null,
      changeAtCursor: null,
      changePctAtCursor: null,
    };
  }

  const { width, colors: c } = opts;
  const volTermRows = opts.showVolume ? opts.volumeHeight : 0;
  const chartTermRows = opts.height - volTermRows;
  const totalPixelH = opts.height * 2;
  const chartPixelBottom = chartTermRows * 2 - 1;
  const volPixelTop = chartTermRows * 2;
  const volPixelBottom = totalPixelH - 1;

  const buf = createPixelBuffer(width, totalPixelH);

  const closes = points.map(p => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);

  // Grid lines
  const gridLines = computeGridLines(min, max, 0, chartPixelBottom, 3);
  drawGridLines(buf, gridLines.map(g => g.y), c.gridColor);

  // Area chart
  drawAreaChart(buf, points, 0, chartPixelBottom, c.lineColor, c.fillColor);

  // Volume
  if (opts.showVolume && volTermRows > 0) {
    drawVolumeBars(buf, points, volPixelTop, volPixelBottom, c.volumeUp, c.volumeDown);
  }

  // Cursor
  let priceAtCursor: number | null = null;
  let dateAtCursor: Date | null = null;
  let changeAtCursor: number | null = null;
  let changePctAtCursor: number | null = null;

  if (opts.cursorX !== null && opts.cursorX >= 0 && opts.cursorX < width) {
    const dataIdx = Math.round((opts.cursorX / Math.max(width - 1, 1)) * (points.length - 1));
    const clamped = Math.min(Math.max(dataIdx, 0), points.length - 1);
    const point = points[clamped]!;
    priceAtCursor = point.close;
    dateAtCursor = point.date;
    changeAtCursor = point.close - points[0]!.close;
    changePctAtCursor = points[0]!.close ? ((point.close - points[0]!.close) / points[0]!.close) * 100 : 0;

    drawCrosshair(buf, opts.cursorX, 0, opts.showVolume ? volPixelBottom : chartPixelBottom, c.crosshairColor);
  }

  const lines = bufferToStyledLines(buf, c.bgColor);

  const axisLabels = gridLines.map(g => ({
    row: Math.floor(g.y / 2),
    label: formatPrice(g.price),
  }));

  // Time axis
  const dates = points.map(p => p.date);
  const timeLabels = buildTimeAxis(dates, width);

  return {
    lines,
    axisLabels,
    timeLabels,
    priceAtCursor,
    dateAtCursor,
    changeAtCursor,
    changePctAtCursor,
  };
}
