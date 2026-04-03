import type { CollectionSortPreference } from "../../../state/app-context";
import type { ColumnConfig } from "../../../types/config";
import type { TickerFinancials } from "../../../types/financials";
import type { TickerRecord } from "../../../types/ticker";
import { priceColor } from "../../../theme/colors";
import { clampQuoteTimestamp, formatQuoteAgeWithSource } from "../../../utils/quote-time";
import { convertCurrency, formatCompact, formatCurrency, formatNumber, formatPercentRaw, formatPrice } from "../../../utils/format";
import { getActiveQuoteDisplay, type ActiveQuoteDisplay } from "../../../utils/market-status";
import { formatOptionTicker } from "../../../utils/options";

export interface ColumnContext {
  activeTab?: string;
  baseCurrency: string;
  exchangeRates: Map<string, number>;
  now: number;
}

interface PortfolioPositionMetrics {
  positionCurrency: string;
  totalShares: number;
  totalCost: number;
  totalCostUnits: number;
  totalPriceUnits: number;
  brokerMktValue: number;
  hasBrokerMktValue: boolean;
  brokerPnl: number;
  hasBrokerPnl: boolean;
  brokerMarkPrice: number | undefined;
}

export interface PortfolioSummaryTotals {
  totalMktValue: number;
  dailyPnl: number;
  dailyPnlPct: number;
  totalCostBasis: number;
  hasPositions: boolean;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  avgWatchlistChange: number;
  watchlistCount: number;
}

const EMPTY_SORT_PREFERENCE: CollectionSortPreference = {
  columnId: null,
  direction: "asc",
};

const DEFAULT_PORTFOLIO_SORT_PREFERENCE: CollectionSortPreference = {
  columnId: "mkt_value",
  direction: "desc",
};

function getPositionCurrency(
  positions: TickerRecord["metadata"]["positions"],
  fallbackCurrency: string,
): string {
  return positions.find((position) => position.currency)?.currency || fallbackCurrency;
}

function normalizePositionMultiplier(multiplier: number | undefined): number {
  return typeof multiplier === "number" && Number.isFinite(multiplier) && multiplier > 0
    ? multiplier
    : 1;
}

function resolvePositionCostMultiplier(
  position: TickerRecord["metadata"]["positions"][number],
): number {
  const priceMultiplier = normalizePositionMultiplier(position.multiplier);
  if (priceMultiplier === 1) return 1;

  if (position.marketValue == null || position.unrealizedPnl == null) {
    return priceMultiplier;
  }

  const costWithoutMultiplier = position.shares * position.avgCost;
  const costWithMultiplier = costWithoutMultiplier * priceMultiplier;
  const withoutMultiplierError = Math.abs((position.marketValue - costWithoutMultiplier) - position.unrealizedPnl);
  const withMultiplierError = Math.abs((position.marketValue - costWithMultiplier) - position.unrealizedPnl);

  // IBKR gateway derivatives can report avgCost already scaled to the contract.
  return withoutMultiplierError < withMultiplierError ? 1 : priceMultiplier;
}

function getPortfolioPositionMetrics(
  ticker: TickerRecord,
  activeTab: string | undefined,
  fallbackCurrency: string,
): PortfolioPositionMetrics {
  const tabPositions = activeTab
    ? ticker.metadata.positions.filter((position) => position.portfolio === activeTab)
    : ticker.metadata.positions;
  const positionCurrency = getPositionCurrency(tabPositions, fallbackCurrency);
  let totalShares = 0;
  let totalCost = 0;
  let totalCostUnits = 0;
  let totalPriceUnits = 0;
  let brokerMktValue = 0;
  let hasBrokerMktValue = false;
  let brokerPnl = 0;
  let hasBrokerPnl = false;
  for (const position of tabPositions) {
    const direction = position.side === "short" ? -1 : 1;
    const priceMultiplier = normalizePositionMultiplier(position.multiplier);
    const costMultiplier = resolvePositionCostMultiplier(position);

    totalShares += position.shares * direction;
    totalCost += position.shares * position.avgCost * costMultiplier;
    totalCostUnits += position.shares * costMultiplier;
    totalPriceUnits += position.shares * priceMultiplier * direction;

    if (position.marketValue != null) {
      brokerMktValue += position.marketValue;
      hasBrokerMktValue = true;
    }
    if (position.unrealizedPnl != null) {
      brokerPnl += position.unrealizedPnl;
      hasBrokerPnl = true;
    }
  }

  return {
    positionCurrency,
    totalShares,
    totalCost,
    totalCostUnits,
    totalPriceUnits,
    brokerMktValue,
    hasBrokerMktValue,
    brokerPnl,
    hasBrokerPnl,
    brokerMarkPrice: tabPositions.length === 1 ? tabPositions[0]?.markPrice : undefined,
  };
}

