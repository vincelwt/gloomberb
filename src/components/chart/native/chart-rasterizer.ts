import type { PixelResolution } from "@opentui/core";
import { computeGridLines, type ChartScene } from "../chart-renderer";
import type { ComparisonChartScene } from "../comparison-chart-renderer";
import type { ChartRenderMode } from "../chart-types";

interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface CellRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NativeChartBitmap {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export interface NativeCrosshairOverlay {
  width: number;
  height: number;
  chartRows: number;
  pixelX: number | null;
  pixelY: number | null;
  colors: {
    crosshairColor: string;
  };
}

export interface NativePlacement {
  column: number;
  row: number;
  cols: number;
  rows: number;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function smoothstep(edge0: number, edge1: number, value: number): number {
  const range = edge1 - edge0;
  if (range === 0) return value < edge0 ? 0 : 1;
  const t = clamp((value - edge0) / range, 0, 1);
  return t * t * (3 - 2 * t);
}

function parseHex(hex: string, alpha = 1): RgbaColor {
  const normalized = hex.replace("#", "");
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
    a: Math.round(clamp(alpha, 0, 1) * 255),
  };
}

function blendPixel(
  data: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  color: RgbaColor,
  opacity = 1,
) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;

  const alpha = clamp((color.a / 255) * opacity, 0, 1);
  if (alpha <= 0) return;

  const index = (y * width + x) * 4;
  const dstAlpha = data[index + 3]! / 255;
  const outAlpha = alpha + dstAlpha * (1 - alpha);

  if (outAlpha <= 0) return;

  const dstFactor = dstAlpha * (1 - alpha);
  data[index] = Math.round((color.r * alpha + data[index]! * dstFactor) / outAlpha);
  data[index + 1] = Math.round((color.g * alpha + data[index + 1]! * dstFactor) / outAlpha);
  data[index + 2] = Math.round((color.b * alpha + data[index + 2]! * dstFactor) / outAlpha);
  data[index + 3] = Math.round(outAlpha * 255);
}

function fillBackground(data: Uint8Array, width: number, height: number, color: RgbaColor) {
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    data[offset] = color.r;
    data[offset + 1] = color.g;
    data[offset + 2] = color.b;
    data[offset + 3] = color.a;
  }
}

function drawLine(
  data: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: RgbaColor,
  thickness: number,
) {
  const half = thickness / 2;
  const minX = Math.floor(Math.min(x0, x1) - half - 1);
  const maxX = Math.ceil(Math.max(x0, x1) + half + 1);
  const minY = Math.floor(Math.min(y0, y1) - half - 1);
  const maxY = Math.ceil(Math.max(y0, y1) + half + 1);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const segmentLengthSq = dx * dx + dy * dy || 1;

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const cx = px + 0.5;
      const cy = py + 0.5;
      const projection = clamp(((cx - x0) * dx + (cy - y0) * dy) / segmentLengthSq, 0, 1);
      const nearestX = x0 + dx * projection;
      const nearestY = y0 + dy * projection;
      const distance = Math.hypot(cx - nearestX, cy - nearestY);
      const coverage = 1 - smoothstep(half, half + 1.1, distance);
      if (coverage > 0) {
        blendPixel(data, width, height, px, py, color, coverage);
      }
    }
  }
}

function fillRect(
  data: Uint8Array,
  width: number,
  height: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
  color: RgbaColor,
  opacity = 1,
) {
  for (let y = Math.max(Math.floor(top), 0); y <= Math.min(Math.ceil(bottom), height - 1); y++) {
    for (let x = Math.max(Math.floor(left), 0); x <= Math.min(Math.ceil(right), width - 1); x++) {
      blendPixel(data, width, height, x, y, color, opacity);
    }
  }
}

