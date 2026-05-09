import { useMemo } from "react";
import { Box, ChartSurface, Span, Text, TextAttributes, useNativeRenderer, useUiCapabilities, useUiHost } from "../ui";
import { computeBitmapSize, type NativeChartBitmap } from "./chart/native/chart-rasterizer";
import { colors } from "../theme/colors";

export interface SpeedometerSegment {
  from: number;
  to: number;
  label: string;
  color: string;
}

export interface SpeedometerGaugeProps {
  value: number;
  valueLabel: string;
  width: number;
  segments: SpeedometerSegment[];
  min?: number;
  max?: number;
  currentLabel?: string;
  minWidth?: number;
  maxWidth?: number;
}

interface GaugeCell {
  char: string;
  color?: string;
}

interface GaugeChunk {
  text: string;
  color?: string;
}

interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

const DEFAULT_MIN_WIDTH = 34;
const DEFAULT_MAX_WIDTH = 50;
const DESKTOP_VIEWBOX_WIDTH = 520;
const DESKTOP_VIEWBOX_HEIGHT = 232;
const DESKTOP_CENTER_X = 260;
const DESKTOP_CENTER_Y = 182;
const DESKTOP_ARC_RADIUS = 138;
const DESKTOP_NEEDLE_RADIUS = 104;
const DESKTOP_LABEL_POSITIONS = [
  { x: 90, y: 84 },
  { x: 172, y: 44 },
  { x: 260, y: 30 },
  { x: 348, y: 44 },
  { x: 430, y: 84 },
];
const DESKTOP_TICK_LABEL_POSITIONS = [
  { x: 78, y: 224 },
  { x: 170, y: 224 },
  { x: 260, y: 224 },
  { x: 350, y: 224 },
  { x: 442, y: 224 },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeValue(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return clamp((value - min) / (max - min), 0, 1);
}

function valueToAngle(value: number, min: number, max: number): number {
  return Math.PI - normalizeValue(value, min, max) * Math.PI;
}

function valueToDegrees(value: number, min: number, max: number): number {
  return -90 + normalizeValue(value, min, max) * 180;
}

function formatGaugeValue(value: number): string {
  if (!Number.isFinite(value)) return "--";
  return String(Math.round(value));
}

function segmentForValue(value: number, segments: SpeedometerSegment[]): SpeedometerSegment | null {
  return segments.find((segment) => value >= segment.from && value <= segment.to)
    ?? segments[segments.length - 1]
    ?? null;
}

function blankGaugeLine(width: number): GaugeCell[] {
  return Array.from({ length: width }, () => ({ char: " " }));
}

function placeText(cells: GaugeCell[], label: string, center: number, color?: string): void {
  const width = cells.length;
  if (width <= 0) return;
  const text = label.length > width ? label.slice(0, width) : label;
  const start = Math.max(0, Math.min(width - text.length, Math.round(center - text.length / 2)));
  for (let index = 0; index < text.length; index += 1) {
    cells[start + index] = { char: text[index]!, color };
  }
}

function cellsToChunks(cells: GaugeCell[]): GaugeChunk[] {
  const chunks: GaugeChunk[] = [];
  for (const cell of cells) {
    const last = chunks[chunks.length - 1];
    if (last && last.color === cell.color) {
      last.text += cell.char;
    } else {
      chunks.push({ text: cell.char, color: cell.color });
    }
  }
  return chunks;
}

function segmentColorForScore(score: number, segments: SpeedometerSegment[]): string {
  return segmentForValue(score, segments)?.color ?? colors.textDim;
}

function labelForSegment(segment: SpeedometerSegment, gaugeWidth: number): string {
  if (gaugeWidth >= 64) return segment.label;
  const compact = compactSegmentLabel(segment);
  if (gaugeWidth >= 44) {
    return compact === "NEUTRAL" ? "NEUT" : compact;
  }
  if (compact === "EXT FEAR") return "XF";
  if (compact === "EXT GREED") return "XG";
  if (compact === "NEUTRAL") return "NEUT";
  return compact;
}

function compactSegmentLabel(segment: SpeedometerSegment): string {
  return segment.label.replace(/^EXTREME /, "EXT ");
}

function renderLabelRow(width: number, min: number, max: number, segments: SpeedometerSegment[]): GaugeChunk[] {
  const cells = blankGaugeLine(width);
  for (const segment of segments) {
    const centerValue = (segment.from + segment.to) / 2;
    const center = normalizeValue(centerValue, min, max) * (width - 1);
    placeText(cells, labelForSegment(segment, width), center, segment.color);
  }
  return cellsToChunks(cells);
}

function renderTickRow(width: number, min: number, max: number): GaugeChunk[] {
  const cells = blankGaugeLine(width);
  for (const tick of [min, min + (max - min) * 0.25, min + (max - min) * 0.5, min + (max - min) * 0.75, max]) {
    placeText(cells, formatGaugeValue(tick), normalizeValue(tick, min, max) * (width - 1), colors.textDim);
  }
  return cellsToChunks(cells);
}

function renderArcRows(value: number, min: number, max: number, width: number, segments: SpeedometerSegment[]): GaugeChunk[][] {
  const dialHeight = 7;
  const dial = Array.from({ length: dialHeight }, () => blankGaugeLine(width));
  const centerX = Math.floor((width - 1) / 2);
  const centerY = dialHeight - 1;
  const radiusX = Math.max(8, (width - 4) / 2);
  const radiusY = dialHeight - 1;

  for (let step = 0; step <= 220; step += 1) {
    const normalized = step / 220;
    const score = min + normalized * (max - min);
    const angle = Math.PI - normalized * Math.PI;
    const x = Math.round(centerX + Math.cos(angle) * radiusX);
    const y = Math.round(centerY - Math.sin(angle) * radiusY);
    if (dial[y]?.[x]) {
      dial[y]![x] = { char: "●", color: segmentColorForScore(score, segments) };
    }
  }

  for (const tick of [min, min + (max - min) * 0.25, min + (max - min) * 0.5, min + (max - min) * 0.75, max]) {
    const angle = valueToAngle(tick, min, max);
    const x = Math.round(centerX + Math.cos(angle) * radiusX);
    const y = Math.round(centerY - Math.sin(angle) * radiusY);
    if (dial[y]?.[x]) {
      dial[y]![x] = { char: "│", color: colors.textDim };
    }
  }

  const pointerAngle = valueToAngle(value, min, max);
  const pointerChar = Math.abs(Math.cos(pointerAngle)) < 0.22
    ? "│"
    : Math.cos(pointerAngle) > 0
      ? "/"
      : "\\";
  for (let t = 0.14; t <= 0.75; t += 0.06) {
    const x = Math.round(centerX + Math.cos(pointerAngle) * radiusX * t);
    const y = Math.round(centerY - Math.sin(pointerAngle) * radiusY * t);
    if (dial[y]?.[x]) {
      dial[y]![x] = { char: pointerChar, color: colors.textBright };
    }
  }

  placeText(dial[centerY]!, formatGaugeValue(value), centerX, colors.textBright);
  return dial.map(cellsToChunks);
}

function GaugeLine({ chunks }: { chunks: GaugeChunk[] }) {
  return (
    <Text>
      {chunks.map((chunk, index) => (
        <Span key={`${index}-${chunk.text}`} fg={chunk.color}>{chunk.text}</Span>
      ))}
    </Text>
  );
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

function drawCircle(data: Uint8Array, width: number, height: number, centerX: number, centerY: number, radius: number, color: RgbaColor) {
  const minX = Math.floor(centerX - radius - 1);
  const maxX = Math.ceil(centerX + radius + 1);
  const minY = Math.floor(centerY - radius - 1);
  const maxY = Math.ceil(centerY + radius + 1);

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY);
      const coverage = 1 - clamp((distance - (radius - 0.75)) / 1.5, 0, 1);
      if (coverage > 0) blendPixel(data, width, height, x, y, color, coverage);
    }
  }
}

