import type { ResolvedSeries } from "../../../time-series/types";
import type { CompositeAxisDomain } from "./types";

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CNY: "¥",
};

const HOUR_MS = 60 * 60 * 1_000;
const INTRADAY_SPAN_MAX_MS = 36 * HOUR_MS;

function compactNumber(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(absolute >= 10_000_000_000_000 ? 0 : 1)}T`;
  if (absolute >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(absolute >= 10_000_000_000 ? 0 : 1)}B`;
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(absolute >= 10_000_000 ? 0 : 1)}M`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(absolute >= 10_000 ? 0 : 1)}K`;
  if (absolute >= 100) return value.toFixed(0);
  if (absolute >= 10) return value.toFixed(1);
  if (absolute >= 1) return value.toFixed(2);
  if (absolute === 0) return "0";
  return value.toPrecision(3);
}

function currencyPrefix(unit: string): string {
  const currency = unit.trim().toUpperCase().split(/[\s/]/)[0] ?? "";
  return CURRENCY_SYMBOLS[currency] ?? "";
}

export function formatCompositeSeriesValue(value: number, series: ResolvedSeries): string {
  const unit = series.unit.trim();
  const group = series.unitGroup.toLowerCase();
  const compact = compactNumber(value);
  if (group.includes("percent") || unit === "%" || unit.toLowerCase().includes("percent")) {
    return `${compact}%`;
  }
  if (group.includes("ratio") || unit.toLowerCase() === "x") return `${compact}x`;
  const currency = currencyPrefix(unit);
  if (currency) return `${currency}${compact}`;
  return unit && unit.length <= 6 ? `${compact}${unit.startsWith("/") ? "" : " "}${unit}` : compact;
}

export function formatCompositeAxisValue(value: number, domain: CompositeAxisDomain): string {
  const compact = compactNumber(value);
  const group = domain.unitGroup.toLowerCase();
  if (group.includes("percent") || domain.unit === "%") return `${compact}%`;
  if (group.includes("ratio") || domain.unit.toLowerCase() === "x") return `${compact}x`;
  return `${currencyPrefix(domain.unit)}${compact}`;
}

export function compositeAxisTicks(domain: CompositeAxisDomain, count = 3): Array<{ ratio: number; value: number; label: string }> {
  const tickCount = Math.max(2, Math.floor(count));
  return Array.from({ length: tickCount }, (_, index) => {
    const ratio = index / (tickCount - 1);
    const value = domain.scale === "log"
      ? Math.exp(Math.log(domain.max) + (Math.log(domain.min) - Math.log(domain.max)) * ratio)
      : domain.max + (domain.min - domain.max) * ratio;
    return { ratio, value, label: formatCompositeAxisValue(value, domain) };
  });
}

function utcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcTime(date: Date): string {
  return date.toISOString().slice(11, 16);
}

function isIntradaySpan(startTime: number, endTime: number): boolean {
  return Number.isFinite(startTime)
    && Number.isFinite(endTime)
    && Math.abs(endTime - startTime) <= INTRADAY_SPAN_MAX_MS;
}

/** Shared-cursor timestamp using the chart's explicit UTC convention. */
export function formatCompositeCursorDate(date: Date, startTime: number, endTime: number): string {
  return isIntradaySpan(startTime, endTime)
    ? `${utcDate(date)} ${utcTime(date)} UTC`
    : utcDate(date);
}

/** Compact UTC tick label selected from the full visible chart span. */
export function formatCompositeTimeAxisDate(date: Date, startTime: number, endTime: number): string {
  if (!isIntradaySpan(startTime, endTime)) return utcDate(date);
  const startDate = utcDate(new Date(startTime));
  const endDate = utcDate(new Date(endTime));
  return startDate === endDate
    ? `${utcTime(date)} UTC`
    : `${utcDate(date).slice(5)} ${utcTime(date)} UTC`;
}
