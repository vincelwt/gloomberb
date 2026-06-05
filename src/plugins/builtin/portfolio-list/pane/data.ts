import { createRowValueCache } from "../../../../components/ui/row-value-cache";
import { PRICE_SPARKLINE_COLUMN_ID } from "../../../../components/price-sparkline/view";
import type { AppConfig, ColumnConfig } from "../../../../types/config";
import type { TickerFinancials } from "../../../../types/financials";
import type { TickerRecord } from "../../../../types/ticker";
import type { CollectionSortPreference } from "../../../../state/app/context";
import { isQuoteStaleForCurrentSession } from "../../../../market-data/quotes/freshness";
import { compareSortValues } from "../../../../utils/sort-values";
import { getSortValue, type ColumnContext } from "../metrics";
import type { ResolvedPortfolioAccountState } from "../summary";

export const VISIBLE_FINANCIAL_REFRESH_COOLDOWN_MS = 5 * 60_000;
export const VISIBLE_FINANCIAL_WARMUP_DELAY_MS = 350;
export const VISIBLE_SNAPSHOT_WARMUP_BATCH_LIMIT = 3;

const STREAM_OVERSCAN_ROWS = 6;
const FUNDAMENTAL_COLUMN_IDS = new Set(["pe", "forward_pe", "dividend_yield"]);
const PROFILE_COLUMN_IDS = new Set(["sector", "industry"]);
const sortValueCache = createRowValueCache<string, ReturnType<typeof getSortValue>>(5000);

export interface VisibleWarmupRequirements {
  fundamentals: boolean;
  profile: boolean;
  priceHistory: boolean;
}

export function resolveVisibleWarmupRequirements(columns: ColumnConfig[]): VisibleWarmupRequirements {
  return {
    fundamentals: columns.some((column) => FUNDAMENTAL_COLUMN_IDS.has(column.id)),
    profile: columns.some((column) => PROFILE_COLUMN_IDS.has(column.id)),
    priceHistory: columns.some((column) => column.id === PRICE_SPARKLINE_COLUMN_ID),
  };
}

export function visibleWarmupKey(kind: "quote" | "snapshot", ticker: TickerRecord): string {
  return `${kind}:${ticker.metadata.ticker}:${ticker.metadata.exchange ?? ""}`;
}

export function needsVisibleQuoteWarmup(financials: TickerFinancials | undefined, now = Date.now()): boolean {
  return !financials?.quote || isQuoteStaleForCurrentSession(financials.quote, now);
}

export function needsVisibleSnapshotWarmup(
  ticker: TickerRecord,
  financials: TickerFinancials | undefined,
  requirements: VisibleWarmupRequirements,
): boolean {
  if (ticker.metadata.assetCategory === "OPT") return false;
  if (!financials?.quote) return false;
  if (requirements.fundamentals && Object.keys(financials.fundamentals ?? {}).length === 0) return true;
  if (requirements.profile && !financials.profile) return true;
  return requirements.priceHistory && financials.priceHistory.length === 0;
}

export function selectStreamTickers(
  tickers: TickerRecord[],
  visibleRange: { start: number; end: number },
  selectedSymbol?: string | null,
) {
  const start = Math.max(0, visibleRange.start - STREAM_OVERSCAN_ROWS);
  const end = Math.min(tickers.length, visibleRange.end + STREAM_OVERSCAN_ROWS);
  const visible = tickers.slice(start, end);
  if (!selectedSymbol || visible.some((ticker) => ticker.metadata.ticker === selectedSymbol)) {
    return visible;
  }
  const selectedTicker = tickers.find((ticker) => ticker.metadata.ticker === selectedSymbol);
  return selectedTicker ? [...visible, selectedTicker] : visible;
}