function drawLine(data: Uint8Array, width: number, height: number, x0: number, y0: number, x1: number, y1: number, color: RgbaColor, thickness: number) {
  const half = thickness / 2;
  const minX = Math.floor(Math.min(x0, x1) - half - 1);
  const maxX = Math.ceil(Math.max(x0, x1) + half + 1);
  const minY = Math.floor(Math.min(y0, y1) - half - 1);
  const maxY = Math.ceil(Math.max(y0, y1) + half + 1);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const segmentLengthSq = dx * dx + dy * dy || 1;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const projection = clamp((((x + 0.5) - x0) * dx + ((y + 0.5) - y0) * dy) / segmentLengthSq, 0, 1);
      const nearestX = x0 + dx * projection;
      const nearestY = y0 + dy * projection;
      const distance = Math.hypot(x + 0.5 - nearestX, y + 0.5 - nearestY);
      const coverage = 1 - clamp((distance - half) / 1.2, 0, 1);
      if (coverage > 0) blendPixel(data, width, height, x, y, color, coverage);
    }
  }
}

function renderGaugeBitmap(
  value: number,
  min: number,
  max: number,
  segments: SpeedometerSegment[],
  pixelWidth: number,
  pixelHeight: number,
): NativeChartBitmap {
  const pixels = new Uint8Array(pixelWidth * pixelHeight * 4);
  const centerX = pixelWidth / 2;
  const centerY = pixelHeight * 0.84;
  const radius = Math.min(pixelWidth * 0.42, pixelHeight * 0.72);
  const arcThickness = Math.max(4, Math.min(pixelWidth, pixelHeight) * 0.038);

  for (const segment of segments) {
    const start = valueToAngle(segment.from, min, max);
    const end = valueToAngle(segment.to, min, max);
    const steps = Math.max(8, Math.ceil(Math.abs(end - start) * radius * 0.36));
    const color = parseHex(segment.color, 0.9);
    for (let index = 0; index <= steps; index += 1) {
      const t = index / steps;
      const angle = start + (end - start) * t;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY - Math.sin(angle) * radius;
      drawCircle(pixels, pixelWidth, pixelHeight, x, y, arcThickness, color);
    }
  }

  for (const tick of [min, min + (max - min) * 0.25, min + (max - min) * 0.5, min + (max - min) * 0.75, max]) {
    const angle = valueToAngle(tick, min, max);
    const innerX = centerX + Math.cos(angle) * (radius - arcThickness * 1.45);
    const innerY = centerY - Math.sin(angle) * (radius - arcThickness * 1.45);
    const outerX = centerX + Math.cos(angle) * (radius + arcThickness * 1.25);
    const outerY = centerY - Math.sin(angle) * (radius + arcThickness * 1.25);
    drawLine(pixels, pixelWidth, pixelHeight, innerX, innerY, outerX, outerY, parseHex(colors.textDim, 0.8), Math.max(1, arcThickness * 0.22));
  }

  const angle = valueToAngle(value, min, max);
  const needleEndX = centerX + Math.cos(angle) * (radius * 0.76);
  const needleEndY = centerY - Math.sin(angle) * (radius * 0.76);
  drawLine(pixels, pixelWidth, pixelHeight, centerX, centerY, needleEndX, needleEndY, parseHex(colors.textBright, 0.98), Math.max(3, arcThickness * 0.48));

  return { width: pixelWidth, height: pixelHeight, pixels };
}

