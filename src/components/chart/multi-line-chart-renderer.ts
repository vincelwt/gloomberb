import { buildTimeAxis } from "./chart-renderer";
import type { NativeChartBitmap } from "./native/chart-rasterizer";

export interface MultiLineChartPoint {
  date: Date;
  value: number | null;
}

export interface MultiLineChartSeries {
  id: string;
  label: string;
  color: string;
  points: MultiLineChartPoint[];
}

export interface MultiLineChartColors {
  bgColor: string;
  gridColor: string;
  axisColor: string;
  crosshairColor: string;
}

export interface MultiLineChartSceneOptions {
  width: number;
  height: number;
  colors: MultiLineChartColors;
  dates?: Date[];
  cursorDate?: Date | null;
  yDomain?: { min: number; max: number } | null;
}

export interface MultiLineProjectedPoint {
  seriesId: string;
  date: Date;
  value: number;
  x: number;
  y: number;
  color: string;
}

export interface MultiLineProjectedSeries {
  id: string;
  label: string;
  color: string;
  points: Array<MultiLineProjectedPoint | null>;
}

export interface MultiLineChartScene {
  width: number;
  height: number;
  dates: Date[];
  series: MultiLineProjectedSeries[];
  min: number;
  max: number;
  cursorIndex: number | null;
  cursorX: number | null;
  colors: MultiLineChartColors;
}

const TEXT_SERIES_MARKS = ["●", "◆", "■", "▲", "✦", "•"];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function parseHex(hex: string, alpha = 1) {
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
  color: ReturnType<typeof parseHex>,
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

function fillRect(
  data: Uint8Array,
  width: number,
  height: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
  color: ReturnType<typeof parseHex>,
  opacity = 1,
) {
  for (let y = Math.max(Math.floor(top), 0); y <= Math.min(Math.ceil(bottom), height - 1); y++) {
    for (let x = Math.max(Math.floor(left), 0); x <= Math.min(Math.ceil(right), width - 1); x++) {
      blendPixel(data, width, height, x, y, color, opacity);
    }
  }
}

function drawNativeLine(
  data: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: ReturnType<typeof parseHex>,
  opacity = 1,
) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const steps = Math.max(dx, dy, 1);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    fillRect(data, width, height, x - 0.7, y - 0.7, x + 0.7, y + 0.7, color, opacity);
  }
}

function dateKey(date: Date): number {
  return date.getTime();
}

function collectDates(series: MultiLineChartSeries[], forcedDates?: Date[]): Date[] {
  if (forcedDates && forcedDates.length > 0) {
    return forcedDates
      .filter((date) => Number.isFinite(date.getTime()))
      .sort((left, right) => left.getTime() - right.getTime());
  }

  const byTime = new Map<number, Date>();
  for (const item of series) {
    for (const point of item.points) {
      const time = point.date.getTime();
      if (Number.isFinite(time)) byTime.set(time, point.date);
    }
  }
  return [...byTime.values()].sort((left, right) => left.getTime() - right.getTime());
}

function paddedRange(values: number[], yDomain: MultiLineChartSceneOptions["yDomain"]): { min: number; max: number } {
  if (yDomain && Number.isFinite(yDomain.min) && Number.isFinite(yDomain.max) && yDomain.min !== yDomain.max) {
    return { min: yDomain.min, max: yDomain.max };
  }
  if (values.length === 0) return { min: 0, max: 1 };
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  if (rawMin === rawMax) {
    const delta = Math.max(Math.abs(rawMin) * 0.1, 1);
    return { min: rawMin - delta, max: rawMax + delta };
  }
  const padding = (rawMax - rawMin) * 0.08;
  return { min: rawMin - padding, max: rawMax + padding };
}

function valueToRow(value: number, min: number, max: number, height: number): number {
  const t = (value - min) / (max - min || 1);
  return clamp(Math.round((1 - t) * (height - 1)), 0, height - 1);
}

function valueToPixelY(value: number, min: number, max: number, height: number): number {
  const t = (value - min) / (max - min || 1);
  return clamp((1 - t) * (height - 1), 0, height - 1);
}

function indexToColumn(index: number, count: number, width: number): number {
  if (count <= 1) return Math.round((width - 1) / 2);
  return clamp(Math.round((index / (count - 1)) * (width - 1)), 0, width - 1);
}

