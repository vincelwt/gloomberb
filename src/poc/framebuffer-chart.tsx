import { ptr } from "bun:ffi";
import {
  createCliRenderer,
  RGBA,
  type BoxRenderable,
  type CliRenderer,
  type MouseEvent,
  type OptimizedBuffer,
} from "@opentui/core";
import { createRoot, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { projectCloseSeries } from "../components/chart/chart-data";
import { resolveChartPalette } from "../components/chart/chart-renderer";
import { colors } from "../theme/colors";
import type { PricePoint } from "../types/financials";
import { formatCurrency } from "../utils/format";

interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface DragState {
  startGlobalX: number;
  startPanOffset: number;
}

interface TerminalSnapshot {
  kittyGraphics: boolean | null;
  resolutionLabel: string;
  terminalLabel: string;
}

const SERIES_POINT_COUNT = 240;
const MIN_VISIBLE_POINTS = 24;
const MIN_PLOT_CELLS = 12;
const DEFAULT_ZOOM = 1.4;
const MIN_ZOOM = 1;
const MAX_ZOOM = 7;
const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const demoSeries = createDemoSeries(SERIES_POINT_COUNT);
const seriesTrend = demoSeries[demoSeries.length - 1]!.close - demoSeries[0]!.close;
const chartPalette = resolveChartPalette({
  bg: colors.bg,
  border: colors.border,
  borderFocused: colors.borderFocused,
  text: colors.text,
  textDim: colors.textDim,
  positive: colors.positive,
  negative: colors.negative,
}, seriesTrend < 0 ? "negative" : seriesTrend > 0 ? "positive" : "neutral");

const backgroundColor = toRgbaColor(colors.panel);
const gridColor = withOpacity(toRgbaColor(chartPalette.gridColor), 0.24);
const axisGlowColor = withOpacity(toRgbaColor(colors.borderFocused), 0.42);
const areaFillColor = withOpacity(toRgbaColor(chartPalette.fillColor), 0.32);
const lineGlowColor = withOpacity(toRgbaColor(chartPalette.lineColor), 0.14);
const lineColor = withOpacity(toRgbaColor(chartPalette.lineColor), 0.9);
const markerColor = toRgbaColor(colors.textBright);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const range = edge1 - edge0;
  if (range === 0) return value < edge0 ? 0 : 1;
  const t = clamp((value - edge0) / range, 0, 1);
  return t * t * (3 - 2 * t);
}

function toRgbaColor(hex: string, alpha = 1): RgbaColor {
  const normalized = hex.replace("#", "");
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
    a: Math.round(clamp(alpha, 0, 1) * 255),
  };
}

function withOpacity(color: RgbaColor, opacity: number): RgbaColor {
  return { ...color, a: Math.round(clamp(opacity, 0, 1) * 255) };
}

function fillPixels(data: Uint8Array, color: RgbaColor) {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color.r;
    data[i + 1] = color.g;
    data[i + 2] = color.b;
    data[i + 3] = color.a;
  }
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

  if (outAlpha <= 0) {
    data[index] = 0;
    data[index + 1] = 0;
    data[index + 2] = 0;
    data[index + 3] = 0;
    return;
  }

  const dstFactor = dstAlpha * (1 - alpha);
  data[index] = Math.round((color.r * alpha + data[index]! * dstFactor) / outAlpha);
  data[index + 1] = Math.round((color.g * alpha + data[index + 1]! * dstFactor) / outAlpha);
  data[index + 2] = Math.round((color.b * alpha + data[index + 2]! * dstFactor) / outAlpha);
  data[index + 3] = Math.round(outAlpha * 255);
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
      const coverage = 1 - smoothstep(radius - 0.6, radius + 0.6, distance);
      if (coverage > 0) {
        blendPixel(data, width, height, px, py, color, coverage);
      }
    }
  }
}

