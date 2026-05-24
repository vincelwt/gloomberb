import type { TickerFinancials } from "../../types/financials";
import type { TickerRecord } from "../../types/ticker";
import { normalizeTickerInput } from "../../tickers/search";
import type { MarketContext } from "../types";
import { cleanTickerInput } from "./options";
import type { ResolvedPaneFunction } from "./resolver";

const SHOT_PRICE_HISTORY_RANGE = "5Y" as const;

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
  return resolved.pane.id === "ticker-detail"
    && (
      resolved.template?.id === "financial-analysis-pane"
      || resolved.instance.settings?.lockedTabId === "financials"
    );
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
  const symbols = resolved.createOptions?.symbols?.length
    ? resolved.createOptions.symbols
    : [resolved.createOptions?.symbol ?? normalizeTickerInput(null, cleanTickerInput(rawArg))].filter((symbol): symbol is string => !!symbol);
  return [...new Set(symbols.map(cleanTickerInput).filter(Boolean))];
}
