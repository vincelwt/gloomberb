import type { NativeChartBitmap } from "../native/chart-rasterizer";
import {
  drawCircle,
  drawLine,
  fillRect,
  parseHex,
  type RgbaColor,
} from "../native/raster/primitives";
import { buildCompositeColumnLayout, type CompositeColumnLayout } from "./column-layout";
import { projectCompositeValue } from "./scene";
import type {
  CompositeAxisDomain,
  CompositeChartColors,
  CompositePanelScene,
  CompositeProjectedPoint,
  CompositeProjectedSeries,
} from "./types";

interface RenderCompositePanelBitmapOptions {
  pixelWidth: number;
  pixelHeight: number;
  cursorXRatio: number | null;
  cursorYRatio: number | null;
  colors: CompositeChartColors;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function pixelPoint(point: CompositeProjectedPoint, width: number, height: number): { x: number; y: number } {
  return {
    x: clamp(point.xRatio * Math.max(width - 1, 0), 0, Math.max(width - 1, 0)),
    y: clamp(point.yRatio * Math.max(height - 1, 0), 0, Math.max(height - 1, 0)),
  };
}

function pixelY(value: number, domain: CompositeAxisDomain, height: number): number | null {
  const ratio = projectCompositeValue(value, domain);
  return ratio === null ? null : clamp(ratio * Math.max(height - 1, 0), 0, Math.max(height - 1, 0));
}

function drawConnectedSeries(
  data: Uint8Array,
  width: number,
  height: number,
  series: CompositeProjectedSeries,
  domain: CompositeAxisDomain,
  color: RgbaColor,
  area: boolean,
): void {
  const points = series.points.map((point) => pixelPoint(point, width, height));
  if (points.length === 0) return;
  const baseline = pixelY(0, domain, height) ?? height - 1;
  const step = series.source.style === "step" || series.source.interpolation === "step-after";

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    if (series.points[index]?.breakBefore) continue;
    if (area) {
      const left = Math.round(Math.min(previous.x, current.x));
      const right = Math.round(Math.max(previous.x, current.x));
      for (let x = left; x <= right; x += 1) {
        const ratio = right === left ? 0 : (x - left) / (right - left);
        const y = step ? previous.y : previous.y + (current.y - previous.y) * ratio;
        fillRect(data, width, height, x, Math.min(y, baseline), x, Math.max(y, baseline), color, 0.14);
      }
    }
    if (step) {
      drawLine(data, width, height, previous.x, previous.y, current.x, previous.y, color, 1.4);
      drawLine(data, width, height, current.x, previous.y, current.x, current.y, color, 1.4);
    } else {
      drawLine(data, width, height, previous.x, previous.y, current.x, current.y, color, 1.5);
    }
  }

