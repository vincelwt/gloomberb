import type { ColumnConfig } from "../../../types/config";
import type { TickerFinancials } from "../../../types/financials";
import type { TickerRecord } from "../../../types/ticker";
import { priceColor } from "../../../theme/colors";
import { formatQuoteAgeWithSource, resolveQuoteAgeTimestamp } from "../../../market-data/quotes/time";
import { convertCurrency, formatCompact, formatNumber, formatPercentRaw } from "../../../utils/format";
import {
  formatMarketCost,
  formatMarketPrice,
  formatMarketQuantity,
  formatSignedMarketPrice,
  type MarketFormatOptions,
} from "../../../market-data/market/format";
import { getActiveQuoteDisplay, marketStateDot, type ActiveQuoteDisplay } from "../../../market-data/market/status";
import { formatOptionTicker } from "../../../utils/options";
import { PRICE_SPARKLINE_COLUMN_ID } from "../../../components/price-sparkline/view";
import {
  getPortfolioPositionMetrics,
  resolveBrokerFallbackMarketValue,
  resolveBrokerFallbackPnl,
} from "./position-metrics";

export interface ColumnContext {
  activeTab?: string;
  baseCurrency: string;
  exchangeRates: Map<string, number>;
  now: number;
}

export function resolvePortfolioPriceValue(
  activeQuote: ActiveQuoteDisplay | null,
  brokerMarkPrice: number | undefined,
  formatOptions: MarketFormatOptions,
  maxWidth?: number,
): { text: string; color?: string } {
  if (activeQuote) {
    return {
      text: formatMarketPrice(activeQuote.price, { ...formatOptions, maxWidth }),
      color: priceColor(activeQuote.change),
    };
  }
  if (brokerMarkPrice != null) {
    return { text: formatMarketPrice(brokerMarkPrice, { ...formatOptions, maxWidth }) };
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
  const { positionCurrency, totalShares, totalCost, totalCostUnits, totalPriceUnits, multiplierHint, brokerMarkPrice } = positionMetrics;
  const brokerFallbackMktValue = resolveBrokerFallbackMarketValue(positionMetrics);
  const brokerFallbackPnl = resolveBrokerFallbackPnl(positionMetrics, brokerFallbackMktValue);
  const toBaseQuote = (value: number) =>
    convertCurrency(value, quoteCurrency, ctx.baseCurrency, ctx.exchangeRates);
  const toBasePosition = (value: number) =>
    convertCurrency(value, positionCurrency, ctx.baseCurrency, ctx.exchangeRates);
  const formatOptions: MarketFormatOptions = {
    assetCategory: ticker.metadata.assetCategory,
    multiplier: multiplierHint,
  };

  switch (col.id) {
    case "ticker": {
      const marketState = quote?.marketState;
      const statusDot = marketStateDot(marketState);
      const displayName = ticker.metadata.assetCategory === "OPT"
        ? formatOptionTicker(ticker.metadata.ticker)
        : ticker.metadata.ticker;
      return { text: `${statusDot} ${displayName}` };
    }
    case "price":
      return resolvePortfolioPriceValue(activeQuote, brokerMarkPrice, formatOptions, col.width);
    case "change":
      if (!activeQuote) return { text: "—" };
      return {
        text: formatSignedMarketPrice(activeQuote.change, { ...formatOptions, maxWidth: col.width }),
        color: priceColor(activeQuote.change),
      };
    case "bid":
      return { text: quote?.bid != null ? formatMarketPrice(quote.bid, { ...formatOptions, maxWidth: col.width }) : "—" };
    case "ask":
      return { text: quote?.ask != null ? formatMarketPrice(quote.ask, { ...formatOptions, maxWidth: col.width }) : "—" };
    case "spread":
      return {
        text: quote?.bid != null && quote?.ask != null
          ? formatMarketPrice(quote.ask - quote.bid, { ...formatOptions, maxWidth: col.width })
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
      return { text: totalShares !== 0 ? formatMarketQuantity(totalShares, { ...formatOptions, maxWidth: col.width }) : "—" };
    case "avg_cost":
      if (totalCostUnits === 0) return { text: "—" };
      return { text: formatMarketCost(totalCost / Math.abs(totalCostUnits), { ...formatOptions, maxWidth: col.width }) };
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
    case "day_pnl":
      if (activeQuote && totalPriceUnits !== 0) {
        const dayPnl = toBaseQuote(totalPriceUnits * activeQuote.change);
        return { text: `${dayPnl >= 0 ? "+" : ""}${formatCompact(dayPnl)}`, color: priceColor(dayPnl) };
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
    case PRICE_SPARKLINE_COLUMN_ID:
      return { text: "" };
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
    case "day_pnl":
      if (activeQuote && totalPriceUnits !== 0) {
        return toBaseQuote(totalPriceUnits * activeQuote.change);
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
      return quote ? ctx.now - (resolveQuoteAgeTimestamp(quote, ctx.now) ?? ctx.now) : null;
    case PRICE_SPARKLINE_COLUMN_ID: {
      const values = (financials?.priceHistory ?? [])
        .map((point) => point.close)
        .filter((value) => Number.isFinite(value));
      const first = values[0];
      const last = values.at(-1);
      return first != null && last != null && first !== 0 ? ((last - first) / Math.abs(first)) * 100 : null;
    }
    default:
      return null;
  }
}
