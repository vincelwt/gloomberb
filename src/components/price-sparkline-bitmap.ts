import type { BitmapSurface } from "../ui";
import { blendPixel, parseHex, type RgbaColor } from "./chart/native/raster-primitives";
import { buildSamples, type SparklineSample } from "./price-sparkline-model";

interface SparklineBitmapOptions {
  area?: boolean;
  compact?: boolean;
}

function drawSegment(
  pixels: Uint8Array,
  width: number,
  height: number,
  start: SparklineSample,
  end: SparklineSample,
  color: RgbaColor,
  thickness: number,
) {
  const half = thickness / 2;
  const minX = Math.floor(Math.min(start.x, end.x) - half - 1);
  const maxX = Math.ceil(Math.max(start.x, end.x) + half + 1);
  const minY = Math.floor(Math.min(start.y, end.y) - half - 1);
  const maxY = Math.ceil(Math.max(start.y, end.y) + half + 1);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy || 1;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const t = Math.max(0, Math.min(1, ((px - start.x) * dx + (py - start.y) * dy) / lengthSq));
      const nearestX = start.x + dx * t;
      const nearestY = start.y + dy * t;
      const distance = Math.hypot(px - nearestX, py - nearestY);
      const coverage = Math.max(0, Math.min(1, half + 0.9 - distance));
      blendPixel(pixels, width, height, x, y, color, coverage);
    }
  }
}

function snapSampleToPixelCenter(value: number, limit: number): number {
  return Math.max(0.5, Math.min(limit - 0.5, Math.round(value) + 0.5));
}

function snapSamplesToPixelCenters(samples: SparklineSample[], width: number, height: number): SparklineSample[] {
  if (width <= 1 || height <= 1) return samples;
  return samples.map((sample) => ({
    x: snapSampleToPixelCenter(sample.x, width),
    y: snapSampleToPixelCenter(sample.y, height),
  }));
}

function drawAreaFill(
  pixels: Uint8Array,
  width: number,
  height: number,
  samples: SparklineSample[],
  baseline: number,
  color: RgbaColor,
) {
  if (samples.length < 2) return;

  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const startX = Math.max(0, Math.floor(first.x));
  const endX = Math.min(width - 1, Math.ceil(last.x));
  let segmentIndex = 0;

  for (let x = startX; x <= endX; x++) {
    const centerX = x + 0.5;
    while (segmentIndex < samples.length - 2 && samples[segmentIndex + 1]!.x < centerX) {
      segmentIndex++;
    }

    const start = samples[segmentIndex]!;
    const end = samples[segmentIndex + 1]!;
    const dx = end.x - start.x;
    const t = dx === 0 ? 0 : Math.max(0, Math.min(1, (centerX - start.x) / dx));
    const lineY = start.y + (end.y - start.y) * t;
    const top = Math.max(0, Math.ceil(Math.min(lineY, baseline)));
    const bottom = Math.min(height - 1, Math.floor(Math.max(lineY, baseline)));
    const distance = Math.max(1, bottom - top);

    for (let y = top; y <= bottom; y++) {
      const fade = 1 - ((y - top) / distance) * 0.55;
      blendPixel(pixels, width, height, x, y, color, fade);
    }
  }
}

export function renderSparklineBitmap(
  values: number[],
  width: number,
  height: number,
  color: string,
  options: SparklineBitmapOptions = {},
): BitmapSurface | null {
  if (values.length < 2 || width <= 0 || height <= 0) return null;
  const pixels = new Uint8Array(width * height * 4);
  const compact = options.compact && !options.area;
  const padding = options.area
    ? Math.max(1, Math.round(height * 0.06))
    : compact
      ? Math.max(1, Math.round(height * 0.12))
      : Math.max(1, Math.round(height * 0.18));
  const rawSamples = buildSamples(values, width - 1, height - 1, padding);
  const samples = compact ? snapSamplesToPixelCenters(rawSamples, width - 1, height - 1) : rawSamples;
  const fillColor = parseHex(color, 0.18);
  const glowColor = parseHex(color, options.area ? 0.06 : compact ? 0.04 : 0.18);
  const lineColor = parseHex(color, 0.96);
  const glowThickness = options.area
    ? Math.max(1.2, height * 0.08)
    : compact
      ? Math.max(1.2, height * 0.09)
      : Math.max(2, height * 0.24);
  const lineThickness = options.area
    ? Math.max(1.1, height * 0.055)
    : compact
      ? Math.max(1.8, height * 0.13)
      : Math.max(1.25, height * 0.1);

  if (options.area) {
    drawAreaFill(pixels, width, height, samples, height - 1, fillColor);
  }
  for (let index = 0; index < samples.length - 1; index++) {
    drawSegment(
      pixels,
      width,
      height,
      samples[index]!,
      samples[index + 1]!,
      glowColor,
      glowThickness,
    );
  }
  for (let index = 0; index < samples.length - 1; index++) {
    drawSegment(
      pixels,
      width,
      height,
      samples[index]!,
      samples[index + 1]!,
      lineColor,
      lineThickness,
    );
  }

  return { width, height, pixels };
}
