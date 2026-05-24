import type { PricePoint } from "../../../types/financials";
import type { LocalPlotPointer } from "../core/pointer";
import type { ComparisonChartRenderMode } from "../core/types";
import type { projectComparisonChartData } from "../comparison/data";
import { formatPercentRaw } from "../../../utils/format";
import { formatMarketPriceWithCurrency } from "../../../market-data/market/format";

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function buildComparisonNativeBitmapKey(
  symbolCount: number,
  projection: ReturnType<typeof projectComparisonChartData>,
  selectedSymbol: string | null,
  pixelWidth: number,
  pixelHeight: number,
  paletteKey: string,
  marketSessionKey: string,
): string {
  const fingerprint = projection.series
    .map((series) => [
      series.symbol,
      series.color,
      series.fillColor,
      ...series.points.map((point) => {
        const timestamp = point.date.getTime();
        return `${timestamp}:${point.value ?? "null"}:${point.rawValue ?? "null"}`;
      }),
    ].join("|"))
    .join("::");
  return [
    symbolCount,
    projection.effectiveMode,
    projection.effectiveAxisMode,
    selectedSymbol ?? "",
    pixelWidth,
    pixelHeight,
    paletteKey,
    marketSessionKey,
    fingerprint,
  ].join("::");
}

export function getLegendColumns(width: number): number {
  if (width >= 110) return 3;
  if (width >= 72) return 2;
  return 1;
}

export function clipText(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text.padEnd(width);
  if (width <= 3) return text.slice(0, width);
  return `${text.slice(0, width - 3)}...`;
}

export function formatLegendSummary(
  symbol: string,
  rawValue: number | null,
  baseValue: number | null,
  currency: string,
  priceRange: number | undefined,
): string {
  if (rawValue === null) return `${symbol} waiting`;
  const price = formatMarketPriceWithCurrency(rawValue, currency, {
    minimumFractionDigits: 2,
    precisionOffset: 1,
    priceRange,
  });
  if (baseValue === null || baseValue === 0) return `${symbol} ${price}`;
  return `${symbol} ${price} ${formatPercentRaw(((rawValue - baseValue) / baseValue) * 100)}`;
}

export function getInitialComparisonMode(mode: string | undefined): ComparisonChartRenderMode {
  return mode === "line" ? "line" : "area";
}

function getComparisonPlotColumn(index: number, pointCount: number, width: number): number {
  if (pointCount <= 1 || width <= 1) return 0;
  return Math.round((index / (pointCount - 1)) * Math.max(width - 1, 0));
}

function resolveSelectionCursorX(cellX: number, pointCount: number, width: number): number | null {
  if (pointCount <= 0 || width <= 0) return null;

  let bestIndex = pointCount - 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < pointCount; index += 1) {
    const pointColumn = getComparisonPlotColumn(index, pointCount, width);
    const distance = Math.abs(pointColumn - cellX);
    if (distance <= bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return getComparisonPlotColumn(bestIndex, pointCount, width);
}

export function resolveSelectionCursor(
  pointer: LocalPlotPointer,
  pointCount: number,
  width: number,
): { cursorX: number | null; cursorY: number | null } {
  if (!pointer.hasPixelPrecision) {
    return {
      cursorX: pointer.cellX,
      cursorY: pointer.cellY,
    };
  }

  return {
    cursorX: resolveSelectionCursorX(pointer.cellX, pointCount, width),
    cursorY: null,
  };
}

export function getUniqueSortedSeriesDates(series: Array<{ points: PricePoint[] }>): Date[] {
  const byTimestamp = new Map<number, Date>();
  for (const entry of series) {
    for (const point of entry.points) {
      const date = point.date instanceof Date ? point.date : new Date(point.date);
      const timestamp = date.getTime();
      if (!Number.isNaN(timestamp)) {
        byTimestamp.set(timestamp, date);
      }
    }
  }
  return [...byTimestamp.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, date]) => date);
}