function resolveBrokerFallbackMarketValue(metrics: PortfolioPositionMetrics): number | null {
  if (metrics.hasBrokerMktValue) return metrics.brokerMktValue;
  if (metrics.brokerMarkPrice != null && metrics.totalPriceUnits !== 0) {
    return Math.abs(metrics.totalPriceUnits) * metrics.brokerMarkPrice;
  }
  if (metrics.hasBrokerPnl) {
    return metrics.totalCost + metrics.brokerPnl;
  }
  return null;
}

function resolveBrokerFallbackPnl(metrics: PortfolioPositionMetrics, brokerMarketValue: number | null): number | null {
  if (metrics.hasBrokerPnl) return metrics.brokerPnl;
  if (brokerMarketValue != null && metrics.totalCost !== 0) {
    return brokerMarketValue - metrics.totalCost;
  }
  return null;
}

export function resolvePortfolioPriceValue(
  activeQuote: ActiveQuoteDisplay | null,
  brokerMarkPrice: number | undefined,
): { text: string; color?: string } {
  if (activeQuote) {
    return {
      text: formatPrice(activeQuote.price),
      color: priceColor(activeQuote.change),
    };
  }
  if (brokerMarkPrice != null) {
    return { text: formatPrice(brokerMarkPrice) };
  }
  return { text: "—" };
}

