import { useMemo } from "react";
import {
  Box,
  ChartSurface,
  Text,
  useNativeRenderer,
  useUiCapabilities,
  useUiHost,
  type BitmapSurface,
} from "../ui";
import { colors } from "../theme/colors";
import { useThemeColors } from "../theme/theme-context";
import type { PricePoint } from "../types/financials";
import { computeBitmapSize } from "./chart/native/chart-rasterizer";
import { renderPriceSparkline } from "./price-sparkline";

export const PRICE_SPARKLINE_COLUMN_ID = "sparkline";
export const PRICE_SPARKLINE_PERIOD_LABEL = "1M";

const SPARKLINE_HEIGHT = 1;
const SPARKLINE_FALLBACK_POINTS = 22;
export type PriceSparklineTrend = "positive" | "negative" | "neutral";
export type PriceSparklinePeriod = "1D" | "1W" | "1M" | "1Y";

const PERIOD_WINDOW_DAYS: Record<PriceSparklinePeriod, number> = {
  "1D": 1,
  "1W": 7,
  "1M": 30,
  "1Y": 365,
};

const PERIOD_FALLBACK_POINTS: Record<PriceSparklinePeriod, number> = {
  "1D": 2,
  "1W": 7,
  "1M": SPARKLINE_FALLBACK_POINTS,
  "1Y": 252,
};

interface SparklineSample {
  x: number;
  y: number;
}

interface SparklineBitmapOptions {
  area?: boolean;
  compact?: boolean;
}

function closeValue(point: PricePoint): number | null {
  return Number.isFinite(point.close) ? point.close : null;
}

function getPointTime(point: PricePoint): number {
  const value = point.date as Date | string | number | null | undefined;
  if (value instanceof Date) return value.getTime();
  if (value == null) return Number.NaN;
  return new Date(value).getTime();
}

function resolveSparklineHistory(priceHistory: PricePoint[], period: PriceSparklinePeriod = "1M"): PricePoint[] {
  const validHistory = priceHistory.filter((point) => Number.isFinite(getPointTime(point)));
  const latest = validHistory.at(-1);
  if (!latest) return [];

  const latestTime = getPointTime(latest);
  if (Number.isFinite(latestTime)) {
    const cutoffTime = latestTime - PERIOD_WINDOW_DAYS[period] * 86_400_000;
    const windowHistory = validHistory.filter((point) => getPointTime(point) >= cutoffTime);
    if (windowHistory.length >= 2) return windowHistory;
  }

  return validHistory.slice(-PERIOD_FALLBACK_POINTS[period]);
}

function sparklineValues(priceHistory: PricePoint[]): number[] {
  return priceHistory
    .map(closeValue)
    .filter((value): value is number => value != null);
}

function sparklineColor(values: number[], trend?: PriceSparklineTrend): string {
  if (trend === "positive") return colors.positive;
  if (trend === "negative") return colors.negative;
  if (trend === "neutral") return colors.textMuted;

  const first = values[0];
  const last = values.at(-1);
  if (first == null || last == null) return colors.textMuted;
  return last >= first ? colors.positive : colors.negative;
}

function buildSamples(values: number[], width: number, height: number, padding: number): SparklineSample[] {
  if (values.length < 2) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const left = padding;
  const right = Math.max(left, width - padding);
  const top = padding;
  const bottom = Math.max(top, height - padding);
  return values.map((value, index) => ({
    x: left + (index / Math.max(values.length - 1, 1)) * (right - left),
    y: bottom - ((value - min) / range) * (bottom - top),
  }));
}

function svgPath(samples: SparklineSample[]): string {
  return samples
    .map((sample, index) => `${index === 0 ? "M" : "L"}${sample.x.toFixed(2)} ${sample.y.toFixed(2)}`)
    .join(" ");
}

function svgAreaPath(samples: SparklineSample[], baseline: number): string {
  const linePath = svgPath(samples);
  if (!linePath || samples.length === 0) return "";
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  return `${linePath} L${last.x.toFixed(2)} ${baseline.toFixed(2)} L${first.x.toFixed(2)} ${baseline.toFixed(2)} Z`;
}

function parseHex(hex: string, alpha = 1) {
  const normalized = hex.replace("#", "");
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
    a: Math.round(Math.max(0, Math.min(1, alpha)) * 255),
  };
}