function cursorIndexForDate(dates: Date[], cursorDate: Date | null | undefined): number | null {
  if (!cursorDate || dates.length === 0) return null;
  const target = cursorDate.getTime();
  if (!Number.isFinite(target)) return null;
  let bestIndex = 0;
  let bestDistance = Infinity;
  dates.forEach((date, index) => {
    const distance = Math.abs(date.getTime() - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

export function buildMultiLineChartScene(
  series: MultiLineChartSeries[],
  options: MultiLineChartSceneOptions,
): MultiLineChartScene | null {
  const width = Math.max(1, Math.floor(options.width));
  const height = Math.max(1, Math.floor(options.height));
  const dates = collectDates(series, options.dates);
  if (dates.length === 0) return null;

  const values = series.flatMap((item) => item.points)
    .map((point) => point.value)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return null;

  const { min, max } = paddedRange(values, options.yDomain);
  const projectedSeries = series.map((item): MultiLineProjectedSeries => {
    const valuesByDate = new Map<number, number>();
    for (const point of item.points) {
      if (typeof point.value !== "number" || !Number.isFinite(point.value)) continue;
      valuesByDate.set(dateKey(point.date), point.value);
    }

    return {
      id: item.id,
      label: item.label,
      color: item.color,
      points: dates.map((date, index) => {
        const value = valuesByDate.get(dateKey(date));
        if (typeof value !== "number" || !Number.isFinite(value)) return null;
        return {
          seriesId: item.id,
          date,
          value,
          x: indexToColumn(index, dates.length, width),
          y: valueToRow(value, min, max, height),
          color: item.color,
        };
      }),
    };
  });

  const cursorIndex = cursorIndexForDate(dates, options.cursorDate);
  return {
    width,
    height,
    dates,
    series: projectedSeries,
    min,
    max,
    cursorIndex,
    cursorX: cursorIndex === null ? null : indexToColumn(cursorIndex, dates.length, width),
    colors: options.colors,
  };
}

function drawTextLine(rows: string[][], x0: number, y0: number, x1: number, y1: number, mark: string) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const steps = Math.max(dx, dy, 1);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    if (!rows[y]?.[x]) continue;
    rows[y]![x] = mark;
  }
}

export function renderMultiLineChart(scene: MultiLineChartScene): string[] {
  const rows = Array.from({ length: scene.height }, () => Array(scene.width).fill(" "));
  for (let i = 1; i <= 3; i++) {
    const row = Math.round((scene.height - 1) * (i / 4));
    for (let x = 0; x < scene.width; x += 3) rows[row]![x] = "·";
  }

  scene.series.forEach((item, seriesIndex) => {
    const mark = TEXT_SERIES_MARKS[seriesIndex % TEXT_SERIES_MARKS.length]!;
    let previous: MultiLineProjectedPoint | null = null;
    for (const point of item.points) {
      if (!point) {
        previous = null;
        continue;
      }
      if (previous) drawTextLine(rows, previous.x, previous.y, point.x, point.y, mark);
      rows[point.y]![point.x] = mark;
      previous = point;
    }
  });

  if (scene.cursorX !== null) {
    for (let y = 0; y < scene.height; y++) {
      const current = rows[y]![scene.cursorX];
      rows[y]![scene.cursorX] = current === " " || current === "·" ? "│" : "╋";
    }
  }

  return rows.map((row) => row.join(""));
}

export function renderMultiLineTimeAxis(scene: MultiLineChartScene): string {
  return buildTimeAxis(scene.dates, scene.width);
}

export function resolveMultiLineCursorDate(scene: MultiLineChartScene, localCellX: number): Date | null {
  if (scene.dates.length === 0) return null;
  const x = clamp(localCellX, 0, Math.max(scene.width - 1, 0));
  const index = scene.width <= 1
    ? 0
    : clamp(Math.round((x / Math.max(scene.width - 1, 1)) * (scene.dates.length - 1)), 0, scene.dates.length - 1);
  return scene.dates[index] ?? null;
}

export function renderNativeMultiLineChart(
  scene: MultiLineChartScene,
  pixelWidth: number,
  pixelHeight: number,
): NativeChartBitmap {
  const width = Math.max(1, Math.floor(pixelWidth));
  const height = Math.max(1, Math.floor(pixelHeight));
  const data = new Uint8Array(width * height * 4);
  const bg = parseHex(scene.colors.bgColor, 1);
  const grid = parseHex(scene.colors.gridColor, 0.35);
  const crosshair = parseHex(scene.colors.crosshairColor, 0.9);

  fillRect(data, width, height, 0, 0, width - 1, height - 1, bg, 1);

  for (let i = 1; i <= 3; i++) {
    const y = (height - 1) * (i / 4);
    fillRect(data, width, height, 0, y, width - 1, y + 0.7, grid, 0.45);
  }

  const projectX = (x: number) => (x / Math.max(scene.width - 1, 1)) * (width - 1);
  const projectIndexX = (index: number) => (
    scene.dates.length <= 1
      ? (width - 1) / 2
      : (index / (scene.dates.length - 1)) * (width - 1)
  );
  const projectValueY = (value: number) => valueToPixelY(value, scene.min, scene.max, height);

  for (const item of scene.series) {
    const color = parseHex(item.color, 0.96);
    let previous: { x: number; y: number } | null = null;
    item.points.forEach((point, index) => {
      if (!point) {
        previous = null;
        return;
      }
      const current = {
        x: projectIndexX(index),
        y: projectValueY(point.value),
      };
      if (previous) {
        drawNativeLine(
          data,
          width,
          height,
          previous.x,
          previous.y,
          current.x,
          current.y,
          color,
          0.92,
        );
      }
      previous = current;
    });
  }

  if (scene.cursorX !== null) {
    const cursorIndex = scene.cursorIndex;
    const x = cursorIndex === null ? projectX(scene.cursorX) : projectIndexX(cursorIndex);
    fillRect(data, width, height, x - 0.6, 0, x + 0.6, height - 1, crosshair, 0.82);
    if (cursorIndex === null) return { width, height, pixels: data };
    for (const item of scene.series) {
      const point = item.points[cursorIndex] ?? null;
      if (!point) continue;
      const color = parseHex(item.color, 1);
      const pointX = projectIndexX(cursorIndex);
      const pointY = projectValueY(point.value);
      fillRect(data, width, height, pointX - 2.2, pointY - 2.2, pointX + 2.2, pointY + 2.2, color, 1);
    }
  }

  return { width, height, pixels: data };
}
