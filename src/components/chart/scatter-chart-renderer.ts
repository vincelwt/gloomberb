import type { NativeChartBitmap } from "./native/chart-rasterizer";
import { fillRect, parseHex } from "./native/raster-primitives";

export interface ScatterChartPoint {
  x: number;
  y: number;
  highlight?: boolean;
}

export interface ScatterRegressionLine {
  slope: number;
  intercept: number;
  color: string;
}

export interface ScatterChartColors {
  bgColor: string;
  gridColor: string;
  axisColor: string;
  pointColor: string;
  highlightColor: string;
}

export interface ScatterChartSceneOptions {
  width: number;
  height: number;
  colors: ScatterChartColors;
  regression?: ScatterRegressionLine | null;
}

export interface ScatterChartScene {
  width: number;
  height: number;
  points: ScatterChartPoint[];
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zeroX: number | null;
  zeroY: number | null;
  colors: ScatterChartColors;
  regression: ScatterRegressionLine | null;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function drawLine(
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
    fillRect(data, width, height, x - 0.6, y - 0.6, x + 0.6, y + 0.6, color, opacity);
  }
}

function paddedRange(values: number[]): { min: number; max: number } {
  if (values.length === 0) return { min: -1, max: 1 };
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  if (rawMin === rawMax) {
    const delta = Math.max(Math.abs(rawMin) * 0.1, 1);
    return { min: rawMin - delta, max: rawMax + delta };
  }
  const padding = (rawMax - rawMin) * 0.12;
  return { min: rawMin - padding, max: rawMax + padding };
}

function valueToColumn(value: number, min: number, max: number, width: number): number {
  return clamp(Math.round(((value - min) / (max - min || 1)) * (width - 1)), 0, width - 1);
}

function valueToRow(value: number, min: number, max: number, height: number): number {
  return clamp(Math.round((1 - ((value - min) / (max - min || 1))) * (height - 1)), 0, height - 1);
}

export function buildScatterChartScene(
  points: ScatterChartPoint[],
  options: ScatterChartSceneOptions,
): ScatterChartScene | null {
  const normalized = points.filter((point) => (
    Number.isFinite(point.x) && Number.isFinite(point.y)
  ));
  if (normalized.length === 0) return null;

  const width = Math.max(1, Math.floor(options.width));
  const height = Math.max(1, Math.floor(options.height));
  const xRange = paddedRange(normalized.map((point) => point.x));
  const yRange = paddedRange(normalized.map((point) => point.y));
  const zeroX = xRange.min <= 0 && xRange.max >= 0
    ? valueToColumn(0, xRange.min, xRange.max, width)
    : null;
  const zeroY = yRange.min <= 0 && yRange.max >= 0
    ? valueToRow(0, yRange.min, yRange.max, height)
    : null;

  return {
    width,
    height,
    points: normalized,
    xMin: xRange.min,
    xMax: xRange.max,
    yMin: yRange.min,
    yMax: yRange.max,
    zeroX,
    zeroY,
    colors: options.colors,
    regression: options.regression ?? null,
  };
}

export function renderScatterChart(scene: ScatterChartScene): string[] {
  const rows = Array.from({ length: scene.height }, () => Array(scene.width).fill(" "));
  if (scene.zeroY !== null) {
    for (let x = 0; x < scene.width; x++) rows[scene.zeroY]![x] = "─";
  }
  if (scene.zeroX !== null) {
    for (let y = 0; y < scene.height; y++) rows[y]![scene.zeroX] = "│";
  }

  if (scene.regression) {
    for (let x = 0; x < scene.width; x++) {
      const valueX = scene.xMin + (x / Math.max(scene.width - 1, 1)) * (scene.xMax - scene.xMin);
      const valueY = scene.regression.slope * valueX + scene.regression.intercept;
      if (!Number.isFinite(valueY)) continue;
      const y = valueToRow(valueY, scene.yMin, scene.yMax, scene.height);
      if (rows[y]![x] === " ") rows[y]![x] = "·";
    }
  }

  for (const point of scene.points) {
    const x = valueToColumn(point.x, scene.xMin, scene.xMax, scene.width);
    const y = valueToRow(point.y, scene.yMin, scene.yMax, scene.height);
    rows[y]![x] = point.highlight ? "●" : "•";
  }

  return rows.map((row) => row.join(""));
}

export function renderNativeScatterChart(
  scene: ScatterChartScene,
  pixelWidth: number,
  pixelHeight: number,
): NativeChartBitmap {
  const width = Math.max(1, Math.floor(pixelWidth));
  const height = Math.max(1, Math.floor(pixelHeight));
  const data = new Uint8Array(width * height * 4);
  const bg = parseHex(scene.colors.bgColor, 1);
  const grid = parseHex(scene.colors.gridColor, 0.35);
  const axis = parseHex(scene.colors.axisColor, 0.72);
  const pointColor = parseHex(scene.colors.pointColor, 0.9);
  const highlightColor = parseHex(scene.colors.highlightColor, 1);

  fillRect(data, width, height, 0, 0, width - 1, height - 1, bg, 1);

  for (let i = 1; i <= 3; i++) {
    const x = (width - 1) * (i / 4);
    const y = (height - 1) * (i / 4);
    fillRect(data, width, height, x, 0, x + 0.7, height - 1, grid, 0.45);
    fillRect(data, width, height, 0, y, width - 1, y + 0.7, grid, 0.45);
  }

  if (scene.zeroX !== null) {
    const x = (scene.zeroX / Math.max(scene.width - 1, 1)) * (width - 1);
    fillRect(data, width, height, x, 0, x + 1.1, height - 1, axis, 0.8);
  }
  if (scene.zeroY !== null) {
    const y = (scene.zeroY / Math.max(scene.height - 1, 1)) * (height - 1);
    fillRect(data, width, height, 0, y, width - 1, y + 1.1, axis, 0.8);
  }

  if (scene.regression) {
    const x0 = scene.xMin;
    const x1 = scene.xMax;
    const y0 = scene.regression.slope * x0 + scene.regression.intercept;
    const y1 = scene.regression.slope * x1 + scene.regression.intercept;
    if (Number.isFinite(y0) && Number.isFinite(y1)) {
      const lineColor = parseHex(scene.regression.color, 0.95);
      drawLine(
        data,
        width,
        height,
        valueToColumn(x0, scene.xMin, scene.xMax, width),
        valueToRow(y0, scene.yMin, scene.yMax, height),
        valueToColumn(x1, scene.xMin, scene.xMax, width),
        valueToRow(y1, scene.yMin, scene.yMax, height),
        lineColor,
        0.9,
      );
    }
  }

  for (const point of scene.points) {
    const x = valueToColumn(point.x, scene.xMin, scene.xMax, width);
    const y = valueToRow(point.y, scene.yMin, scene.yMax, height);
    const radius = point.highlight ? 3 : 2;
    fillRect(
      data,
      width,
      height,
      x - radius,
      y - radius,
      x + radius,
      y + radius,
      point.highlight ? highlightColor : pointColor,
      point.highlight ? 1 : 0.82,
    );
  }

  return { width, height, pixels: data };
}