function drawFill(
  data: Uint8Array,
  width: number,
  height: number,
  yByColumn: Float32Array,
  plotTop: number,
  plotBottom: number,
  color: RgbaColor,
) {
  const startX = 0;
  const endX = Math.min(width - 1, yByColumn.length - 1);

  for (let x = startX; x <= endX; x++) {
    const yTop = yByColumn[x]!;
    if (!Number.isFinite(yTop)) continue;

    for (let y = Math.max(Math.floor(yTop), plotTop); y <= plotBottom; y++) {
      const distance = plotBottom - yTop || 1;
      const fade = 1 - (y - yTop) / distance;
      const opacity = 0.04 + fade * 0.16;
      blendPixel(data, width, height, x, y, color, opacity);
    }
  }
}

function drawGrid(
  data: Uint8Array,
  width: number,
  height: number,
  plotLeft: number,
  plotTop: number,
  plotRight: number,
  plotBottom: number,
) {
  const horizontalSteps = 4;
  const verticalSteps = 5;

  for (let i = 0; i <= horizontalSteps; i++) {
    const y = Math.round(lerp(plotTop, plotBottom, i / horizontalSteps));
    drawLine(data, width, height, plotLeft, y, plotRight, y, gridColor, 1);
  }

  for (let i = 0; i <= verticalSteps; i++) {
    const x = Math.round(lerp(plotLeft, plotRight, i / verticalSteps));
    drawLine(data, width, height, x, plotTop, x, plotBottom, gridColor, 1);
  }
}

function formatDate(date: Date): string {
  return DATE_FORMATTER.format(date);
}

function calculateVisibleCount(plotWidthCells: number, zoom: number, total: number): number {
  const baseCount = Math.min(total, Math.max(plotWidthCells * 2, MIN_VISIBLE_POINTS));
  return clamp(Math.round(baseCount / zoom), MIN_VISIBLE_POINTS, total);
}

function resolveLocalPlotX(event: MouseEvent, renderable: BoxRenderable | null): number | null {
  if (!renderable) return null;

  const localX = event.x - renderable.x - 1;
  const plotWidth = Math.max(renderable.width - 2, 0);
  if (plotWidth <= 0 || localX < 0 || localX >= plotWidth) {
    return null;
  }

  return localX;
}

function getActiveIndex(hoverCellX: number | null, plotWidthCells: number, pointCount: number): number {
  if (pointCount <= 1) return 0;
  if (hoverCellX === null || plotWidthCells <= 1) return pointCount - 1;
  const ratio = clamp(hoverCellX / (plotWidthCells - 1), 0, 1);
  return clamp(Math.round(ratio * (pointCount - 1)), 0, pointCount - 1);
}

function readTerminalSnapshot(renderer: CliRenderer): TerminalSnapshot {
  const caps = renderer.capabilities as {
    kitty_graphics?: boolean;
    terminal?: { name?: string; version?: string };
  } | null;
  const resolution = renderer.resolution;
  const terminalName = caps?.terminal?.name || "unknown";
  const terminalVersion = caps?.terminal?.version ? ` ${caps.terminal.version}` : "";

  return {
    kittyGraphics: caps?.kitty_graphics ?? null,
    resolutionLabel: resolution ? `${resolution.width}x${resolution.height}px` : "probing",
    terminalLabel: `${terminalName}${terminalVersion}`.trim(),
  };
}

function createDemoSeries(count: number): PricePoint[] {
  const series: PricePoint[] = [];
  let seed = 0x6d2b79f5;
  let close = 102;

  const random = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let index = 0; index < count; index++) {
    const drift = Math.sin(index / 15) * 0.45 + Math.cos(index / 27) * 0.35;
    const shock = (random() - 0.5) * 2.8;
    const nextClose = Math.max(18, close + drift + shock + (index > count * 0.6 ? 0.16 : 0.05));
    const open = close + (random() - 0.5) * 1.5;
    const high = Math.max(open, nextClose) + random() * 1.8;
    const low = Math.min(open, nextClose) - random() * 1.8;
    const date = new Date(Date.UTC(2025, 0, 2 + index));

    series.push({
      date,
      open,
      high,
      low,
      close: nextClose,
      volume: Math.round(700_000 + random() * 1_900_000),
    });

    close = nextClose;
  }

  return series;
}

