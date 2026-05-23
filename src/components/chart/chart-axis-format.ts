import { formatCompactMarketPriceWithCurrency, formatMarketPrice, resolveAssetDisplayKind } from "../../utils/market-format";
import type { ChartAxisMode } from "./chart-types";

export function formatPrice(
  value: number,
  assetCategory?: string,
  priceRange?: number,
  precisionOffset = 0,
  minimumFractionDigits = 0,
  fixedFractionDigits?: number,
): string {
  return formatMarketPrice(value, {
    assetCategory,
    fixedFractionDigits,
    minimumFractionDigits,
    precisionOffset,
    priceRange,
  });
}

export function formatPriceWithCurrency(
  value: number,
  currency = "USD",
  assetCategory?: string,
  priceRange?: number,
  precisionOffset = 0,
  minimumFractionDigits = 0,
  fixedFractionDigits?: number,
): string {
  return formatCompactMarketPriceWithCurrency(value, currency, {
    assetCategory,
    fixedFractionDigits,
    minimumFractionDigits,
    precisionOffset,
    priceRange,
  });
}

export function getAxisFractionDigitFloor(assetCategory: string | undefined, priceRange: number | undefined): number {
  if (priceRange === undefined || !Number.isFinite(priceRange) || priceRange <= 0) return 0;

  const kind = resolveAssetDisplayKind({ assetCategory });
  const visibleStep = priceRange / 3;
  if (!Number.isFinite(visibleStep) || visibleStep <= 0) return 0;

  const offset = kind === "cash" ? 0 : 1;
  return Math.max(0, Math.ceil(-Math.log10(visibleStep)) + offset);
}

export function resolveAxisFractionDigits(
  prices: number[],
  formatLabel: (value: number, fixedFractionDigits: number) => string,
  minimumFractionDigits = 0,
  maxFractionDigits = 8,
): number {
  for (let fixedFractionDigits = minimumFractionDigits; fixedFractionDigits <= maxFractionDigits; fixedFractionDigits += 1) {
    const labels = prices.map((value) => formatLabel(value, fixedFractionDigits));
    if (hasDistinctAxisLabels(labels)) return fixedFractionDigits;
  }

  return maxFractionDigits;
}

export function resolveChartAxisWidth(
  labels: Array<string | null | undefined>,
  minimumWidth: number,
  maximumWidth: number,
): number {
  if (maximumWidth <= 0) return 0;

  const longestLabel = labels.reduce((maxWidth, label) => (
    Math.max(maxWidth, label?.length ?? 0)
  ), 0);

  return Math.min(Math.max(longestLabel, minimumWidth), maximumWidth);
}

export function formatAxisCell(label: string | null, width: number): string {
  if (width <= 0) return "";
  if (!label) return " ".repeat(width);
  return label.length >= width ? label.slice(0, width) : label.padStart(width);
}

export function formatAxisValue(
  value: number,
  axisMode: ChartAxisMode,
  basePrice: number,
  currency = "USD",
  assetCategory?: string,
  priceRange?: number,
  fixedFractionDigits?: number,
): string {
  if (axisMode === "percent" && basePrice !== 0) {
    return formatPercentAxisValue(((value - basePrice) / basePrice) * 100);
  }
  return formatPriceWithCurrency(value, currency, assetCategory, priceRange, 0, 0, fixedFractionDigits);
}

export function formatCursorAxisValue(
  value: number,
  axisMode: ChartAxisMode,
  basePrice: number,
  currency = "USD",
  assetCategory?: string,
  priceRange?: number,
): string {
  if (axisMode === "percent" && basePrice !== 0) {
    return formatPercentAxisValue(((value - basePrice) / basePrice) * 100);
  }

  return formatPriceWithCurrency(
    value,
    currency,
    assetCategory,
    priceRange,
    2,
    getCursorAxisMinimumFractionDigits(value, assetCategory),
  );
}

function formatPercentAxisValue(value: number): string {
  const abs = Math.abs(value);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(decimals)}%`;
}

function hasDistinctAxisLabels(labels: string[]): boolean {
  return new Set(labels).size === labels.length;
}

function getCursorAxisMinimumFractionDigits(value: number, assetCategory?: string): number {
  const kind = resolveAssetDisplayKind({ assetCategory });

  switch (kind) {
    case "cash":
      return 4;
    case "crypto":
      return Math.abs(value) >= 1 ? 4 : 6;
    case "equity":
    case "contract":
      return Math.abs(value) >= 1 ? 2 : 4;
    case "other":
    default:
      return Math.abs(value) >= 1 ? 2 : 4;
  }
}
