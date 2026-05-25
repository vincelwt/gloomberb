import { formatMarketPriceWithCurrency } from "../../../market-data/market/format";
import type { Quote } from "../../../types/financials";
import { displayWidth } from "../../../utils/format";

export type TickerBadgeStatus = "loading" | "ready";

export function formatTickerBadgeChange(changePercent: number): string {
  const rounded = Math.round(changePercent * 10) / 10;
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  if (normalized === 0) return "0%";
  const abs = Math.abs(normalized);
  const body = Number.isInteger(abs) ? abs.toFixed(0) : abs.toFixed(1);
  return `${normalized > 0 ? "+" : "-"}${body}%`;
}

export function getTickerBadgeText({
  symbol,
  status,
  quote,
  liveQuote = true,
  hovered = false,
}: {
  symbol: string;
  status: TickerBadgeStatus;
  quote: Quote | null;
  liveQuote?: boolean;
  hovered?: boolean;
}): string {
  const quoteForDisplay = liveQuote ? quote : null;
  const quoteLabel = hovered && quoteForDisplay
    ? `${symbol} ${formatMarketPriceWithCurrency(quoteForDisplay.price, quoteForDisplay.currency, { minimumFractionDigits: 2 })}`
    : status === "ready" && quoteForDisplay
      ? formatTickerBadgeChange(quoteForDisplay.changePercent)
      : "\u2026";
  return liveQuote
    ? hovered && quoteForDisplay ? quoteLabel : `${symbol} ${quoteLabel}`
    : symbol;
}

export function getTickerBadgeCellWidth(options: Parameters<typeof getTickerBadgeText>[0]): number {
  return displayWidth(getTickerBadgeText(options)) + 3;
}