function renderChartToPixels(
  pixels: Uint8Array,
  pixelWidth: number,
  pixelHeight: number,
  points: PricePoint[],
  activeIndex: number,
) {
  fillPixels(pixels, backgroundColor);

  if (points.length === 0) return;

  const insetX = 2;
  const insetTop = 2;
  const insetBottom = 3;
  const plotLeft = insetX;
  const plotRight = Math.max(plotLeft, pixelWidth - insetX - 1);
  const plotTop = insetTop;
  const plotBottom = Math.max(plotTop, pixelHeight - insetBottom - 1);

  drawGrid(pixels, pixelWidth, pixelHeight, plotLeft, plotTop, plotRight, plotBottom);

  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minValue = Math.min(minValue, point.close);
    maxValue = Math.max(maxValue, point.close);
  }

  const valueSpan = maxValue - minValue || 1;
  const paddedMin = minValue - valueSpan * 0.12;
  const paddedMax = maxValue + valueSpan * 0.12;
  const paddedSpan = paddedMax - paddedMin || 1;

  const xByIndex = points.map((_, index) =>
    points.length === 1
      ? (plotLeft + plotRight) / 2
      : lerp(plotLeft, plotRight, index / (points.length - 1)));
  const yByIndex = points.map((point) =>
    lerp(plotBottom, plotTop, (point.close - paddedMin) / paddedSpan));

  const yByColumn = new Float32Array(pixelWidth).fill(Number.POSITIVE_INFINITY);
  for (let index = 0; index < points.length - 1; index++) {
    const x0 = xByIndex[index]!;
    const y0 = yByIndex[index]!;
    const x1 = xByIndex[index + 1]!;
    const y1 = yByIndex[index + 1]!;
    const startX = Math.max(plotLeft, Math.floor(Math.min(x0, x1)));
    const endX = Math.min(plotRight, Math.ceil(Math.max(x0, x1)));

    for (let x = startX; x <= endX; x++) {
      const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
      const y = lerp(y0, y1, clamp(t, 0, 1));
      yByColumn[x] = Math.min(yByColumn[x]!, y);
    }
  }

  drawFill(pixels, pixelWidth, pixelHeight, yByColumn, plotTop, plotBottom, areaFillColor);

  for (let index = 0; index < points.length - 1; index++) {
    const x0 = xByIndex[index]!;
    const y0 = yByIndex[index]!;
    const x1 = xByIndex[index + 1]!;
    const y1 = yByIndex[index + 1]!;
    drawLine(pixels, pixelWidth, pixelHeight, x0, y0, x1, y1, lineGlowColor, 3.6);
    drawLine(pixels, pixelWidth, pixelHeight, x0, y0, x1, y1, lineColor, 1.6);
  }

  const activeX = xByIndex[activeIndex]!;
  const activeY = yByIndex[activeIndex]!;
  drawLine(pixels, pixelWidth, pixelHeight, activeX, plotTop, activeX, plotBottom, axisGlowColor, 1.4);
  drawLine(pixels, pixelWidth, pixelHeight, plotLeft, activeY, plotRight, activeY, axisGlowColor, 1.4);
  drawCircle(pixels, pixelWidth, pixelHeight, activeX, activeY, 3.8, lineGlowColor);
  drawCircle(pixels, pixelWidth, pixelHeight, activeX, activeY, 2.1, lineColor);
  drawCircle(pixels, pixelWidth, pixelHeight, activeX, activeY, 1.35, markerColor);
}

