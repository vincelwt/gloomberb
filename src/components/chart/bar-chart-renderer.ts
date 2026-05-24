import type { NativeChartBitmap } from "./native/chart-rasterizer";
import { fillRect, parseHex } from "./native/raster-primitives";

interface BarChartPoint {
  category: string;
  value: number | null;
}

export interface BarChartSeries {
  id: string;
  label: string;
  color: string;
  points: BarChartPoint[];
}

export interface BarChartColors {
  bgColor: string;
  gridColor: string;
  axisColor: string;
}

export interface BarChartSceneOptions {
  width: number;
  height: number;
  colors: BarChartColors;
}

interface BarChartBar {
  seriesId: string;
  category: string;
  value: number;
  color: string;
  x: number;
  width: number;
  row: number;
}

export interface BarChartScene {
  width: number;
  height: number;
  categories: string[];
  series: BarChartSeries[];
  bars: BarChartBar[];
  min: number;
  max: number;
  zeroRow: number;
  colors: BarChartColors;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function collectCategories(series: BarChartSeries[]): string[] {
  const categories: string[] = [];
  const seen = new Set<string>();
  for (const item of series) {
    for (const point of item.points) {
      if (seen.has(point.category)) continue;
      seen.add(point.category);
      categories.push(point.category);
    }
  }
  return categories;
}

function normalizeRange(values: number[]): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: 1 };
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
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

export function buildBarChartScene(series: BarChartSeries[], options: BarChartSceneOptions): BarChartScene | null {
  const width = Math.max(1, Math.floor(options.width));
  const height = Math.max(1, Math.floor(options.height));
  const categories = collectCategories(series);
  const values = series.flatMap((item) => item.points)
    .map((point) => point.value)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (categories.length === 0 || values.length === 0) return null;

  const { min, max } = normalizeRange(values);
  const zeroRow = valueToRow(0, min, max, height);
  const groupWidth = Math.max(1, Math.floor(width / categories.length));
  const seriesCount = Math.max(series.length, 1);
  const barWidth = Math.max(1, Math.floor(Math.max(groupWidth - 1, 1) / seriesCount));
  const bars: BarChartBar[] = [];

  categories.forEach((category, categoryIndex) => {
    const groupLeft = categoryIndex * groupWidth;
    series.forEach((item, seriesIndex) => {
      const value = item.points.find((point) => point.category === category)?.value;
      if (typeof value !== "number" || !Number.isFinite(value)) return;
      bars.push({
        seriesId: item.id,
        category,
        value,
        color: item.color,
        x: clamp(groupLeft + seriesIndex * barWidth, 0, width - 1),
        width: Math.min(barWidth, Math.max(width - groupLeft, 1)),
        row: valueToRow(value, min, max, height),
      });
    });
  });

  return {
    width,
    height,
    categories,
    series,
    bars,
    min,
    max,
    zeroRow,
    colors: options.colors,
  };
}

export function renderBarChart(scene: BarChartScene): string[] {
  const rows = Array.from({ length: scene.height }, () => Array(scene.width).fill(" "));
  for (let x = 0; x < scene.width; x++) {
    rows[scene.zeroRow]![x] = "─";
  }

  for (const bar of scene.bars) {
    const top = Math.min(bar.row, scene.zeroRow);
    const bottom = Math.max(bar.row, scene.zeroRow);
    for (let y = top; y <= bottom; y++) {
      for (let x = bar.x; x < Math.min(bar.x + bar.width, scene.width); x++) {
        rows[y]![x] = "█";
      }
    }
  }

  return rows.map((row) => row.join(""));
}

export function renderBarChartAxis(scene: BarChartScene): string {
  const axis = Array(scene.width).fill(" ");
  const groupWidth = Math.max(1, Math.floor(scene.width / scene.categories.length));
  scene.categories.forEach((category, index) => {
    const label = category.slice(0, Math.max(1, groupWidth - 1));
    const start = index * groupWidth;
    for (let i = 0; i < label.length && start + i < scene.width; i++) {
      axis[start + i] = label[i]!;
    }
  });
  return axis.join("");
}

export function renderNativeBarChart(scene: BarChartScene, pixelWidth: number, pixelHeight: number): NativeChartBitmap {
  const width = Math.max(1, Math.floor(pixelWidth));
  const height = Math.max(1, Math.floor(pixelHeight));
  const data = new Uint8Array(width * height * 4);
  const bg = parseHex(scene.colors.bgColor, 1);
  const grid = parseHex(scene.colors.gridColor, 0.45);
  const axis = parseHex(scene.colors.axisColor, 0.75);

  fillRect(data, width, height, 0, 0, width - 1, height - 1, bg, 1);

  for (let i = 1; i <= 3; i++) {
    const y = (height - 1) * (i / 4);
    fillRect(data, width, height, 0, y, width - 1, y + 0.7, grid, 0.45);
  }

  const zeroY = clamp((scene.zeroRow / Math.max(scene.height - 1, 1)) * (height - 1), 0, height - 1);
  fillRect(data, width, height, 0, zeroY, width - 1, zeroY + 1.1, axis, 0.8);

  for (const bar of scene.bars) {
    const color = parseHex(bar.color, 0.96);
    const left = (bar.x / scene.width) * width + 1;
    const right = ((bar.x + bar.width) / scene.width) * width - 1;
    const valueY = clamp((bar.row / Math.max(scene.height - 1, 1)) * (height - 1), 0, height - 1);
    const top = Math.min(valueY, zeroY);
    const bottom = Math.max(valueY, zeroY);
    fillRect(data, width, height, left, top, Math.max(left, right), Math.max(top + 1, bottom), color, 1);
  }

  return { width, height, pixels: data };
}