export function buildTrackedCurrencies(
  tickers: TickerRecord[],
  financialsMap: Map<string, TickerFinancials>,
  accountState: ResolvedPortfolioAccountState | null,
  baseCurrency: string,
): string[] {
  const currencies = new Set<string>([baseCurrency]);

  for (const ticker of tickers) {
    if (ticker.metadata.currency) {
      currencies.add(ticker.metadata.currency);
    }
    for (const position of ticker.metadata.positions) {
      if (position.currency) {
        currencies.add(position.currency);
      }
    }
    const financials = financialsMap.get(ticker.metadata.ticker);
    if (financials?.quote?.currency) {
      currencies.add(financials.quote.currency);
    }
  }

  for (const balance of accountState?.visibleCashBalances ?? []) {
    if (balance.currency) {
      currencies.add(balance.currency);
    }
    if (balance.baseCurrency) {
      currencies.add(balance.baseCurrency);
    }
  }

  return [...currencies];
}

export function getCollectionTypeFromConfig(config: AppConfig, collectionId: string | null): "portfolio" | "watchlist" | null {
  if (!collectionId) return null;
  if (config.portfolios.some((portfolio) => portfolio.id === collectionId)) return "portfolio";
  if (config.watchlists.some((watchlist) => watchlist.id === collectionId)) return "watchlist";
  return null;
}

export function getCollectionTickersFromConfig(
  config: AppConfig,
  tickersBySymbol: Map<string, TickerRecord>,
  collectionId: string | null,
): TickerRecord[] {
  if (!collectionId) return [];
  const isPortfolio = config.portfolios.some((portfolio) => portfolio.id === collectionId);
  const isWatchlist = !isPortfolio && config.watchlists.some((watchlist) => watchlist.id === collectionId);
  if (!isPortfolio && !isWatchlist) return [];
  return [...tickersBySymbol.values()]
    .filter((ticker) => (
      isPortfolio
        ? ticker.metadata.portfolios.includes(collectionId)
        : ticker.metadata.watchlists.includes(collectionId)
    ))
    .sort((left, right) => left.metadata.ticker.localeCompare(right.metadata.ticker));
}

export function sortTickers(
  tickers: TickerRecord[],
  financialsMap: Map<string, TickerFinancials>,
  sortPreference: CollectionSortPreference,
  columnContext: ColumnContext,
  columns: ColumnConfig[],
) {
  if (!sortPreference.columnId) return tickers;

  const sortColumn = columns.find((column) => column.id === sortPreference.columnId);
  if (!sortColumn) return tickers;
  const exchangeRatesVersion = [...columnContext.exchangeRates]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, rate]) => `${currency}:${rate}`)
    .join(",");
  const sortContextVersion = [
    sortColumn.id,
    columnContext.activeTab ?? "",
    columnContext.baseCurrency,
    columnContext.portfolioTotalMarketValue ?? 0,
    columnContext.supplementalVersion ?? 0,
    exchangeRatesVersion,
    sortColumn.id === "latency" ? columnContext.now : 0,
    sortColumn.id === "held" ? columnContext.now : 0,
  ].join("|");
  const sortValues = new Map<string, ReturnType<typeof getSortValue>>();
  for (const ticker of tickers) {
    const financials = financialsMap.get(ticker.metadata.ticker);
    const financialsVersion = [
      financials?.quote?.lastUpdated ?? 0,
      Object.keys(financials?.fundamentals ?? {}).length,
      financials?.priceHistory.length ?? 0,
    ].join(":");
    const positionsVersion = JSON.stringify(ticker.metadata.positions);
    const version = `${sortContextVersion}|${financialsVersion}|${positionsVersion}`;
    sortValues.set(ticker.metadata.ticker, sortValueCache.get(
      `${ticker.metadata.ticker}:${sortColumn.id}`,
      version,
      () => getSortValue(sortColumn, ticker, financials, columnContext),
    ));
  }

  return [...tickers].sort((leftTicker, rightTicker) => {
    const leftValue = sortValues.get(leftTicker.metadata.ticker) ?? null;
    const rightValue = sortValues.get(rightTicker.metadata.ticker) ?? null;

    return compareSortValues(leftValue, rightValue, sortPreference.direction);
  });
}