  // A line segment cannot represent a lone observation (or one isolated by
  // missing values). Mark only those observations; do not extend them across
  // time or add markers to normally connected lines.
  for (let index = 0; index < points.length; index += 1) {
    const connectedToPrevious = index > 0 && series.points[index]?.breakBefore === false;
    const connectedToNext = index + 1 < points.length && series.points[index + 1]?.breakBefore === false;
    if (!connectedToPrevious && !connectedToNext) {
      const point = points[index]!;
      drawCircle(data, width, height, point.x, point.y, 2.2, color);
    }
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function observationGaps(points: CompositeProjectedPoint[], pixelWidth: number): number[] {
  const xs = points.map((point) => point.xRatio * Math.max(pixelWidth - 1, 0)).sort((left, right) => left - right);
  const positiveGaps: number[] = [];
  for (let index = 1; index < xs.length; index += 1) {
    const gap = xs[index]! - xs[index - 1]!;
    if (gap > 0) positiveGaps.push(gap);
  }
  return positiveGaps;
}

function observationWidth(points: CompositeProjectedPoint[], pixelWidth: number, maximum: number): number {
  const minimumGap = Math.min(...observationGaps(points, pixelWidth));
  return clamp(Number.isFinite(minimumGap) ? minimumGap * 0.58 : maximum, 2, maximum);
}

function columnObservationWidth(
  points: CompositeProjectedPoint[],
  pixelWidth: number,
  maximum: number,
): number {
  const typicalGap = median(observationGaps(points, pixelWidth));
  return clamp(typicalGap === null ? maximum : typicalGap * 0.58, 2, maximum);
}

export function resolveCompositeColumnWidth(
  points: CompositeProjectedPoint[],
  pixelWidth: number,
): number {
  const maximum = clamp(pixelWidth * 0.04, 18, 72);
  return columnObservationWidth(points, pixelWidth, maximum);
}

export function resolveCompositeOhlcWidth(
  points: CompositeProjectedPoint[],
  pixelWidth: number,
): number {
  return observationWidth(points, pixelWidth, 9);
}

function drawColumns(
  data: Uint8Array,
  width: number,
  height: number,
  series: CompositeProjectedSeries,
  domain: CompositeAxisDomain,
  color: RgbaColor,
  layout: CompositeColumnLayout,
  opacity: number,
): void {
  const baseline = pixelY(0, domain, height) ?? height - 1;
  const singleSeriesWidth = resolveCompositeColumnWidth(series.points, width);
  const hasGroupedObservations = series.points.some((point) => (
    (layout.groupByPoint.get(point)?.count ?? 1) > 1
  ));
  const groupedSeriesWidth = hasGroupedObservations
    ? resolveCompositeColumnWidth(layout.pointsByAxis[series.source.axis], width)
    : singleSeriesWidth;
  for (const projected of series.points) {
    const point = pixelPoint(projected, width, height);
    const group = layout.groupByPoint.get(projected) ?? { index: 0, count: 1 };
    const clusterWidth = group.count > 1 ? groupedSeriesWidth : singleSeriesWidth;
    if (group.count === 1) {
      fillRect(
        data,
        width,
        height,
        point.x - clusterWidth / 2,
        Math.min(point.y, baseline),
        point.x + clusterWidth / 2,
        Math.max(point.y, baseline),
        color,
        opacity,
      );
      continue;
    }

    const drawableWidth = Math.min(clusterWidth, Math.max(width - 1, 1));
    const slotWidth = drawableWidth / group.count;
    const columnWidth = slotWidth * 0.78;
    const clusterLeft = clamp(
      point.x - drawableWidth / 2,
      0,
      Math.max(width - 1 - drawableWidth, 0),
    );
    const columnCenter = clusterLeft + slotWidth * (group.index + 0.5);
    fillRect(
      data,
      width,
      height,
      columnCenter - columnWidth / 2,
      Math.min(point.y, baseline),
      columnCenter + columnWidth / 2,
      Math.max(point.y, baseline),
      color,
      opacity,
    );
  }
}

function drawOhlc(
  data: Uint8Array,
  width: number,
  height: number,
  series: CompositeProjectedSeries,
  domain: CompositeAxisDomain,
  color: RgbaColor,
  negative: RgbaColor,
): void {
  const candleWidth = resolveCompositeOhlcWidth(series.points, width);
  for (const projected of series.points) {
    const source = projected.point;
    const x = pixelPoint(projected, width, height).x;
    const close = source.close ?? projected.value;
    const open = source.open ?? close;
    const high = source.high ?? Math.max(open, close);
    const low = source.low ?? Math.min(open, close);
    const highY = pixelY(high, domain, height);
    const lowY = pixelY(low, domain, height);
    const openY = pixelY(open, domain, height);
    const closeY = pixelY(close, domain, height);
    if (highY === null || lowY === null || closeY === null) continue;
    const candleColor = close >= open ? color : negative;
    drawLine(data, width, height, x, highY, x, lowY, candleColor, 1.1);
    if (series.source.style === "candles" && openY !== null) {
      fillRect(
        data,
        width,
        height,
        x - candleWidth / 2,
        Math.min(openY, closeY),
        x + candleWidth / 2,
        Math.max(openY, closeY) + 1,
        candleColor,
        0.88,
      );
      continue;
    }
    if (series.source.style === "ohlc" && openY !== null) {
      drawLine(data, width, height, x - candleWidth / 2, openY, x, openY, candleColor, 1.2);
    }
    drawLine(data, width, height, x, closeY, x + candleWidth / 2, closeY, candleColor, 1.2);
  }
}

export function renderCompositePanelBitmap(
  panel: CompositePanelScene,
  options: RenderCompositePanelBitmapOptions,
): NativeChartBitmap {
  const width = Math.max(1, Math.floor(options.pixelWidth));
  const height = Math.max(1, Math.floor(options.pixelHeight));
  const data = new Uint8Array(width * height * 4);
  const background = parseHex(options.colors.background);
  const grid = parseHex(options.colors.grid);
  const crosshair = parseHex(options.colors.crosshair);
  const negative = parseHex(options.colors.negative);
  fillRect(data, width, height, 0, 0, width - 1, height - 1, background, 1);

  for (let index = 1; index <= 3; index += 1) {
    const y = (height - 1) * (index / 4);
    fillRect(data, width, height, 0, y, width - 1, y + 0.6, grid, 0.42);
  }

  const ordered = [...panel.series].sort((left, right) => {
    const rank = (style: string) => style === "area" || style === "columns" ? 0 : 1;
    return rank(left.source.style) - rank(right.source.style);
  });
  const columnLayout = buildCompositeColumnLayout(panel);
  const mixesColumnsWithOtherMarks = panel.series.some((series) => series.source.style === "columns")
    && panel.series.some((series) => series.source.style !== "columns");
  for (const series of ordered) {
    const domain = panel.axes[series.source.axis];
    if (!domain) continue;
    const color = parseHex(series.source.color);
    switch (series.source.style) {
      case "columns":
        drawColumns(
          data,
          width,
          height,
          series,
          domain,
          color,
          columnLayout,
          mixesColumnsWithOtherMarks ? 0.48 : 0.72,
        );
        break;
      case "area":
        drawConnectedSeries(data, width, height, series, domain, color, true);
        break;
      case "points":
        for (const point of series.points) {
          const projected = pixelPoint(point, width, height);
          drawCircle(data, width, height, projected.x, projected.y, 2.4, color);
        }
        break;
      case "candles":
      case "ohlc":
      case "hlc":
        drawOhlc(data, width, height, series, domain, color, negative);
        break;
      case "line":
      case "step":
        drawConnectedSeries(data, width, height, series, domain, color, false);
        break;
    }
  }

  if (options.cursorXRatio !== null) {
    const x = clamp(options.cursorXRatio * Math.max(width - 1, 0), 0, Math.max(width - 1, 0));
    fillRect(data, width, height, x - 0.55, 0, x + 0.55, height - 1, crosshair, 0.75);
    for (const series of panel.series) {
      const cursorPoint = series.points.find((point) => Math.abs(point.xRatio - options.cursorXRatio!) < 1e-9);
      if (!cursorPoint) continue;
      const projected = pixelPoint(cursorPoint, width, height);
      drawCircle(data, width, height, projected.x, projected.y, 2.6, parseHex(series.source.color));
    }
  }
  if (options.cursorYRatio !== null) {
    const y = clamp(options.cursorYRatio * Math.max(height - 1, 0), 0, Math.max(height - 1, 0));
    fillRect(data, width, height, 0, y - 0.55, width - 1, y + 0.55, crosshair, 0.75);
    if (options.cursorXRatio !== null) {
      const x = clamp(options.cursorXRatio * Math.max(width - 1, 0), 0, Math.max(width - 1, 0));
      drawCircle(data, width, height, x, y, 3, crosshair);
    }
  }

  return { width, height, pixels: data };
}
