import { buildTimeAxis } from "./chart-renderer";
import type { NativeChartBitmap } from "./native/chart-rasterizer";
import { clamp, valueToPixelY, type MultiLineChartScene, type MultiLineProjectedPoint } from "./multi-line-chart-scene";

export {
  buildMultiLineChartScene,
  resolveMultiLineCursorDate,
} from "./multi-line-chart-scene";
export type {
  MultiLineChartColors,
  MultiLineChartScene,
  MultiLineChartSeries,
} from "./multi-line-chart-scene";

const TEXT_SERIES_MARKS = ["●", "◆", "■", "▲", "✦", "•"];

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
