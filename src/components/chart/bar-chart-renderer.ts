import type { NativeChartBitmap } from "./native/chart-rasterizer";
import { fillRect, parseHex } from "./native/raster/primitives";
import { formatCompact } from "../../utils/format";

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
  negativeColor?: string;
  hoverColor?: string;
}

export interface BarChartSceneOptions {
  width: number;
  height: number;
  colors: BarChartColors;
}

export interface BarChartBar {
  seriesId: string;
  seriesLabel: string;
  category: string;
  value: number;
  color: string;
  categoryIndex: number;
  seriesIndex: number;
  seriesCount: number;
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

export interface BarChartHover {
  seriesId: string;
  seriesLabel: string;
  category: string;
  value: number;
  color: string;
  x: number;
  width: number;
  row: number;
}

export interface NativeBarChartPixelBounds {
  left: number;
  rightExclusive: number;
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
  return categories.filter((category) => series.some((item) => {
    const value = item.points.find((point) => point.category === category)?.value;
    return typeof value === "number" && Number.isFinite(value);
  }));
}

function normalizeRange(values: number[]): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: 1 };
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  if (dataMin === dataMax) {
    if (dataMin === 0) return { min: -1, max: 1 };
    const delta = Math.max(Math.abs(dataMin) * 0.1, 1);
    return dataMin > 0
      ? { min: 0, max: dataMax + delta }
      : { min: dataMin - delta, max: 0 };
  }
  const padding = (dataMax - dataMin) * 0.08;
  if (dataMin >= 0) return { min: 0, max: dataMax + padding };
  if (dataMax <= 0) return { min: dataMin - padding, max: 0 };
  return { min: dataMin - padding, max: dataMax + padding };
}

function valueToRow(value: number, min: number, max: number, height: number): number {
  const t = (value - min) / (max - min || 1);
  return clamp(Math.round((1 - t) * (height - 1)), 0, height - 1);
}

