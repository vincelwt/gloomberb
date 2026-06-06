import { priceColor } from "../../../../theme/colors";
import type { Quote, TickerFinancials } from "../../../../types/financials";
import type { TickerPosition, TickerRecord } from "../../../../types/ticker";
import {
  formatCompact,
  formatCompactCurrency,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatPercentRaw,
} from "../../../../utils/format";
import {
  formatMarketCostWithCurrency,
  formatMarketPriceWithCurrency,
  formatMarketQuantity,
} from "../../../../market-data/market/format";
import type { PositionTableRow, StatField } from "./types";

type CurrencyConverter = (value: number, fromCurrency: string) => number;

function compactPositionAccount(position: TickerPosition): string {
  const rawAccount = position.brokerAccountId || position.portfolio;
  const isBrokerPortfolio = rawAccount.startsWith("broker:");
  const account = isBrokerPortfolio
    ? rawAccount.split(":").filter(Boolean).at(-1) || rawAccount
    : rawAccount;
  const prefix = !isBrokerPortfolio && position.broker && position.broker !== "manual" ? `${position.broker} ` : "";
  const suffix = position.side === "short" ? " SHORT" : "";
  return `${prefix}${account}${suffix}`;
}

export function buildOverviewStats({
  quote,
  fundamentals,
  quoteCurrency,
  baseCurrency,
  toBase,
}: {
  quote: Quote | undefined;
  fundamentals: TickerFinancials["fundamentals"] | undefined;
  quoteCurrency: string;
  baseCurrency: string;
  toBase: CurrencyConverter;
}): StatField[] {
  const stats: StatField[] = [];

  if (quote?.volume != null) {
    stats.push({ label: "Volume", value: formatCompact(quote.volume) });
  }
  if (quote?.marketCap) {
    stats.push({ label: "Market Cap", value: formatCompactCurrency(toBase(quote.marketCap, quoteCurrency), baseCurrency) });
  }
  if (fundamentals?.sharesOutstanding) {
    stats.push({ label: "Shares Out", value: formatCompact(fundamentals.sharesOutstanding) });
  }
  if (fundamentals?.trailingPE) {
    stats.push({ label: "P/E (TTM)", value: formatNumber(fundamentals.trailingPE, 1) });
  }
  if (fundamentals?.forwardPE) {
    stats.push({ label: "Fwd P/E", value: formatNumber(fundamentals.forwardPE, 1) });
  }
  if (fundamentals?.eps) {
    stats.push({ label: "EPS", value: formatCurrency(fundamentals.eps, quoteCurrency) });
  }
  if (fundamentals?.pegRatio) {
    stats.push({ label: "PEG", value: formatNumber(fundamentals.pegRatio, 2) });
  }
  if (fundamentals?.dividendYield != null) {
    stats.push({ label: "Div Yield", value: formatPercent(fundamentals.dividendYield) });
  }
  if (fundamentals?.revenue) {
    stats.push({ label: "Revenue", value: formatCompact(fundamentals.revenue) });
  }
  if (fundamentals?.netIncome) {
    stats.push({ label: "Net Income", value: formatCompact(fundamentals.netIncome) });
  }
  if (fundamentals?.freeCashFlow) {
    stats.push({ label: "FCF", value: formatCompact(fundamentals.freeCashFlow) });
  }
  if (fundamentals?.operatingMargin != null) {
    stats.push({ label: "Op Margin", value: formatPercent(fundamentals.operatingMargin) });
  }
  if (fundamentals?.profitMargin != null) {
    stats.push({ label: "Profit Marg", value: formatPercent(fundamentals.profitMargin) });
  }
  if (fundamentals?.revenueGrowth != null) {
    stats.push({
      label: "Rev Growth",
      value: formatPercent(fundamentals.revenueGrowth),
      valueColor: priceColor(fundamentals.revenueGrowth),
    });
  }
  if (fundamentals?.enterpriseValue) {
    stats.push({ label: "EV", value: formatCompact(fundamentals.enterpriseValue) });
  }

  return stats;
}

export function buildPositionRows({
  ticker,
  quote,
  quoteCurrency,
  baseCurrency,
  toBase,
}: {
  ticker: TickerRecord;
  quote: Quote | undefined;
  quoteCurrency: string;
  baseCurrency: string;
  toBase: CurrencyConverter;
}): PositionTableRow[] {
  return ticker.metadata.positions.map((position) => {
    const positionCurrency = position.currency || quoteCurrency;
    const costBasis = position.shares * position.avgCost * (position.multiplier || 1);
    const costBasisBase = toBase(costBasis, positionCurrency);
    const fallbackMarkPrice = position.markPrice ?? quote?.price;
    const fallbackMarkCurrency = position.markPrice != null ? positionCurrency : quoteCurrency;
    const marketValueBase = position.marketValue != null
      ? toBase(position.marketValue, positionCurrency)
      : fallbackMarkPrice != null
        ? toBase(Math.abs(position.shares) * fallbackMarkPrice * (position.multiplier || 1), fallbackMarkCurrency)
        : null;
    const pnlValue = position.unrealizedPnl != null
      ? toBase(position.unrealizedPnl, positionCurrency)
      : marketValueBase != null
        ? marketValueBase - costBasisBase
        : null;
    const returnPercent = pnlValue != null && costBasisBase !== 0
      ? formatPercentRaw((pnlValue / Math.abs(costBasisBase)) * 100)
      : "—";
    const unit = position.multiplier && position.multiplier > 1 ? " ct" : " sh";

    return {
      account: compactPositionAccount(position),
      qty: `${formatMarketQuantity(position.shares, { assetCategory: ticker.metadata.assetCategory, multiplier: position.multiplier })}${unit}`,
      avg: formatMarketCostWithCurrency(position.avgCost, positionCurrency, {
        assetCategory: ticker.metadata.assetCategory,
        multiplier: position.multiplier,
      }),
      mark: fallbackMarkPrice != null
        ? formatMarketPriceWithCurrency(fallbackMarkPrice, fallbackMarkCurrency, {
            assetCategory: ticker.metadata.assetCategory,
            multiplier: position.multiplier,
          })
        : "—",
      cost: formatCurrency(costBasisBase, baseCurrency),
      value: marketValueBase != null ? formatCurrency(marketValueBase, baseCurrency) : "—",
      pnl: pnlValue != null ? `${pnlValue >= 0 ? "+" : ""}${formatCurrency(pnlValue, baseCurrency)}` : "—",
      ret: returnPercent,
      pnlValue,
    };
  });
}
