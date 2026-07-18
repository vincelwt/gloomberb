import type { PricePoint, TickerFinancials } from "../../types/financials";
import type { TickerRecord } from "../../types/ticker";
import type { TimeRange } from "../../components/chart/core/types";
import { subtractTimeRange } from "../../components/chart/core/date-window";
import { LEGACY_TICKER_DETAIL_PANE_ID } from "../../types/config";
import { normalizeTickerInput } from "../../tickers/search";
import type { MarketContext } from "../types";
import { cleanTickerInput } from "./options";
import type { ResolvedPaneFunction } from "./resolver";

const SHOT_PRICE_HISTORY_RANGE = "5Y" as const;
const FINANCIAL_ANALYSIS_PANE_ID = "financial-analysis";
const FINANCIAL_ANALYSIS_TEMPLATE_ID = "financial-analysis-pane";

export async function fetchTickerFinancials(
  context: MarketContext,
  symbol: string,
): Promise<{ tickerFile: TickerRecord | null; financials: TickerFinancials }> {
  const normalized = cleanTickerInput(symbol);
  const tickerFile = await context.store.loadTicker(normalized);
  const exchange = tickerFile?.metadata.exchange ?? "";
  const financials = await context.dataProvider.getTickerFinancials(normalized, exchange);
  return { tickerFile, financials };
}

export async function withShotPriceHistory(
  context: MarketContext,
  symbol: string,
  tickerFile: TickerRecord | null,
  financials: TickerFinancials,
): Promise<TickerFinancials> {
  if (financials.priceHistory?.length) return financials;
  const exchange = tickerFile?.metadata.exchange
    ?? financials.quote?.listingExchangeName
    ?? financials.quote?.exchangeName
    ?? "";
  try {
    const priceHistory = await context.dataProvider.getPriceHistory(symbol, exchange, SHOT_PRICE_HISTORY_RANGE);
    return priceHistory.length > 0 ? { ...financials, priceHistory } : financials;
  } catch {
    return financials;
  }
}

export function requireSymbol(resolved: ResolvedPaneFunction, rawArg: string): string {
  const symbol = resolved.createOptions?.symbol ?? normalizeTickerInput(null, cleanTickerInput(rawArg));
  if (!symbol) throw new Error(`Usage: gloomberb fn ${resolved.token} <symbol>`);
  return symbol;
}

export function isFinancialAnalysisFunction(resolved: ResolvedPaneFunction): boolean {
  if (resolved.pane.id === FINANCIAL_ANALYSIS_PANE_ID) return true;
  if (resolved.template?.id === FINANCIAL_ANALYSIS_TEMPLATE_ID) return true;
  return resolved.pane.id === LEGACY_TICKER_DETAIL_PANE_ID
    && resolved.instance.settings?.lockedTabId === "financials";
}

export function createFallbackTicker(symbol: string, financials: TickerFinancials | null, context: MarketContext): TickerRecord {
  const quote = financials?.quote;
  return {
    metadata: {
      ticker: symbol,
      exchange: quote?.listingExchangeName ?? quote?.exchangeName ?? "",
      currency: quote?.currency ?? context.config.baseCurrency,
      name: quote?.name ?? symbol,
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
    },
  };
}

export function collectShotSymbols(resolved: ResolvedPaneFunction, rawArg: string): string[] {
  let symbols = resolved.createOptions?.symbols?.length
    ? resolved.createOptions.symbols
    : [resolved.createOptions?.symbol ?? normalizeTickerInput(null, cleanTickerInput(rawArg))].filter((symbol): symbol is string => !!symbol);
  if (resolved.capability.id === "security-relationship" && symbols.length === 1) {
    symbols = [...symbols, "SPY"];
  }
  return [...new Set(symbols.map(cleanTickerInput).filter(Boolean))];
}

export function clipPriceHistoryToRange(points: PricePoint[], range: TimeRange): PricePoint[] {
  if (range === "ALL" || points.length === 0) return points;
  const dated = points.flatMap((point) => {
    const date = point.date instanceof Date ? point.date : new Date(point.date);
    return Number.isFinite(date.getTime()) ? [{ point, date }] : [];
  });
  const end = dated.reduce<Date | null>((latest, entry) => (
    !latest || entry.date.getTime() > latest.getTime() ? entry.date : latest
  ), null);
  if (!end) return [];
  const start = subtractTimeRange(end, range);
  return dated
    .filter(({ date }) => date.getTime() >= start.getTime() && date.getTime() <= end.getTime())
    .map(({ point }) => point);
}