export function getColumnValue(
  col: ColumnConfig,
  ticker: TickerRecord,
  financials: TickerFinancials | undefined,
  ctx: ColumnContext,
): { text: string; color?: string } {
  const quote = financials?.quote;
  const activeQuote = getActiveQuoteDisplay(quote);
  const fundamentals = financials?.fundamentals;
  const quoteCurrency = quote?.currency || ticker.metadata.currency || "USD";

  const positionMetrics = getPortfolioPositionMetrics(ticker, ctx.activeTab, quoteCurrency);
  const { positionCurrency, totalShares, totalCost, totalCostUnits, totalPriceUnits, brokerMarkPrice } = positionMetrics;
  const brokerFallbackMktValue = resolveBrokerFallbackMarketValue(positionMetrics);
  const brokerFallbackPnl = resolveBrokerFallbackPnl(positionMetrics, brokerFallbackMktValue);
  const toBaseQuote = (value: number) =>
    convertCurrency(value, quoteCurrency, ctx.baseCurrency, ctx.exchangeRates);
  const toBasePosition = (value: number) =>
    convertCurrency(value, positionCurrency, ctx.baseCurrency, ctx.exchangeRates);

  switch (col.id) {
    case "ticker": {
      const marketState = quote?.marketState;
      const statusDot = marketState === "REGULAR" ? "\u25CF" : "\u25CB";
      const displayName = ticker.metadata.assetCategory === "OPT"
        ? formatOptionTicker(ticker.metadata.ticker)
        : ticker.metadata.ticker;
      return { text: `${statusDot} ${displayName}` };
    }
    case "price":
      return resolvePortfolioPriceValue(activeQuote, brokerMarkPrice);
    case "change":
      if (!activeQuote) return { text: "—" };
      return {
        text: (activeQuote.change >= 0 ? "+" : "") + activeQuote.change.toFixed(2),
        color: priceColor(activeQuote.change),
      };
    case "bid":
      return { text: quote?.bid != null ? formatPrice(quote.bid) : "—" };
    case "ask":
      return { text: quote?.ask != null ? formatPrice(quote.ask) : "—" };
    case "spread":
      return {
        text: quote?.bid != null && quote?.ask != null
          ? formatCurrency(quote.ask - quote.bid, quoteCurrency)
          : "—",
      };
    case "change_pct":
      return activeQuote
        ? { text: formatPercentRaw(activeQuote.changePercent), color: priceColor(activeQuote.changePercent) }
        : { text: quote ? formatPercentRaw(quote.changePercent) : "—", color: quote ? priceColor(quote.changePercent) : undefined };
    case "market_cap":
      if (!quote?.marketCap) return { text: "—" };
      return { text: formatCompact(toBaseQuote(quote.marketCap)) };
    case "pe":
      return { text: fundamentals?.trailingPE ? formatNumber(fundamentals.trailingPE, 1) : "—" };
    case "forward_pe":
      return { text: fundamentals?.forwardPE ? formatNumber(fundamentals.forwardPE, 1) : "—" };
    case "dividend_yield":
      return {
        text: fundamentals?.dividendYield != null ? `${(fundamentals.dividendYield * 100).toFixed(2)}%` : "—",
      };
    case "ext_hours":
      if ((quote?.marketState === "PRE" || quote?.marketState === "PREPRE") && quote.preMarketPrice != null) {
        const changePercent = activeQuote?.changePercent ?? quote.preMarketChangePercent ?? 0;
        return { text: formatPercentRaw(changePercent), color: priceColor(changePercent) };
      }
      if ((quote?.marketState === "POST" || quote?.marketState === "POSTPOST") && quote.postMarketPrice != null) {
        const changePercent = activeQuote?.changePercent ?? quote.postMarketChangePercent ?? 0;
        return { text: formatPercentRaw(changePercent), color: priceColor(changePercent) };
      }
      return { text: "—" };
    case "shares":
      return { text: totalShares !== 0 ? formatCompact(totalShares) : "—" };
    case "avg_cost":
      if (totalCostUnits === 0) return { text: "—" };
      return { text: formatPrice(totalCost / Math.abs(totalCostUnits)) };
    case "cost_basis":
      if (totalCost === 0) return { text: "—" };
      return { text: formatCompact(toBasePosition(totalCost)) };
    case "mkt_value":
      if (activeQuote && totalPriceUnits !== 0) {
        return { text: formatCompact(toBaseQuote(Math.abs(totalPriceUnits) * activeQuote.price)) };
      }
      if (brokerFallbackMktValue != null) {
        return { text: formatCompact(toBasePosition(brokerFallbackMktValue)) };
      }
      return { text: "—" };
    case "pnl":
      if (activeQuote && totalPriceUnits !== 0) {
        const pnl = toBaseQuote(Math.abs(totalPriceUnits) * activeQuote.price) - toBasePosition(totalCost);
        return { text: `${pnl >= 0 ? "+" : ""}${formatCompact(pnl)}`, color: priceColor(pnl) };
      }
      if (brokerFallbackPnl != null) {
        const pnl = toBasePosition(brokerFallbackPnl);
        return { text: `${pnl >= 0 ? "+" : ""}${formatCompact(pnl)}`, color: priceColor(pnl) };
      }
      return { text: "—" };
    case "pnl_pct":
      if (activeQuote && totalCost !== 0) {
        const marketValue = toBaseQuote(Math.abs(totalPriceUnits) * activeQuote.price);
        const costBasis = toBasePosition(totalCost);
        const percent = costBasis !== 0 ? ((marketValue - costBasis) / costBasis) * 100 : 0;
        return { text: formatPercentRaw(percent), color: priceColor(percent) };
      }
      if (brokerFallbackPnl != null && totalCost !== 0) {
        const costBasis = toBasePosition(totalCost);
        const pnl = toBasePosition(brokerFallbackPnl);
        const percent = costBasis !== 0 ? (pnl / costBasis) * 100 : 0;
        return { text: formatPercentRaw(percent), color: priceColor(percent) };
      }
      return { text: "—" };
    case "latency":
      return { text: formatQuoteAgeWithSource(quote, ctx.now) };
    default:
      return { text: "—" };
  }
}

