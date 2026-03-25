/** Format a number as currency (e.g., $1,234.56) */
export function formatCurrency(value: number | undefined, currency = "USD"): string {
  if (value === undefined || value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
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

/** Format large numbers compactly (e.g., 1.5T, 234B, 12.3M) */
export function formatCompact(value: number | undefined): string {
  if (value === undefined || value === null) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs.toFixed(2)}`;
}

/** Format a plain number with commas */
export function formatNumber(value: number | undefined, decimals = 2): string {
  if (value === undefined || value === null) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
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
export function padTo(str: string, width: number, align: "left" | "right" = "left"): string {
  if (str.length > width) return str.slice(0, width);
  if (align === "right") return str.padStart(width);
  return str.padEnd(width);
}
