import type { ChartRenderMode } from "../chart-types";

function getSeriesPosition(
  index: number,
  pointCount: number,
  width: number,
  startPadding = 0,
  endPadding = startPadding,
): number {
  const start = Math.max(startPadding, 0);
  const end = Math.max(start, width - 1 - Math.max(endPadding, 0));
  if (pointCount <= 1) return Math.round((start + end) / 2);
  return Math.round(start + (index / (pointCount - 1)) * (end - start));
}

export function getScaledY(value: number, min: number, max: number, chartTop: number, chartBottom: number): number {
  const range = max - min || 1;
  const chartH = chartBottom - chartTop;
  return chartTop + Math.round((1 - (value - min) / range) * chartH);
}

export function getCandleHalfWidth(pointCount: number, bufWidth: number): number {
  if (pointCount <= 1) return 2;
  const spacing = bufWidth / pointCount;
  const bodyW = Math.min(Math.max(Math.round(spacing * 0.55), 2), 10);
  return Math.floor(bodyW / 2);
}

export function getBarHalfWidth(pointCount: number, bufWidth: number): number {
  if (pointCount <= 1) return 2;
  const spacing = bufWidth / pointCount;
  const barW = Math.min(Math.max(Math.round(spacing * 0.45), 1), 10);
  return Math.floor(barW / 2);
}

function isOhlcLikeMode(mode: ChartRenderMode): boolean {
  return mode === "ohlc" || mode === "hlc";
}

export function isHighLowMode(mode: ChartRenderMode): boolean {
  return mode === "candles" || isOhlcLikeMode(mode);
}

export function getOhlcTickLength(pointCount: number, bufWidth: number): number {
  if (pointCount <= 1) return 4;
  const spacing = bufWidth / pointCount;
  return Math.min(Math.max(Math.round(spacing * 0.45), 3), 5);
}

export function getOhlcStemWidth(pointCount: number, bufWidth: number): number {
  if (pointCount <= 1) return 3;
  const spacing = bufWidth / pointCount;
  return Math.min(Math.max(Math.round(spacing * 0.2), 2), 3);
}

function getOhlcHorizontalPad(pointCount: number, bufWidth: number): number {
  const tickLen = getOhlcTickLength(pointCount, bufWidth);
  const stemWidth = getOhlcStemWidth(pointCount, bufWidth);
  return Math.max(tickLen - 1, Math.ceil((stemWidth - 1) / 2), 0);
}

export function getDotX(index: number, pointCount: number, width: number, mode: ChartRenderMode): number {
  switch (mode) {
    case "candles": {
      const pad = getCandleHalfWidth(pointCount, width);
      return getSeriesPosition(index, pointCount, width, pad, pad);
    }
    case "ohlc":
    case "hlc": {
      const pad = getOhlcHorizontalPad(pointCount, width);
      return getSeriesPosition(index, pointCount, width, pad, pad);
    }
    default:
      return getSeriesPosition(index, pointCount, width);
  }
}

function getPointDotX(index: number, pointCount: number, width: number, mode: ChartRenderMode): number {
  return getDotX(index, pointCount, Math.max(width * 2, 1), mode);
}

export function getPointTerminalColumn(index: number, pointCount: number, width: number, mode: ChartRenderMode): number {
  if (width <= 1) return 0;
  return Math.min(Math.max(Math.floor(getPointDotX(index, pointCount, width, mode) / 2), 0), width - 1);
}

export function getTimePointBand(index: number, pointCount: number, width: number): { left: number; right: number } {
  const currentX = getSeriesPosition(index, pointCount, width);
  const previousX = index > 0 ? getSeriesPosition(index - 1, pointCount, width) : currentX;
  const nextX = index < pointCount - 1 ? getSeriesPosition(index + 1, pointCount, width) : currentX;
  return {
    left: index === 0 ? 0 : Math.floor((previousX + currentX) / 2) + 1,
    right: index === pointCount - 1 ? Math.max(width - 1, 0) : Math.floor((currentX + nextX) / 2),
  };
}