function FramebufferChartDemo() {
  const renderer = useRenderer();
  const { width, height } = useTerminalDimensions();
  const chartRef = useRef<BoxRenderable | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [panOffset, setPanOffset] = useState(0);
  const [hoverCellX, setHoverCellX] = useState<number | null>(null);
  const [terminalSnapshot, setTerminalSnapshot] = useState(() => readTerminalSnapshot(renderer));
  const [chartSize, setChartSize] = useState({
    width: Math.max(width - 4, MIN_PLOT_CELLS + 2),
    height: Math.max(height - 9, 10),
  });

  useEffect(() => {
    const refresh = () => setTerminalSnapshot(readTerminalSnapshot(renderer));
    refresh();

    const timer = setInterval(refresh, 250);
    const onCapabilities = () => refresh();
    renderer.on("capabilities", onCapabilities);

    return () => {
      clearInterval(timer);
      renderer.off("capabilities", onCapabilities);
    };
  }, [renderer]);

  const plotWidthCells = Math.max(chartSize.width - 2, MIN_PLOT_CELLS);
  const visibleCount = calculateVisibleCount(plotWidthCells, zoom, demoSeries.length);
  const maxPanOffset = Math.max(demoSeries.length - visibleCount, 0);

  useEffect(() => {
    if (panOffset > maxPanOffset) {
      setPanOffset(maxPanOffset);
    }
  }, [maxPanOffset, panOffset]);

  const visibleSeries = useMemo(() => {
    const endIndex = demoSeries.length - panOffset;
    const startIndex = Math.max(endIndex - visibleCount, 0);
    return demoSeries.slice(startIndex, endIndex);
  }, [panOffset, visibleCount]);

  const projectedSeries = useMemo(() => {
    return projectCloseSeries(visibleSeries, Math.max(plotWidthCells * 2, MIN_VISIBLE_POINTS));
  }, [plotWidthCells, visibleSeries]);

  const activeIndex = getActiveIndex(hoverCellX, plotWidthCells, projectedSeries.length);
  const activePoint = projectedSeries[activeIndex] ?? projectedSeries[projectedSeries.length - 1] ?? null;
  const windowStart = projectedSeries[0] ?? null;
  const windowEnd = projectedSeries[projectedSeries.length - 1] ?? null;
  const windowChange = windowStart && activePoint ? activePoint.close - windowStart.close : 0;
  const windowChangePct = windowStart && windowStart.close !== 0
    ? (windowChange / windowStart.close) * 100
    : 0;

  const syncChartSize = () => {
    if (!chartRef.current) return;
    setChartSize({ width: chartRef.current.width, height: chartRef.current.height });
  };

  const applyZoom = (nextZoom: number, anchorRatio: number) => {
    const clampedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    const nextVisibleCount = calculateVisibleCount(plotWidthCells, clampedZoom, demoSeries.length);
    const ratio = clamp(anchorRatio, 0, 1);
    const anchorGlobalIndex = demoSeries.length - panOffset - visibleCount + ratio * Math.max(visibleCount - 1, 0);
    const nextStart = Math.round(anchorGlobalIndex - ratio * Math.max(nextVisibleCount - 1, 0));
    const clampedStart = clamp(nextStart, 0, Math.max(demoSeries.length - nextVisibleCount, 0));
    const nextPanOffset = demoSeries.length - nextVisibleCount - clampedStart;

    setZoom(clampedZoom);
    setPanOffset(nextPanOffset);
  };

  const updateHover = (event: MouseEvent): number | null => {
    const localX = resolveLocalPlotX(event, chartRef.current);
    setHoverCellX(localX);
    return localX;
  };

  useKeyboard((event) => {
    if (event.name === "q" || event.name === "escape") {
      renderer.destroy();
    }
  });

  return (
    <box flexDirection="column" width="100%" height="100%" padding={1} backgroundColor={colors.bg}>
      <box height={1} flexDirection="row">
        <text fg={colors.textBright}>
          OpenTUI framebuffer chart POC
        </text>
        <text fg={colors.textDim}>
          {"  drawSuperSampleBuffer + alpha + mouse scrub"}
        </text>
      </box>

      <box height={1} flexDirection="row">
        <text fg={windowChange >= 0 ? colors.positive : colors.negative}>
          {activePoint ? formatCurrency(activePoint.close) : "--"}
        </text>
        <text fg={windowChange >= 0 ? colors.positive : colors.negative}>
          {"  "}
          {windowChange >= 0 ? "+" : ""}{windowChange.toFixed(2)} ({windowChangePct >= 0 ? "+" : ""}{windowChangePct.toFixed(2)}%)
        </text>
        <text fg={colors.textDim}>
          {"  "}
          {activePoint ? formatDate(activePoint.date) : "No point selected"}
        </text>
      </box>

      <box height={1}>
        <text fg={colors.textMuted}>
          terminal:{terminalSnapshot.terminalLabel}
          {"  "}kitty_graphics:{terminalSnapshot.kittyGraphics === null ? "probing" : terminalSnapshot.kittyGraphics ? "yes" : "no"}
          {"  "}resolution:{terminalSnapshot.resolutionLabel}
          {"  "}visible:{visibleSeries.length}
          {"  "}projected:{projectedSeries.length}
          {"  "}zoom:{zoom.toFixed(2)}x
        </text>
      </box>

      <box height={1} />

      <box flexGrow={1}>
        <box
          ref={chartRef}
          flexGrow={1}
          border
          borderStyle="rounded"
          borderColor={colors.borderFocused}
          backgroundColor={colors.panel}
          buffered
          onSizeChange={syncChartSize}
          onMouseMove={(event) => {
            updateHover(event);
          }}
          onMouseOut={() => {
            dragRef.current = null;
            setHoverCellX(null);
          }}
          onMouseDown={(event) => {
            const localX = updateHover(event);
            if (localX === null) return;
            dragRef.current = {
              startGlobalX: event.x,
              startPanOffset: panOffset,
            };
          }}
          onMouseDrag={(event) => {
            updateHover(event);
            if (!dragRef.current) return;

            const deltaCells = event.x - dragRef.current.startGlobalX;
            const pointDelta = Math.round((deltaCells / Math.max(plotWidthCells, 1)) * visibleCount);
            setPanOffset(clamp(dragRef.current.startPanOffset - pointDelta, 0, maxPanOffset));
          }}
          onMouseDragEnd={() => {
            dragRef.current = null;
          }}
          onMouseScroll={(event) => {
            const localX = resolveLocalPlotX(event, chartRef.current);
            const anchorRatio = localX === null ? 0.5 : localX / Math.max(plotWidthCells - 1, 1);
            if (event.scroll?.direction === "up") {
              applyZoom(zoom * 1.18, anchorRatio);
            } else if (event.scroll?.direction === "down") {
              applyZoom(zoom / 1.18, anchorRatio);
            } else if (event.scroll?.direction === "left") {
              setPanOffset((current) => clamp(current + Math.max(Math.round(visibleCount * 0.08), 1), 0, maxPanOffset));
            } else if (event.scroll?.direction === "right") {
              setPanOffset((current) => clamp(current - Math.max(Math.round(visibleCount * 0.08), 1), 0, maxPanOffset));
            }
          }}
          renderAfter={(buffer: OptimizedBuffer) => {
            const plotWidth = Math.max(buffer.width - 2, 1);
            const plotHeight = Math.max(buffer.height - 2, 1);
            const pixelWidth = plotWidth * 2;
            const pixelHeight = plotHeight * 2;
            const pixels = new Uint8Array(pixelWidth * pixelHeight * 4);

            renderChartToPixels(pixels, pixelWidth, pixelHeight, projectedSeries, activeIndex);
            buffer.pushScissorRect(1, 1, plotWidth, plotHeight);
            buffer.drawSuperSampleBuffer(1, 1, ptr(pixels), pixels.byteLength, "rgba8unorm", pixelWidth * 4);
            buffer.popScissorRect();
          }}
        />
      </box>

      <box height={1} />

      <box height={1}>
        <text fg={colors.textDim}>
          {windowStart && windowEnd ? `${formatDate(windowStart.date)} -> ${formatDate(windowEnd.date)}` : "No visible window"}
        </text>
      </box>

      <box height={1}>
        <text fg={colors.textMuted}>
          mouse move inspect  drag pan  wheel zoom  shift-wheel pan  q or Esc quit
        </text>
      </box>
    </box>
  );
}

async function main() {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    backgroundColor: colors.bg,
    useMouse: true,
    enableMouseMovement: true,
    useAlternateScreen: true,
  });

  createRoot(renderer).render(<FramebufferChartDemo />);
}

main().catch((error) => {
  console.error("Framebuffer chart POC failed:", error);
  process.exitCode = 1;
});