function colorWithAlpha(color: string, alpha: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return color;
  const parsed = parseHex(color, alpha);
  return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${Math.max(0, Math.min(1, alpha))})`;
}

function blendPixel(
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  color: ReturnType<typeof parseHex>,
  opacity: number,
) {
  if (x < 0 || y < 0 || x >= width || y >= height || opacity <= 0) return;
  const alpha = Math.max(0, Math.min(1, (color.a / 255) * opacity));
  const offset = (y * width + x) * 4;
  const dstAlpha = pixels[offset + 3]! / 255;
  const outAlpha = alpha + dstAlpha * (1 - alpha);
  if (outAlpha <= 0) return;

  const dstFactor = dstAlpha * (1 - alpha);
  pixels[offset] = Math.round((color.r * alpha + pixels[offset]! * dstFactor) / outAlpha);
  pixels[offset + 1] = Math.round((color.g * alpha + pixels[offset + 1]! * dstFactor) / outAlpha);
  pixels[offset + 2] = Math.round((color.b * alpha + pixels[offset + 2]! * dstFactor) / outAlpha);
  pixels[offset + 3] = Math.round(outAlpha * 255);
}

function drawSegment(
  pixels: Uint8Array,
  width: number,
  height: number,
  start: SparklineSample,
  end: SparklineSample,
  color: ReturnType<typeof parseHex>,
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
  color: ReturnType<typeof parseHex>,
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

function renderSparklineBitmap(
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

function DesktopPriceSparkline({
  values,
  width,
  height,
  color,
}: {
  values: number[];
  width: number;
  height: number;
  color: string;
}) {
  const svgWidth = Math.max(24, width * 8);
  const svgHeight = Math.max(18, height * 18);
  const path = svgPath(buildSamples(values, svgWidth, svgHeight, 2));
  if (!path) return <Text fg={colors.textMuted}>{" "}</Text>;

  return (
    <Box width={width} height={height} justifyContent="center" overflow="hidden">
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        width="100%"
        height="100%"
        aria-hidden="true"
        focusable="false"
        style={{ display: "block" }}
      >
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </Box>
  );
}

function TerminalPriceSparkline({
  priceHistory,
  values,
  width,
  height,
  color,
  area = false,
}: {
  priceHistory: PricePoint[];
  values: number[];
  width: number;
  height: number;
  color: string;
  area?: boolean;
}) {
  const { nativeCharts, cellWidthPx = 8, cellHeightPx = 18, pixelRatio = 1 } = useUiCapabilities();
  const nativeRenderer = useNativeRenderer();
  const rendererResolution = nativeRenderer.resolution;
  const rendererTerminalWidth = nativeRenderer.terminalWidth;
  const rendererTerminalHeight = nativeRenderer.terminalHeight;
  const bitmap = useMemo(() => {
    if (!nativeCharts || values.length < 2) return null;
    const scale = Math.max(1, pixelRatio);
    const bitmapSize = rendererResolution && rendererTerminalWidth > 0 && rendererTerminalHeight > 0
      ? computeBitmapSize(
        { x: 0, y: 0, width, height },
        rendererResolution,
        rendererTerminalWidth,
        rendererTerminalHeight,
      )
      : {
          pixelWidth: Math.max(1, Math.round(width * cellWidthPx * scale)),
          pixelHeight: Math.max(1, Math.round(height * cellHeightPx * scale)),
        };
    return renderSparklineBitmap(values, bitmapSize.pixelWidth, bitmapSize.pixelHeight, color, { area, compact: height <= 1 });
  }, [
    area,
    cellHeightPx,
    cellWidthPx,
    color,
    height,
    nativeCharts,
    pixelRatio,
    rendererResolution,
    rendererTerminalHeight,
    rendererTerminalWidth,
    values,
    width,
  ]);
  const fallback = useMemo(
    () => renderPriceSparkline(priceHistory, { width, height, maxPoints: priceHistory.length }),
    [height, priceHistory, width],
  );

  return (
    <ChartSurface width={width} height={height} flexDirection="column" bitmaps={bitmap ? [bitmap] : null}>
      {fallback ? <Text content={fallback} /> : null}
    </ChartSurface>
  );
}

export function PriceSparkline({
  priceHistory,
  width,
  trend,
  period = "1M",
  height = SPARKLINE_HEIGHT,
  area = false,
}: {
  priceHistory: PricePoint[] | undefined;
  width: number;
  trend?: PriceSparklineTrend;
  period?: PriceSparklinePeriod;
  height?: number;
  area?: boolean;
}) {
  useThemeColors();
  const sparklineHistory = useMemo(() => resolveSparklineHistory(priceHistory ?? [], period), [period, priceHistory]);
  const values = useMemo(() => sparklineValues(sparklineHistory), [sparklineHistory]);
  if (values.length < 2) {
    return <Text fg={colors.textMuted}>{" "}</Text>;
  }

  const color = sparklineColor(values, trend);
  return useUiHost().kind === "desktop-web"
    ? <DesktopPriceSparkline values={values} width={width} height={height} color={color} />
    : <TerminalPriceSparkline priceHistory={sparklineHistory} values={values} width={width} height={height} color={color} area={area} />;
}

export function PriceAreaSparklineBackground({
  priceHistory,
  trend,
  period = "1M",
}: {
  priceHistory: PricePoint[] | undefined;
  trend?: PriceSparklineTrend;
  period?: PriceSparklinePeriod;
}) {
  useThemeColors();
  const uiHost = useUiHost();
  const sparklineHistory = useMemo(() => resolveSparklineHistory(priceHistory ?? [], period), [period, priceHistory]);
  const values = useMemo(() => sparklineValues(sparklineHistory), [sparklineHistory]);
  if (uiHost.kind !== "desktop-web" || values.length < 2) return null;

  const color = sparklineColor(values, trend);
  const baseline = 100;
  const samples = buildSamples(values, 100, baseline, 0);
  const linePath = svgPath(samples);
  const areaPath = svgAreaPath(samples, baseline);
  if (!linePath || !areaPath) return null;

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        display: "block",
        pointerEvents: "none",
      }}
    >
      <path d={areaPath} fill={colorWithAlpha(color, 0.08)} />
      <path
        d={linePath}
        fill="none"
        stroke={colorWithAlpha(color, 0.46)}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function resolvePriceSparklineRange(
  priceHistory: PricePoint[] | undefined,
  period: PriceSparklinePeriod = "1M",
): { min: number; max: number } | null {
  const values = sparklineValues(resolveSparklineHistory(priceHistory ?? [], period));
  if (values.length < 2) return null;
  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
}