function drawCircle(
  data: Uint8Array,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radius: number,
  color: RgbaColor,
) {
  const minX = Math.floor(centerX - radius - 1);
  const maxX = Math.ceil(centerX + radius + 1);
  const minY = Math.floor(centerY - radius - 1);
  const maxY = Math.ceil(centerY + radius + 1);

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const distance = Math.hypot(px + 0.5 - centerX, py + 0.5 - centerY);
      const coverage = 1 - smoothstep(radius - 0.65, radius + 0.65, distance);
      if (coverage > 0) {
        blendPixel(data, width, height, px, py, color, coverage);
      }
    }
  }
}

function drawWickOutsideBody(
  data: Uint8Array,
  width: number,
  height: number,
  x: number,
  highY: number,
  lowY: number,
  bodyTop: number,
  bodyBottom: number,
  color: RgbaColor,
) {
  if (highY < bodyTop) {
    drawLine(data, width, height, x, highY, x, bodyTop, color, 1.2);
  }
  if (bodyBottom < lowY) {
    drawLine(data, width, height, x, bodyBottom, x, lowY, color, 1.2);
  }
}

function drawAreaFill(
  data: Uint8Array,
  width: number,
  height: number,
  yByColumn: Float32Array,
  bottom: number,
  color: RgbaColor,
) {
  for (let x = 0; x < yByColumn.length; x++) {
    const yTop = yByColumn[x]!;
    if (!Number.isFinite(yTop)) continue;
    const distance = Math.max(bottom - yTop, 1);
    for (let y = Math.max(Math.floor(yTop), 0); y <= Math.min(Math.ceil(bottom), height - 1); y++) {
      const fade = 1 - (y - yTop) / distance;
      blendPixel(data, width, height, x, y, color, 0.08 + fade * 0.32);
    }
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function getChartPixelLayout(scene: ChartScene, pixelWidth: number, pixelHeight: number) {
  const volumeHeight = scene.showVolume ? Math.max(Math.round((scene.volumeHeight / Math.max(scene.height, 1)) * pixelHeight), 1) : 0;
  const plotHeight = Math.max(pixelHeight - volumeHeight, 1);
  return {
    plotLeft: 0,
    plotTop: 0,
    plotRight: Math.max(pixelWidth - 1, 0),
    plotBottom: Math.max(plotHeight - 1, 0),
    volumeTop: plotHeight,
    volumeBottom: Math.max(pixelHeight - 1, plotHeight),
  };
}

function getComparisonPixelLayout(pixelWidth: number, pixelHeight: number) {
  return {
    plotLeft: 0,
    plotTop: 0,
    plotRight: Math.max(pixelWidth - 1, 0),
    plotBottom: Math.max(pixelHeight - 1, 0),
  };
}

function projectX(index: number, count: number, left: number, right: number): number {
  if (count <= 1) return (left + right) / 2;
  return lerp(left, right, index / (count - 1));
}

function projectY(value: number, min: number, max: number, top: number, bottom: number): number {
  const range = max - min || 1;
  return lerp(bottom, top, (value - min) / range);
}

function drawPriceGrid(
  data: Uint8Array,
  width: number,
  height: number,
  scene: ChartScene,
  top: number,
  bottom: number,
) {
  const gridLines = computeGridLines(scene.min, scene.max, top, bottom, 3);
  const color = parseHex(scene.colors.gridColor, 0.28);

  for (const line of gridLines) {
    drawLine(data, width, height, 0, line.y, width - 1, line.y, color, 1);
  }
}

function drawLineSeries(
  data: Uint8Array,
  width: number,
  height: number,
  scene: ChartScene,
  top: number,
  bottom: number,
) {
  const glow = parseHex(scene.colors.lineColor, 0.2);
  const line = parseHex(scene.colors.lineColor, 0.95);
  const fill = parseHex(scene.colors.fillColor, 0.7);
  const yByColumn = new Float32Array(width).fill(Number.POSITIVE_INFINITY);

  for (let index = 0; index < scene.points.length - 1; index++) {
    const current = scene.points[index]!;
    const next = scene.points[index + 1]!;
    const x0 = projectX(index, scene.points.length, 0, width - 1);
    const x1 = projectX(index + 1, scene.points.length, 0, width - 1);
    const y0 = projectY(current.close, scene.min, scene.max, top, bottom);
    const y1 = projectY(next.close, scene.min, scene.max, top, bottom);

    const start = Math.max(Math.floor(Math.min(x0, x1)), 0);
    const end = Math.min(Math.ceil(Math.max(x0, x1)), width - 1);
    for (let x = start; x <= end; x++) {
      const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
      const y = lerp(y0, y1, clamp(t, 0, 1));
      yByColumn[x] = Math.min(yByColumn[x]!, y);
    }

    if (scene.mode === "area") {
      drawLine(data, width, height, x0, y0, x1, y1, glow, 4);
      drawLine(data, width, height, x0, y0, x1, y1, line, 1.75);
    } else {
      drawLine(data, width, height, x0, y0, x1, y1, glow, 3.2);
      drawLine(data, width, height, x0, y0, x1, y1, line, 1.4);
    }
  }

  if (scene.mode === "area") {
    drawAreaFill(data, width, height, yByColumn, bottom, fill);
  }
}

function drawCandles(
  data: Uint8Array,
  width: number,
  height: number,
  scene: ChartScene,
  top: number,
  bottom: number,
  mode: Extract<ChartRenderMode, "candles" | "ohlc">,
) {
  const spacing = width / Math.max(scene.points.length, 1);
  const bodyWidth = clamp(spacing * 0.58, 2, Math.max(spacing - 1, 2));
  const tickLength = clamp(spacing * 0.34, 2, Math.max(spacing * 0.48, 2));
  const horizontalPad = mode === "ohlc"
    ? Math.ceil(Math.max(tickLength - 1, 0))
    : Math.ceil(bodyWidth / 2);
  const plotLeft = horizontalPad;
  const plotRight = Math.max(width - 1 - horizontalPad, plotLeft);

  for (let index = 0; index < scene.points.length; index++) {
    const point = scene.points[index]!;
    const x = projectX(index, scene.points.length, plotLeft, plotRight);
    const highY = projectY(point.high, scene.min, scene.max, top, bottom);
    const lowY = projectY(point.low, scene.min, scene.max, top, bottom);
    const openY = projectY(point.open, scene.min, scene.max, top, bottom);
    const closeY = projectY(point.close, scene.min, scene.max, top, bottom);
    const isUp = point.close >= point.open;

    const wickColor = parseHex(isUp ? scene.colors.wickUp : scene.colors.wickDown, 0.92);
    const bodyColor = parseHex(isUp ? scene.colors.candleUp : scene.colors.candleDown, 1);

    if (mode === "ohlc") {
      drawLine(data, width, height, x, highY, x, lowY, wickColor, 1.2);
      drawLine(data, width, height, x - tickLength, openY, x, openY, bodyColor, 1.4);
      drawLine(data, width, height, x, closeY, x + tickLength, closeY, bodyColor, 1.4);
      continue;
    }

    const bodyTop = Math.min(openY, closeY);
    const bodyBottom = Math.max(openY, closeY);
    if (Math.abs(bodyBottom - bodyTop) < 1.25) {
      drawLine(data, width, height, x, highY, x, lowY, wickColor, 1.2);
      drawLine(data, width, height, x - bodyWidth / 2, bodyTop, x + bodyWidth / 2, bodyTop, bodyColor, 1.5);
    } else {
      drawWickOutsideBody(data, width, height, x, highY, lowY, bodyTop, bodyBottom, wickColor);
      fillRect(data, width, height, x - bodyWidth / 2, bodyTop, x + bodyWidth / 2, bodyBottom, bodyColor, 1);
    }
  }
}

function drawVolume(
  data: Uint8Array,
  width: number,
  height: number,
  scene: ChartScene,
  top: number,
  bottom: number,
) {
  if (!scene.showVolume || bottom < top) return;

  const volumes = scene.points.map((point) => point.volume);
  const maxVolume = Math.max(...volumes, 1);
  const spacing = width / Math.max(scene.points.length, 1);
  const barWidth = clamp(spacing * 0.72, 1, Math.max(spacing, 1));

  for (let index = 0; index < scene.points.length; index++) {
    const point = scene.points[index]!;
    const heightRatio = point.volume / maxVolume;
    if (heightRatio <= 0) continue;
    const x = projectX(index, scene.points.length, 0, width - 1);
    const barTop = lerp(bottom, top, heightRatio);
    const isUp = scene.mode === "candles" || scene.mode === "ohlc"
      ? point.close >= point.open
      : index === 0 || point.close >= scene.points[index - 1]!.close;
    const color = parseHex(isUp ? scene.colors.volumeUp : scene.colors.volumeDown, 0.6);
    fillRect(data, width, height, x - barWidth / 2, barTop, x + barWidth / 2, bottom, color, 0.8);
  }
}

function drawCrosshairOverlay(
  data: Uint8Array,
  width: number,
  height: number,
  overlay: NativeCrosshairOverlay,
  plotTop: number,
  plotBottom: number,
) {
  if (overlay.pixelX === null || overlay.pixelY === null) return;

  const x = clamp(overlay.pixelX, 0, Math.max(width - 1, 0));
  const y = clamp(overlay.pixelY, plotTop, plotBottom);

  const lineColor = parseHex(overlay.colors.crosshairColor, 0.78);
  const focusColor = parseHex(overlay.colors.crosshairColor, 0.32);
  drawLine(data, width, height, x, 0, x, height - 1, lineColor, 1.05);
  drawLine(data, width, height, 0, y, width - 1, y, lineColor, 1.05);
  drawCircle(data, width, height, x, y, 2.1, focusColor);
}

function getOverlayPlotBottom(overlay: NativeCrosshairOverlay, pixelHeight: number): number {
  if (pixelHeight <= 1 || overlay.height <= 0) return Math.max(pixelHeight - 1, 0);
  const plotHeight = Math.max(Math.round((overlay.chartRows / Math.max(overlay.height, 1)) * pixelHeight), 1);
  return Math.max(Math.min(plotHeight - 1, pixelHeight - 1), 0);
}

export function renderNativeChartBase(scene: ChartScene, pixelWidth: number, pixelHeight: number): NativeChartBitmap {
  const pixels = new Uint8Array(pixelWidth * pixelHeight * 4);
  if (scene.points.length === 0 || pixelWidth <= 0 || pixelHeight <= 0) {
    return { width: Math.max(pixelWidth, 1), height: Math.max(pixelHeight, 1), pixels };
  }

  fillBackground(pixels, pixelWidth, pixelHeight, parseHex(scene.colors.bgColor, 1));
  const layout = getChartPixelLayout(scene, pixelWidth, pixelHeight);
  drawPriceGrid(pixels, pixelWidth, pixelHeight, scene, layout.plotTop, layout.plotBottom);

  switch (scene.mode) {
    case "area":
    case "line":
      drawLineSeries(pixels, pixelWidth, pixelHeight, scene, layout.plotTop, layout.plotBottom);
      break;
    case "candles":
      drawCandles(pixels, pixelWidth, pixelHeight, scene, layout.plotTop, layout.plotBottom, "candles");
      break;
    case "ohlc":
      drawCandles(pixels, pixelWidth, pixelHeight, scene, layout.plotTop, layout.plotBottom, "ohlc");
      break;
  }

  drawVolume(pixels, pixelWidth, pixelHeight, scene, layout.volumeTop, layout.volumeBottom);

  return { width: pixelWidth, height: pixelHeight, pixels };
}

interface ComparisonPathSample {
  x: number;
  y: number;
}

function buildComparisonPath(
  scene: ComparisonChartScene,
  series: ComparisonChartScene["series"][number],
  width: number,
  top: number,
  bottom: number,
) {
  const path: Array<ComparisonPathSample | null> = [];
  const yByColumn = new Float32Array(width).fill(Number.POSITIVE_INFINITY);

  for (let index = 0; index < series.points.length; index += 1) {
    const point = series.points[index]!;
    if (point.value === null) {
      path.push(null);
      continue;
    }

    const x = projectX(index, Math.max(scene.dates.length, 1), 0, width - 1);
    const y = projectY(point.value, scene.min, scene.max, top, bottom);
    path.push({ x, y });

    const roundedX = clamp(Math.round(x), 0, Math.max(width - 1, 0));
    yByColumn[roundedX] = Math.min(yByColumn[roundedX]!, y);

    const previous = path[index - 1] ?? null;
    if (!previous) continue;

    const start = Math.max(Math.floor(Math.min(previous.x, x)), 0);
    const end = Math.min(Math.ceil(Math.max(previous.x, x)), width - 1);
    for (let px = start; px <= end; px += 1) {
      const t = x === previous.x ? 0 : (px - previous.x) / (x - previous.x);
      const interpolatedY = lerp(previous.y, y, clamp(t, 0, 1));
      yByColumn[px] = Math.min(yByColumn[px]!, interpolatedY);
    }
  }

  return { path, yByColumn };
}

function drawComparisonLinePath(
  data: Uint8Array,
  width: number,
  height: number,
  path: Array<ComparisonPathSample | null>,
  color: RgbaColor,
  glow: RgbaColor,
) {
  let previous: ComparisonPathSample | null = null;

  for (const sample of path) {
    if (!sample) {
      previous = null;
      continue;
    }

    if (previous) {
      drawLine(data, width, height, previous.x, previous.y, sample.x, sample.y, glow, 3.2);
      drawLine(data, width, height, previous.x, previous.y, sample.x, sample.y, color, 1.4);
    } else {
      drawLine(data, width, height, sample.x, sample.y, sample.x, sample.y, color, 1.4);
    }

    previous = sample;
  }
}

export function renderNativeComparisonChartBase(
  scene: ComparisonChartScene,
  pixelWidth: number,
  pixelHeight: number,
): NativeChartBitmap {
  const pixels = new Uint8Array(pixelWidth * pixelHeight * 4);
  if (scene.series.length === 0 || scene.dates.length === 0 || pixelWidth <= 0 || pixelHeight <= 0) {
    return { width: Math.max(pixelWidth, 1), height: Math.max(pixelHeight, 1), pixels };
  }

  fillBackground(pixels, pixelWidth, pixelHeight, parseHex(scene.colors.bgColor, 1));
  const layout = getComparisonPixelLayout(pixelWidth, pixelHeight);
  drawPriceGrid(
    pixels,
    pixelWidth,
    pixelHeight,
    {
      min: scene.min,
      max: scene.max,
      colors: { gridColor: scene.colors.gridColor },
    } as ChartScene,
    layout.plotTop,
    layout.plotBottom,
  );

  const selectedSeries = scene.selectedSeries;
  const orderedSeries = [
    ...scene.series.filter((entry) => entry.symbol !== selectedSeries?.symbol),
    ...(selectedSeries ? [selectedSeries] : []),
  ];

  const paths = orderedSeries.map((series) => ({
    series,
    ...buildComparisonPath(scene, series, pixelWidth, layout.plotTop, layout.plotBottom),
  }));

  if (scene.mode === "area") {
    for (const entry of paths) {
      drawAreaFill(
        pixels,
        pixelWidth,
        pixelHeight,
        entry.yByColumn,
        layout.plotBottom,
        parseHex(entry.series.fillColor, 0.7),
      );
    }
  }

  for (const entry of paths) {
    drawComparisonLinePath(
      pixels,
      pixelWidth,
      pixelHeight,
      entry.path,
      parseHex(entry.series.color, 0.96),
      parseHex(entry.series.color, scene.mode === "area" ? 0.18 : 0.22),
    );
  }

  return { width: pixelWidth, height: pixelHeight, pixels };
}

export function renderNativeCrosshairOverlay(
  overlay: NativeCrosshairOverlay,
  pixelWidth: number,
  pixelHeight: number,
): NativeChartBitmap {
  const pixels = new Uint8Array(Math.max(pixelWidth, 1) * Math.max(pixelHeight, 1) * 4);
  if (pixelWidth <= 0 || pixelHeight <= 0) {
    return { width: Math.max(pixelWidth, 1), height: Math.max(pixelHeight, 1), pixels };
  }

  const plotBottom = getOverlayPlotBottom(overlay, pixelHeight);
  drawCrosshairOverlay(pixels, pixelWidth, pixelHeight, overlay, 0, plotBottom);
  return { width: pixelWidth, height: pixelHeight, pixels };
}

export function intersectCellRects(a: CellRect, b: CellRect): CellRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

export function subtractCellRect(rect: CellRect, cut: CellRect): CellRect[] {
  const intersection = intersectCellRects(rect, cut);
  if (!intersection) return [rect];

  const fragments: CellRect[] = [];
  const rectRight = rect.x + rect.width;
  const rectBottom = rect.y + rect.height;
  const cutRight = intersection.x + intersection.width;
  const cutBottom = intersection.y + intersection.height;

  if (intersection.y > rect.y) {
    fragments.push({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: intersection.y - rect.y,
    });
  }

  if (cutBottom < rectBottom) {
    fragments.push({
      x: rect.x,
      y: cutBottom,
      width: rect.width,
      height: rectBottom - cutBottom,
    });
  }

  if (intersection.x > rect.x) {
    fragments.push({
      x: rect.x,
      y: intersection.y,
      width: intersection.x - rect.x,
      height: intersection.height,
    });
  }

  if (cutRight < rectRight) {
    fragments.push({
      x: cutRight,
      y: intersection.y,
      width: rectRight - cutRight,
      height: intersection.height,
    });
  }

  return fragments.filter((fragment) => fragment.width > 0 && fragment.height > 0);
}

export function subtractCellRects(rects: CellRect[], cut: CellRect): CellRect[] {
  return rects.flatMap((rect) => subtractCellRect(rect, cut));
}

export function excludeCellRects(rect: CellRect, cuts: CellRect[]): CellRect[] {
  let fragments = [rect];
  for (const cut of cuts) {
    fragments = subtractCellRects(fragments, cut);
    if (fragments.length === 0) break;
  }
  return fragments;
}

export function computeBitmapSize(rect: CellRect, resolution: PixelResolution, terminalWidth: number, terminalHeight: number) {
  const cellWidth = resolution.width / Math.max(terminalWidth, 1);
  const cellHeight = resolution.height / Math.max(terminalHeight, 1);
  return {
    cellWidth,
    cellHeight,
    pixelWidth: Math.max(1, Math.round(rect.width * cellWidth)),
    pixelHeight: Math.max(1, Math.round(rect.height * cellHeight)),
  };
}

export function computeNativePlacement(
  rect: CellRect,
  visibleRect: CellRect,
  bitmap: NativeChartBitmap,
  resolution: PixelResolution,
  terminalWidth: number,
  terminalHeight: number,
): NativePlacement | null {
  const cellWidth = resolution.width / Math.max(terminalWidth, 1);
  const cellHeight = resolution.height / Math.max(terminalHeight, 1);
  const clipped = intersectCellRects(rect, visibleRect);
  if (!clipped) return null;

  const cropX = Math.max(0, Math.round((clipped.x - rect.x) * cellWidth));
  const cropY = Math.max(0, Math.round((clipped.y - rect.y) * cellHeight));
  const cropWidth = Math.max(1, Math.min(bitmap.width - cropX, Math.round(clipped.width * cellWidth)));
  const cropHeight = Math.max(1, Math.min(bitmap.height - cropY, Math.round(clipped.height * cellHeight)));

  return {
    column: clipped.x + 1,
    row: clipped.y + 1,
    cols: clipped.width,
    rows: clipped.height,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
  };
}

export function computeNativePlacements(
  rect: CellRect,
  visibleRects: CellRect[],
  bitmap: NativeChartBitmap,
  resolution: PixelResolution,
  terminalWidth: number,
  terminalHeight: number,
): NativePlacement[] {
  return visibleRects
    .map((visibleRect) => computeNativePlacement(rect, visibleRect, bitmap, resolution, terminalWidth, terminalHeight))
    .filter((placement): placement is NativePlacement => placement !== null);
}