export function getSortValue(
  col: ColumnConfig,
  ticker: TickerRecord,
  financials: TickerFinancials | undefined,
  ctx: ColumnContext,
): number | string | null {
  const quote = financials?.quote;
  const activeQuote = getActiveQuoteDisplay(quote);
  const fundamentals = financials?.fundamentals;
  const quoteCurrency = quote?.currency || ticker.metadata.currency || "USD";

  const positionMetrics = getPortfolioPositionMetrics(ticker, ctx.activeTab, quoteCurrency);
  const { positionCurrency, totalShares, totalCost, totalCostUnits, totalPriceUnits, brokerMarkPrice } = positionMetrics;
  const brokerFallbackMktValue = resolveBrokerFallbackMarketValue(positionMetrics);
  const brokerFallbackPnl = resolveBrokerFallbackPnl(positionMetrics, brokerFallbackMktValue);
  const toBaseQuote = (value: number) =>
    convertCurrency(value, quoteCurrency, ctx.baseCurrency, ctx.exchangeRates);
  const toBasePosition = (value: number) =>
    convertCurrency(value, positionCurrency, ctx.baseCurrency, ctx.exchangeRates);

  switch (col.id) {
    case "ticker":
      return ticker.metadata.ticker;
    case "price":
      if (activeQuote) return activeQuote.price;
      if (brokerMarkPrice != null) return brokerMarkPrice;
      return null;
    case "bid":
      return quote?.bid ?? null;
    case "ask":
      return quote?.ask ?? null;
    case "spread":
      return quote?.bid != null && quote?.ask != null ? quote.ask - quote.bid : null;
    case "change":
      return activeQuote ? activeQuote.change : null;
    case "change_pct":
      return activeQuote?.changePercent ?? null;
    case "market_cap":
      return quote?.marketCap ? toBaseQuote(quote.marketCap) : null;
    case "pe":
      return fundamentals?.trailingPE ?? null;
    case "forward_pe":
      return fundamentals?.forwardPE ?? null;
    case "dividend_yield":
      return fundamentals?.dividendYield ?? null;
    case "ext_hours":
      if ((quote?.marketState === "PRE" || quote?.marketState === "PREPRE") && quote.preMarketPrice != null) {
        return activeQuote?.changePercent ?? quote.preMarketChangePercent ?? 0;
      }
      if ((quote?.marketState === "POST" || quote?.marketState === "POSTPOST") && quote.postMarketPrice != null) {
        return activeQuote?.changePercent ?? quote.postMarketChangePercent ?? 0;
      }
      return null;
    case "shares":
      return totalShares !== 0 ? totalShares : null;
    case "avg_cost":
      return totalCostUnits !== 0 ? totalCost / Math.abs(totalCostUnits) : null;
    case "cost_basis":
      return totalCost !== 0 ? toBasePosition(totalCost) : null;
    case "mkt_value":
      if (activeQuote && totalPriceUnits !== 0) {
        return toBaseQuote(Math.abs(totalPriceUnits) * activeQuote.price);
      }
      if (brokerFallbackMktValue != null) {
        return toBasePosition(brokerFallbackMktValue);
      }
      return null;
    case "pnl":
      if (activeQuote && totalPriceUnits !== 0) {
        return toBaseQuote(Math.abs(totalPriceUnits) * activeQuote.price) - toBasePosition(totalCost);
      }
      if (brokerFallbackPnl != null) {
        return toBasePosition(brokerFallbackPnl);
      }
      return null;
    case "pnl_pct":
      if (activeQuote && totalCost !== 0) {
        const marketValue = toBaseQuote(Math.abs(totalPriceUnits) * activeQuote.price);
        const costBasis = toBasePosition(totalCost);
        return costBasis !== 0 ? ((marketValue - costBasis) / costBasis) * 100 : null;
      }
      if (brokerFallbackPnl != null && totalCost !== 0) {
        const costBasis = toBasePosition(totalCost);
        const pnl = toBasePosition(brokerFallbackPnl);
        return costBasis !== 0 ? (pnl / costBasis) * 100 : null;
      }
      return null;
    case "latency":
      return quote?.lastUpdated != null ? ctx.now - (clampQuoteTimestamp(quote.lastUpdated, ctx.now) ?? ctx.now) : null;
    default:
      return null;
  }
}