function polarToCartesian(centerX: number, centerY: number, radius: number, angleDegrees: number) {
  const angleRadians = (angleDegrees - 90) * Math.PI / 180;
  return {
    x: centerX + radius * Math.cos(angleRadians),
    y: centerY + radius * Math.sin(angleRadians),
  };
}

function describeArc(centerX: number, centerY: number, radius: number, startAngle: number, endAngle: number): string {
  const start = polarToCartesian(centerX, centerY, radius, endAngle);
  const end = polarToCartesian(centerX, centerY, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function DesktopGauge({
  value,
  valueLabel,
  width,
  segments,
  min,
  max,
  currentLabel,
  minWidth,
  maxWidth,
}: Required<SpeedometerGaugeProps>) {
  const gaugeWidth = Math.min(Math.max(width - 2, minWidth), maxWidth);
  const needleAngle = valueToDegrees(value, min, max);
  const needleEnd = polarToCartesian(DESKTOP_CENTER_X, DESKTOP_CENTER_Y, DESKTOP_NEEDLE_RADIUS, needleAngle);

  return (
    <Box
      width={gaugeWidth}
      height={12}
      marginTop={1}
      overflow="hidden"
      style={{ alignSelf: "center", maxWidth: 420 }}
    >
      <svg
        viewBox={`0 0 ${DESKTOP_VIEWBOX_WIDTH} ${DESKTOP_VIEWBOX_HEIGHT}`}
        width="100%"
        height="100%"
        role="img"
        aria-label={`${currentLabel} ${formatGaugeValue(value)} ${valueLabel}`}
        style={{ display: "block" }}
      >
        {segments.map((segment) => (
          <path
            key={segment.label}
            d={describeArc(
              DESKTOP_CENTER_X,
              DESKTOP_CENTER_Y,
              DESKTOP_ARC_RADIUS,
              valueToDegrees(segment.from, min, max),
              valueToDegrees(segment.to, min, max),
            )}
            fill="none"
            stroke={segment.color}
            strokeWidth="22"
            strokeLinecap="butt"
            opacity={value >= segment.from && value <= segment.to ? 0.96 : 0.42}
          />
        ))}
        {segments.map((segment, index) => {
          const fixedPoint = segments.length === DESKTOP_LABEL_POSITIONS.length
            ? DESKTOP_LABEL_POSITIONS[index]
            : null;
          const midpoint = (valueToDegrees(segment.from, min, max) + valueToDegrees(segment.to, min, max)) / 2;
          const point = fixedPoint ?? polarToCartesian(DESKTOP_CENTER_X, DESKTOP_CENTER_Y, DESKTOP_ARC_RADIUS + 36, midpoint);
          return (
            <text
              key={`label:${segment.label}`}
              x={point.x}
              y={point.y}
              fill={segment.color}
              textAnchor="middle"
              dominantBaseline="middle"
              fontFamily="inherit"
              fontSize="14"
              fontWeight="700"
            >
              {compactSegmentLabel(segment)}
            </text>
          );
        })}
        {[min, min + (max - min) * 0.25, min + (max - min) * 0.5, min + (max - min) * 0.75, max].map((tick, index) => {
          const angle = valueToDegrees(tick, min, max);
          const outer = polarToCartesian(DESKTOP_CENTER_X, DESKTOP_CENTER_Y, DESKTOP_ARC_RADIUS + 16, angle);
          const inner = polarToCartesian(DESKTOP_CENTER_X, DESKTOP_CENTER_Y, DESKTOP_ARC_RADIUS - 10, angle);
          const label = DESKTOP_TICK_LABEL_POSITIONS[index]
            ?? polarToCartesian(DESKTOP_CENTER_X, DESKTOP_CENTER_Y, DESKTOP_ARC_RADIUS + 34, angle);
          return (
            <g key={tick}>
              <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke={colors.textDim} strokeWidth="2" />
              <text x={label.x} y={label.y} fill={colors.textDim} textAnchor="middle" fontFamily="inherit" fontSize="13">
                {formatGaugeValue(tick)}
              </text>
            </g>
          );
        })}
        <line
          x1={DESKTOP_CENTER_X}
          y1={DESKTOP_CENTER_Y}
          x2={needleEnd.x}
          y2={needleEnd.y}
          stroke={colors.textBright}
          strokeWidth="7"
          strokeLinecap="round"
        />
        <circle cx={DESKTOP_CENTER_X} cy={DESKTOP_CENTER_Y} r="27" fill={colors.bg} />
        <text x={DESKTOP_CENTER_X} y={DESKTOP_CENTER_Y + 18} fill={colors.textBright} textAnchor="middle" fontFamily="inherit" fontSize="31" fontWeight="800">
          {formatGaugeValue(value)}
        </text>
      </svg>
    </Box>
  );
}

function TerminalGauge({
  value,
  valueLabel,
  width,
  segments,
  min,
  max,
  currentLabel,
  minWidth,
  maxWidth,
}: Required<SpeedometerGaugeProps>) {
  const {
    nativeCharts,
    cellWidthPx = 8,
    cellHeightPx = 18,
    pixelRatio = 1,
  } = useUiCapabilities();
  const nativeRenderer = useNativeRenderer();
  const gaugeWidth = Math.max(minWidth, Math.min(maxWidth, Math.floor(width - 4)));
  const labelRow = useMemo(() => renderLabelRow(gaugeWidth, min, max, segments), [gaugeWidth, max, min, segments]);
  const tickRow = useMemo(() => renderTickRow(gaugeWidth, min, max), [gaugeWidth, max, min]);
  const arcRows = useMemo(() => renderArcRows(value, min, max, gaugeWidth, segments), [gaugeWidth, max, min, segments, value]);
  const rendererResolution = nativeRenderer.resolution;
  const rendererTerminalWidth = nativeRenderer.terminalWidth;
  const rendererTerminalHeight = nativeRenderer.terminalHeight;
  const bitmap = useMemo<NativeChartBitmap | null>(() => {
    if (!nativeCharts) return null;
    const bitmapSize = rendererResolution && rendererTerminalWidth > 0 && rendererTerminalHeight > 0
      ? computeBitmapSize(
        { x: 0, y: 0, width: gaugeWidth, height: arcRows.length },
        rendererResolution,
        rendererTerminalWidth,
        rendererTerminalHeight,
      )
      : null;
    const scale = Math.max(1, pixelRatio);
    const pixelWidth = bitmapSize?.pixelWidth ?? Math.max(1, Math.round(gaugeWidth * cellWidthPx * scale));
    const pixelHeight = bitmapSize?.pixelHeight ?? Math.max(1, Math.round(arcRows.length * cellHeightPx * scale));
    return renderGaugeBitmap(
      value,
      min,
      max,
      segments,
      pixelWidth,
      pixelHeight,
    );
  }, [
    arcRows.length,
    cellHeightPx,
    cellWidthPx,
    gaugeWidth,
    max,
    min,
    nativeCharts,
    pixelRatio,
    rendererResolution,
    rendererTerminalHeight,
    rendererTerminalWidth,
    segments,
    value,
  ]);

  return (
    <Box flexDirection="column" alignItems="center" marginTop={1}>
      <GaugeLine chunks={labelRow} />
      <ChartSurface width={gaugeWidth} height={arcRows.length} flexDirection="column" bitmaps={bitmap ? [bitmap] : null}>
        {arcRows.map((chunks, index) => (
          <GaugeLine key={index} chunks={chunks} />
        ))}
      </ChartSurface>
      <GaugeLine chunks={tickRow} />
      <Box flexDirection="row" marginTop={1}>
        <Text fg={colors.textDim}>{currentLabel} </Text>
        <Text fg={segmentColorForScore(value, segments)} attributes={TextAttributes.BOLD}>{valueLabel}</Text>
      </Box>
    </Box>
  );
}

export function SpeedometerGauge({
  value,
  valueLabel,
  width,
  segments,
  min = 0,
  max = 100,
  currentLabel = "Current reading",
  minWidth = DEFAULT_MIN_WIDTH,
  maxWidth = DEFAULT_MAX_WIDTH,
}: SpeedometerGaugeProps) {
  const props = {
    value,
    valueLabel,
    width,
    segments,
    min,
    max,
    currentLabel,
    minWidth,
    maxWidth,
  };
  return useUiHost().kind === "desktop-web"
    ? <DesktopGauge {...props} />
    : <TerminalGauge {...props} />;
}