function rowToValue(row: number, scene: Pick<BarChartScene, "height" | "min" | "max">): number {
  if (scene.height <= 1) return scene.max;
  const t = 1 - row / Math.max(scene.height - 1, 1);
  return scene.min + t * (scene.max - scene.min);
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
  const seriesSlotCount = Math.max(series.length, 1);
  const bars: BarChartBar[] = [];

  categories.forEach((category, categoryIndex) => {
    series.forEach((item, seriesIndex) => {
      const value = item.points.find((point) => point.category === category)?.value;
      if (typeof value !== "number" || !Number.isFinite(value)) return;
      const color = value < 0 && options.colors.negativeColor
        ? options.colors.negativeColor
        : item.color;
      const barBounds = chartSlotBounds(width, categories.length * seriesSlotCount, categoryIndex * seriesSlotCount + seriesIndex);
      bars.push({
        seriesId: item.id,
        seriesLabel: item.label,
        category,
        value,
        color,
        categoryIndex,
        seriesIndex,
        seriesCount: seriesSlotCount,
        x: barBounds.x,
        width: barBounds.width,
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

function chartSlotBounds(
  width: number,
  slotCount: number,
  slotIndex: number,
): { x: number; width: number } {
  const slots = Math.max(1, slotCount);
  if (slots > width) {
    const x = clamp(Math.floor(slotIndex * width / slots), 0, width - 1);
    const right = clamp(Math.floor((slotIndex + 1) * width / slots), x + 1, width);
    return {
      x,
      width: Math.max(1, right - x),
    };
  }
  const gap = slots > 1 && width >= slots * 2 - 1 ? 1 : 0;
  const usableWidth = Math.max(slots, width - gap * (slots - 1));
  const slotWidth = Math.max(1, Math.floor(usableWidth / slots));
  const usedWidth = slotWidth * slots + gap * (slots - 1);
  const offset = Math.max(0, Math.floor((width - usedWidth) / 2));
  const x = clamp(offset + slotIndex * (slotWidth + gap), 0, width - 1);
  return {
    x,
    width: Math.max(1, Math.min(slotWidth, width - x)),
  };
}

function categoryCellBounds(
  width: number,
  categoryCount: number,
  seriesCount: number,
  categoryIndex: number,
): { left: number; width: number } {
  const first = chartSlotBounds(width, categoryCount * seriesCount, categoryIndex * seriesCount);
  const last = chartSlotBounds(width, categoryCount * seriesCount, categoryIndex * seriesCount + seriesCount - 1);
  const right = last.x + last.width;
  return {
    left: first.x,
    width: Math.max(1, right - first.x),
  };
}

function labelAtRow(labels: Array<{ row: number; value: number }>, row: number): number | null {
  const match = labels.find((label) => label.row === row);
  return match ? match.value : null;
}

export function barChartYAxisTicks(scene: BarChartScene): Array<{ row: number; value: number }> {
  const ticksByRow = new Map<number, number>();
  const addTick = (row: number, value: number) => {
    ticksByRow.set(clamp(row, 0, scene.height - 1), value);
  };

  addTick(0, scene.max);
  for (let i = 1; i <= 3; i++) {
    const row = Math.round((scene.height - 1) * (i / 4));
    addTick(row, rowToValue(row, scene));
  }
  addTick(scene.zeroRow, 0);
  addTick(scene.height - 1, scene.min);

  return [...ticksByRow.entries()]
    .map(([row, value]) => ({ row, value }))
    .sort((left, right) => left.row - right.row);
}

export function renderBarChartYAxis(
  scene: BarChartScene,
  width: number,
  formatValue: (value: number) => string = formatCompact,
): string[] {
  const axisWidth = Math.max(0, Math.floor(width));
  if (axisWidth === 0) return Array.from({ length: scene.height }, () => "");

  const ticks = barChartYAxisTicks(scene);
  return Array.from({ length: scene.height }, (_unused, row) => {
    const value = labelAtRow(ticks, row);
    const label = value === null ? "" : formatValue(value);
    return `${label.slice(0, Math.max(axisWidth - 1, 0)).padStart(Math.max(axisWidth - 1, 0))} `;
  });
}

export function resolveBarChartHover(scene: BarChartScene, cellX: number): BarChartHover | null {
  if (!Number.isFinite(cellX) || scene.bars.length === 0) return null;
  const x = clamp(Math.floor(cellX), 0, scene.width - 1);
  const direct = scene.bars.find((bar) => x >= bar.x && x < bar.x + bar.width);
  const bar = direct ?? scene.bars.reduce((closest, current) => {
    const closestCenter = closest.x + closest.width / 2;
    const currentCenter = current.x + current.width / 2;
    return Math.abs(currentCenter - x) < Math.abs(closestCenter - x) ? current : closest;
  }, scene.bars[0]!);

  return barToHover(bar);
}

function barToHover(bar: BarChartBar): BarChartHover {
  return {
    seriesId: bar.seriesId,
    seriesLabel: bar.seriesLabel,
    category: bar.category,
    value: bar.value,
    color: bar.color,
    x: bar.x,
    width: bar.width,
    row: bar.row,
  };
}

export function resolveNativeBarChartHover(
  scene: BarChartScene,
  pixelX: number,
  pixelWidth: number,
): BarChartHover | null {
  if (!Number.isFinite(pixelX) || scene.bars.length === 0) return null;
  const width = Math.max(1, Math.floor(pixelWidth));
  const x = clamp(Math.floor(pixelX), 0, width - 1);
  const direct = scene.bars.find((bar) => {
    const bounds = resolveNativeBarPixelBounds(scene, bar, width);
    return x >= bounds.left && x < bounds.rightExclusive;
  });
  const bar = direct ?? scene.bars.reduce((closest, current) => {
    const closestBounds = resolveNativeBarPixelBounds(scene, closest, width);
    const currentBounds = resolveNativeBarPixelBounds(scene, current, width);
    const closestCenter = (closestBounds.left + closestBounds.rightExclusive - 1) / 2;
    const currentCenter = (currentBounds.left + currentBounds.rightExclusive - 1) / 2;
    return Math.abs(currentCenter - x) < Math.abs(closestCenter - x) ? current : closest;
  }, scene.bars[0]!);

  return barToHover(bar);
}

export function renderBarChart(scene: BarChartScene, hover: BarChartHover | null = null): string[] {
  const rows = Array.from({ length: scene.height }, () => Array(scene.width).fill(" "));
  for (let x = 0; x < scene.width; x++) {
    rows[scene.zeroRow]![x] = "─";
  }

  for (const bar of scene.bars) {
    const fill = hover && hover.seriesId === bar.seriesId && hover.category === bar.category ? "▓" : "█";
    const top = Math.min(bar.row, scene.zeroRow);
    const bottom = Math.max(bar.row, scene.zeroRow);
    for (let y = top; y <= bottom; y++) {
      for (let x = bar.x; x < Math.min(bar.x + bar.width, scene.width); x++) {
        rows[y]![x] = fill;
      }
    }
  }

  return rows.map((row) => row.join(""));
}

function centeredLabelStart(center: number, label: string, width: number, rightInset = 0): number {
  return clamp(Math.round(center - label.length / 2), 0, Math.max(0, width - label.length - rightInset));
}

function compactCategoryLabel(category: string, previous: string | undefined, categoryCount: number): string {
  const quarterMatch = category.match(/^(\d{4}) Q([1-4])$/);
  if (!quarterMatch) return category;
  const year = quarterMatch[1]!;
  const previousYear = previous?.match(/^(\d{4}) Q[1-4]$/)?.[1];
  if (categoryCount > 10) return previousYear === year ? "" : year;
  return category;
}

function canPlaceLabel(row: string[], start: number, label: string, minGap: number): boolean {
  const left = Math.max(0, start - minGap);
  const right = Math.min(row.length - 1, start + label.length + minGap - 1);
  for (let index = left; index <= right; index++) {
    if (row[index] !== " ") return false;
  }
  return true;
}

export function renderBarChartAxis(scene: BarChartScene, rowCount = 1): string[] {
  const rows = Array.from({ length: Math.max(1, Math.floor(rowCount)) }, () => Array(scene.width).fill(" "));
  const minGap = scene.categories.length > 10 ? 3 : 1;
  const rightInset = scene.categories.length > 10 ? 2 : 0;
  scene.categories.forEach((category, index) => {
    const label = compactCategoryLabel(category, scene.categories[index - 1], scene.categories.length);
    if (!label) return;
    const group = categoryCellBounds(scene.width, scene.categories.length, Math.max(scene.series.length, 1), index);
    const start = centeredLabelStart(group.left + group.width / 2, label, scene.width, rightInset);
    const row = rows.find((candidate) => canPlaceLabel(candidate, start, label, minGap));
    if (!row) return;
    for (let i = 0; i < label.length && start + i < scene.width; i++) {
      row[start + i] = label[i]!;
    }
  });
  return rows.map((row) => row.join(""));
}

export function resolveNativeBarPixelBounds(
  scene: BarChartScene,
  bar: BarChartBar,
  pixelWidth: number,
): NativeBarChartPixelBounds {
  const width = Math.max(1, Math.floor(pixelWidth));
  const bounds = nativeSlotBounds(
    width,
    scene.categories.length * bar.seriesCount,
    bar.categoryIndex * bar.seriesCount + bar.seriesIndex,
  );
  const left = clamp(bounds.left, 0, width - 1);
  const rightExclusive = clamp(bounds.rightExclusive, left + 1, width);
  return { left, rightExclusive };
}

function nativeSlotBounds(
  width: number,
  slotCount: number,
  slotIndex: number,
): NativeBarChartPixelBounds {
  const slots = Math.max(1, slotCount);
  if (slots > width) {
    const left = clamp(Math.floor(slotIndex * width / slots), 0, width - 1);
    const rightExclusive = clamp(Math.floor((slotIndex + 1) * width / slots), left + 1, width);
    return { left, rightExclusive };
  }
  const gap = slots > 1 && width >= slots * 2 - 1 ? 1 : 0;
  const usableWidth = Math.max(slots, width - gap * (slots - 1));
  const slotWidth = Math.max(1, Math.floor(usableWidth / slots));
  const usedWidth = slotWidth * slots + gap * (slots - 1);
  const offset = Math.max(0, Math.floor((width - usedWidth) / 2));
  const left = offset + slotIndex * (slotWidth + gap);
  return {
    left,
    rightExclusive: Math.max(left + 1, left + slotWidth),
  };
}

export function renderNativeBarChart(
  scene: BarChartScene,
  pixelWidth: number,
  pixelHeight: number,
  hover: BarChartHover | null = null,
): NativeChartBitmap {
  const width = Math.max(1, Math.floor(pixelWidth));
  const height = Math.max(1, Math.floor(pixelHeight));
  const data = new Uint8Array(width * height * 4);
  const bg = parseHex(scene.colors.bgColor, 1);
  const grid = parseHex(scene.colors.gridColor, 0.45);
  const axis = parseHex(scene.colors.axisColor, 0.75);
  const hoverColor = parseHex(scene.colors.hoverColor ?? scene.colors.axisColor, 1);

  fillRect(data, width, height, 0, 0, width - 1, height - 1, bg, 1);

  for (let i = 1; i <= 3; i++) {
    const y = (height - 1) * (i / 4);
    fillRect(data, width, height, 0, y, width - 1, y + 0.7, grid, 0.45);
  }

  const zeroY = clamp((scene.zeroRow / Math.max(scene.height - 1, 1)) * (height - 1), 0, height - 1);
  fillRect(data, width, height, 0, zeroY, width - 1, zeroY + 1.1, axis, 0.8);

  for (const bar of scene.bars) {
    const isHovered = !!hover
      && hover.seriesId === bar.seriesId
      && hover.category === bar.category;
    const color = parseHex(bar.color, 0.96);
    const bounds = resolveNativeBarPixelBounds(scene, bar, width);
    const left = bounds.left;
    const right = bounds.rightExclusive - 1;
    const valueY = clamp((bar.row / Math.max(scene.height - 1, 1)) * (height - 1), 0, height - 1);
    const top = Math.min(valueY, zeroY);
    const bottom = Math.max(valueY, zeroY);
    fillRect(data, width, height, left, top, right, Math.max(top + 1, bottom), color, 1);
    if (isHovered) {
      fillRect(data, width, height, left, top, right, top + 1.3, hoverColor, 1);
      fillRect(data, width, height, left, bottom - 1.3, right, bottom, hoverColor, 1);
      fillRect(data, width, height, left, top, left + 1.3, bottom, hoverColor, 1);
      fillRect(data, width, height, right - 1.3, top, right, bottom, hoverColor, 1);
    }
  }

  return { width, height, pixels: data };
}
