import { RGBA } from "@opentui/core";
import type { ChartColors, PixelBuffer, ChartRenderMode } from "./chart-types";
import type { ProjectedChartPoint } from "./chart-data";

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

export function drawLine(
  buf: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
) {
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;

  while (true) {
    setPixel(buf, x, y, color);
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

function fillColumn(buf: PixelBuffer, x: number, y0: number, y1: number, color: string) {
  const start = Math.min(y0, y1);
  const end = Math.max(y0, y1);
  for (let y = start; y <= end; y++) {
    setPixel(buf, x, y, color);
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
      drawLine(buf, x, y, x1, y1, lineColor);
    } else {
      setPixel(buf, x, y, lineColor);
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

  for (let i = 0; i < points.length; i++) {
    const x = getX(i, points.length, buf.width);
    const y = getScaledY(points[i]!.close, min, max, chartTop, chartBottom);

    fillColumn(buf, x, y + 1, chartBottom, fillColor);

    if (i < points.length - 1) {
      const x1 = getX(i + 1, points.length, buf.width);
      const y1 = getScaledY(points[i + 1]!.close, min, max, chartTop, chartBottom);
      drawLine(buf, x, y, x1, y1, lineColor);

      for (let cx = Math.min(x, x1); cx <= Math.max(x, x1); cx++) {
        if (cx === x || cx === x1) continue;
        const t = (cx - x) / Math.max(Math.abs(x1 - x), 1);
        const iy = Math.round(y + t * (y1 - y));
        fillColumn(buf, cx, iy + 1, chartBottom, fillColor);
      }
    } else {
      setPixel(buf, x, y, lineColor);
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

    drawLine(buf, x, highY, x, lowY, wickColor);

    const bodyTop = Math.min(openY, closeY);
    const bodyBottom = Math.max(openY, closeY);
    if (bodyTop === bodyBottom) {
      const dojiBottom = Math.min(bodyBottom + 1, chartBottom);
      const dojiTop = Math.max(chartTop, dojiBottom - 1);
      fillColumn(buf, x, dojiTop, dojiBottom, bodyColor);
    } else {
      fillColumn(buf, x, bodyTop, bodyBottom, bodyColor);
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
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    const x = getX(i, points.length, buf.width);
    const highY = getScaledY(point.high, min, max, chartTop, chartBottom);
    const lowY = getScaledY(point.low, min, max, chartTop, chartBottom);
    const openY = getScaledY(point.open, min, max, chartTop, chartBottom);
    const closeY = getScaledY(point.close, min, max, chartTop, chartBottom);
    const isUp = point.close >= point.open;
    const color = isUp ? palette.candleUp : palette.candleDown;

    drawLine(buf, x, highY, x, lowY, color);
    setPixel(buf, x, openY, color);
    setPixel(buf, Math.max(x - 1, 0), openY, color);
    setPixel(buf, x, closeY, color);
    setPixel(buf, Math.min(x + 1, buf.width - 1), closeY, color);
  }
}

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

  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    const x = getX(i, points.length, buf.width);
    const barH = Math.round((point.volume / maxVol) * volH);
    if (barH === 0) continue;

    const isUp = trendMode === "openClose"
      ? point.close >= point.open
      : i === 0 || point.close >= points[i - 1]!.close;
    const color = isUp ? upColor : downColor;

    for (let y = yBottom - barH; y <= yBottom; y++) {
      setPixel(buf, x, y, color);
    }
  }
}

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

export function formatPrice(value: number): string {
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (Math.abs(value) >= 1e3 && Math.abs(value) < 1e5) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
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

export interface RenderChartOptions {
  width: number;
  height: number;
  showVolume: boolean;
  volumeHeight: number;
  cursorX: number | null;
  mode: ChartRenderMode;
  colors: ResolvedChartPalette;
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
}

export function renderChart(
  points: ProjectedChartPoint[],
  opts: RenderChartOptions,
): RenderChartResult {
  if (points.length === 0) {
    return {
      lines: [],
      axisLabels: [],
      timeLabels: "",
      activePoint: null,
      priceAtCursor: null,
      dateAtCursor: null,
      changeAtCursor: null,
      changePctAtCursor: null,
    };
  }

  const { width, colors: palette, mode } = opts;
  const volTermRows = opts.showVolume ? opts.volumeHeight : 0;
  const chartTermRows = opts.height - volTermRows;
  const totalPixelH = opts.height * 2;
  const chartPixelBottom = chartTermRows * 2 - 1;
  const volPixelTop = chartTermRows * 2;
  const volPixelBottom = totalPixelH - 1;

  const buf = createPixelBuffer(width, totalPixelH);
  const min = mode === "candles" || mode === "ohlc"
    ? Math.min(...points.map((point) => point.low))
    : Math.min(...points.map((point) => point.close));
  const max = mode === "candles" || mode === "ohlc"
    ? Math.max(...points.map((point) => point.high))
    : Math.max(...points.map((point) => point.close));

  const gridLines = computeGridLines(min, max, 0, chartPixelBottom, 3);
  drawGridLines(buf, gridLines.map((line) => line.y), palette.gridColor);

  switch (mode) {
    case "area":
      drawAreaChart(buf, points, 0, chartPixelBottom, palette.lineColor, palette.fillColor, min, max);
      break;
    case "line":
      drawLineSeries(buf, points, 0, chartPixelBottom, palette.lineColor, min, max);
      break;
    case "candles":
      drawCandlestickChart(buf, points, 0, chartPixelBottom, palette, min, max);
      break;
    case "ohlc":
      drawOhlcChart(buf, points, 0, chartPixelBottom, palette, min, max);
      break;
  }

  if (opts.showVolume && volTermRows > 0) {
    drawVolumeBars(
      buf,
      points,
      volPixelTop,
      volPixelBottom,
      palette.volumeUp,
      palette.volumeDown,
      mode === "candles" || mode === "ohlc" ? "openClose" : "previousClose",
    );
  }

  const activeIdx = opts.cursorX !== null && opts.cursorX >= 0 && opts.cursorX < width
    ? Math.min(
      Math.max(Math.round((opts.cursorX / Math.max(width - 1, 1)) * (points.length - 1)), 0),
      points.length - 1,
    )
    : points.length - 1;
  const activePoint = points[activeIdx]!;
  const priceAtCursor = activePoint.close;
  const dateAtCursor = activePoint.date;
  const changeAtCursor = activePoint.close - points[0]!.close;
  const changePctAtCursor = points[0]!.close ? ((activePoint.close - points[0]!.close) / points[0]!.close) * 100 : 0;

  if (opts.cursorX !== null) {
    drawCrosshair(buf, opts.cursorX, 0, opts.showVolume ? volPixelBottom : chartPixelBottom, palette.crosshairColor);
  }

  return {
    lines: bufferToStyledLines(buf, palette.bgColor),
    axisLabels: gridLines.map((line) => ({
      row: Math.floor(line.y / 2),
      label: formatPrice(line.price),
    })),
    timeLabels: buildTimeAxis(points.map((point) => point.date), width),
    activePoint,
    priceAtCursor,
    dateAtCursor,
    changeAtCursor,
    changePctAtCursor,
  };
}
