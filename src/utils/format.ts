import { toTimestampMillis } from "./timestamp";

const currencyFormatters = new Map<string, Intl.NumberFormat>();
const numberFormatters = new Map<number, Intl.NumberFormat>();

function getCurrencyFormatter(currency: string): Intl.NumberFormat {
  let formatter = currencyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    currencyFormatters.set(currency, formatter);
  }
  return formatter;
}

function getNumberFormatter(decimals: number): Intl.NumberFormat {
  let formatter = numberFormatters.get(decimals);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    numberFormatters.set(decimals, formatter);
  }
  return formatter;
}

/** Format a number as currency (e.g., $1,234.56) */
export function formatCurrency(value: number | undefined, currency = "USD"): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  return getCurrencyFormatter(currency).format(value);
}

/** Format a number as percentage (e.g., +1.23%) */
export function formatPercent(value: number | undefined): string {
  if (value === undefined || value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(2)}%`;
}

/** Format a percentage that's already in percent form (e.g., 1.23 -> +1.23%) */
export function formatPercentRaw(value: number | undefined): string {
  if (value === undefined || value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

/** Format large numbers compactly (e.g., 1.5T, 234B, 12.3M, 5k) */
export function formatCompact(value: number | undefined): string {
  if (value === undefined || value === null) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const fmt = (n: number, decimals: number, suffix: string) => {
    const fixed = n.toFixed(decimals);
    // Strip unnecessary trailing zeros after decimal point
    const trimmed = fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
    return `${sign}${trimmed}${suffix}`;
  };
  if (abs >= 1e12) return fmt(abs / 1e12, 2, "T");
  if (abs >= 1e9) return fmt(abs / 1e9, 2, "B");
  if (abs >= 1e6) return fmt(abs / 1e6, 2, "M");
  if (abs >= 1e3) return fmt(abs / 1e3, 1, "k");
  return fmt(abs, 2, "");
}

/** Format a compact value with an explicit currency code (e.g., 1.5T USD) */
export function formatCompactCurrency(value: number | undefined, currency = "USD"): string {
  if (value === undefined || value === null) return "—";
  return `${formatCompact(value)} ${currency}`;
}

/** Format a plain number with commas */
export function formatNumber(value: number | undefined, decimals = 2): string {
  if (value === undefined || value === null) return "—";
  return getNumberFormatter(decimals).format(value);
}

/** Format a price with commas, trimming unnecessary trailing zeros (e.g., 3,565.00 -> 3,565) */
export function formatPrice(value: number | undefined): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  const formatted = getNumberFormatter(2).format(value);
  return formatted.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

/** Format a growth rate compactly (e.g., +12%, -5%) */
export function formatGrowthShort(value: number): string {
  const pct = value * 100;
  const sign = pct > 0 ? "+" : "";
  return Math.abs(pct) >= 10
    ? `${sign}${Math.round(pct)}%`
    : `${sign}${pct.toFixed(1)}%`;
}

/** Pick a common unit suffix for a set of numbers */
export function pickUnit(values: (number | undefined)[]): { suffix: string; divisor: number } {
  const defined = values.filter((v): v is number => v != null);
  if (!defined.length) return { suffix: "", divisor: 1 };
  const maxAbs = Math.max(...defined.map(Math.abs));
  if (maxAbs >= 1e12) return { suffix: "T", divisor: 1e12 };
  if (maxAbs >= 1e9) return { suffix: "B", divisor: 1e9 };
  if (maxAbs >= 1e6) return { suffix: "M", divisor: 1e6 };
  if (maxAbs >= 1e3) return { suffix: "K", divisor: 1e3 };
  return { suffix: "", divisor: 1 };
}

/** Format a number using a pre-determined divisor (no unit suffix) */
export function formatWithDivisor(value: number | undefined, divisor: number): string {
  if (value === undefined || value === null) return "—";
  const scaled = value / divisor;
  const abs = Math.abs(scaled);
  const decimals = abs >= 100 ? 1 : 2;
  return scaled.toFixed(decimals);
}

/** Pad/truncate a string to a fixed width */
export function padTo(str: string, width: number, align: "left" | "right" | "center" = "left"): string {
  if (str.length > width) return str.slice(0, width);
  if (align === "right") return str.padStart(width);
  if (align === "center") {
    const totalPadding = width - str.length;
    const leftPadding = Math.floor(totalPadding / 2);
    const rightPadding = totalPadding - leftPadding;
    return " ".repeat(leftPadding) + str + " ".repeat(rightPadding);
  }
  return str.padEnd(width);
}

/** Convert a value from one currency to base currency using cached exchange rates */
export function convertCurrency(
  value: number,
  fromCurrency: string,
  baseCurrency: string,
  exchangeRates: Map<string, number>,
): number {
  if (fromCurrency === baseCurrency) return value;
  const fromRate = exchangeRates.get(fromCurrency);
  const baseRate = exchangeRates.get(baseCurrency);
  if (fromRate == null || baseRate == null || baseRate === 0) return value;
  return (value * fromRate) / baseRate;
}

/** Format a date/timestamp as relative time (e.g., "5m ago", "2h ago") */
export function formatTimeAgo(date: Date | string): string {
  const ts = toTimestampMillis(date);
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" });
}