export function resolveCollectionSortPreference(
  collectionId: string | null,
  isPortfolio: boolean,
  collectionSorts: Record<string, CollectionSortPreference>,
): CollectionSortPreference {
  if (!collectionId) return EMPTY_SORT_PREFERENCE;
  return collectionSorts[collectionId] ?? (isPortfolio ? DEFAULT_PORTFOLIO_SORT_PREFERENCE : EMPTY_SORT_PREFERENCE);
}

export function calculatePortfolioSummaryTotals(
  tickers: TickerRecord[],
  financialsMap: Map<string, TickerFinancials>,
  baseCurrency: string,
  exchangeRates: Map<string, number>,
  isPortfolio: boolean,
  collectionId: string | null,
): PortfolioSummaryTotals {
  let totalMktValue = 0;
  let totalPrevValue = 0;
  let totalCostBasis = 0;
  let hasPositions = false;
  let watchlistChangeSum = 0;
  let watchlistCount = 0;

  for (const ticker of tickers) {
    const financials = financialsMap.get(ticker.metadata.ticker);
    const quote = financials?.quote;
    const activeQuote = getActiveQuoteDisplay(quote);
    const quoteCurrency = quote?.currency || ticker.metadata.currency || "USD";

    if (!isPortfolio) {
      if (quote?.changePercent != null) {
        watchlistChangeSum += quote.changePercent;
        watchlistCount++;
      }
      continue;
    }

    const positionMetrics = getPortfolioPositionMetrics(ticker, collectionId ?? undefined, quoteCurrency);
    const { positionCurrency, totalPriceUnits, totalCost } = positionMetrics;
    const brokerFallbackMktValue = resolveBrokerFallbackMarketValue(positionMetrics);
    const toBaseQuote = (value: number) => convertCurrency(value, quoteCurrency, baseCurrency, exchangeRates);
    const toBasePosition = (value: number) => convertCurrency(value, positionCurrency, baseCurrency, exchangeRates);

    if (quote && activeQuote && totalPriceUnits !== 0) {
      hasPositions = true;
      const marketValue = Math.abs(totalPriceUnits) * activeQuote.price;
      totalMktValue += toBaseQuote(marketValue);
      const previousClose = quote.previousClose || (activeQuote.price - activeQuote.change);
      totalPrevValue += toBaseQuote(Math.abs(totalPriceUnits) * previousClose);
      totalCostBasis += toBasePosition(totalCost);
    } else if (brokerFallbackMktValue != null) {
      hasPositions = true;
      totalMktValue += toBasePosition(brokerFallbackMktValue);
      totalCostBasis += toBasePosition(totalCost);
      totalPrevValue += toBasePosition(brokerFallbackMktValue);
    }
  }

  const dailyPnl = totalMktValue - totalPrevValue;
  const dailyPnlPct = totalPrevValue !== 0 ? (dailyPnl / totalPrevValue) * 100 : 0;
  const unrealizedPnl = totalMktValue - totalCostBasis;
  const unrealizedPnlPct = totalCostBasis !== 0 ? (unrealizedPnl / totalCostBasis) * 100 : 0;
  const avgWatchlistChange = watchlistCount > 0 ? watchlistChangeSum / watchlistCount : 0;

  return {
    totalMktValue,
    dailyPnl,
    dailyPnlPct,
    totalCostBasis,
    hasPositions,
    unrealizedPnl,
    unrealizedPnlPct,
    avgWatchlistChange,
    watchlistCount,
  };
}
