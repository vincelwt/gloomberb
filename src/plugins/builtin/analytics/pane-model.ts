import { resolveChartPalette } from "../../../components/chart/core/renderer";
import { colors, priceColor } from "../../../theme/colors";
import type { TickerFinancials, PricePoint } from "../../../types/financials";
import type { BrokerPortfolioPerformance } from "../../../types/trading";
import type { Portfolio, TickerRecord } from "../../../types/ticker";
import { formatCompact, formatNumber, formatPercentRaw } from "../../../utils/format";
import { formatRelativeAge } from "../../../utils/relative-time";
import { instrumentFromTicker, type ChartRequest } from "../../../market-data/request-types";
import { buildChartKey } from "../../../market-data/selectors";
import { resolvePortfolioAccountMetrics, resolvePortfolioMarketValue } from "../portfolio-list/account-metrics";
import type { ColumnContext, PortfolioSummaryTotals } from "../portfolio-list/metrics";
import type { ResolvedPortfolioAccountState } from "../portfolio-list/summary";
import { performancePointValue } from "./broker-performance";
import {
  betaColor,
  betaLabel,
  formatReturn,
  formatSignedCompact,
  sharpeColor,
  sharpeLabel,
} from "./display";
import {
  computeDatedReturns,
  computeWeightedPortfolioReturns,
  type DatedReturn,
  type WeightedReturnSeries,
} from "./metrics";
import { getPortfolioPositionValue } from "./sector-model";
import type { AnalyticsMetricRow } from "./view";

export interface PortfolioChartTarget {
  ticker: TickerRecord;
  request: ChartRequest;
}

export type ChartEntryLookup = Map<string, {
  data?: PricePoint[] | null;
  lastGoodData?: PricePoint[] | null;
} | undefined>;

function formatIsoDateMonthDay(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatAccountFreshness(account: ResolvedPortfolioAccountState["account"] | undefined): string | null {
  if (!account) return null;
  if (account.asOfDate) return formatIsoDateMonthDay(account.asOfDate);
  return account.updatedAt ? formatRelativeAge(account.updatedAt) : null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatMarginLeverage(netLiquidation: number | undefined, totalMarketValue: number): string | null {
  if (!finiteNumber(netLiquidation) || !finiteNumber(totalMarketValue) || totalMarketValue <= 0) return null;
  return `${(netLiquidation / totalMarketValue).toFixed(1)}x`;
}

export function buildPortfolioChartTargets(portfolioTickers: TickerRecord[]): PortfolioChartTarget[] {
  return portfolioTickers.flatMap((ticker) => {
    const instrument = instrumentFromTicker(ticker, ticker.metadata.ticker);
    if (!instrument) return [];
    return [{
      ticker,
      request: {
        instrument,
        bufferRange: "1Y" as const,
        granularity: "range" as const,
      },
    }];
  });
}

export function buildPortfolioReturnSeries({
  chartTargets,
  chartEntries,
  financials,
  columnContext,
}: {
  chartTargets: PortfolioChartTarget[];
  chartEntries: ChartEntryLookup;
  financials: Map<string, TickerFinancials>;
  columnContext: ColumnContext;
}): DatedReturn[] | null {
  const weightedSeries: WeightedReturnSeries[] = [];
  for (const { ticker, request } of chartTargets) {
    const key = buildChartKey(request);
    const entry = chartEntries.get(key);
    const history = entry?.data ?? entry?.lastGoodData ?? null;
    if (!history || history.length < 11) continue;

    const returns = computeDatedReturns(history);
    if (returns.length < 10) continue;

    const value = getPortfolioPositionValue(ticker, financials.get(ticker.metadata.ticker), columnContext);
    if (value == null) continue;
    weightedSeries.push({ weight: value, returns });
  }

  const returns = computeWeightedPortfolioReturns(weightedSeries);
  return returns.length > 0 ? returns : null;
}

export function buildBenchmarkReturnSeries(
  request: ChartRequest,
  chartEntries: ChartEntryLookup,
): DatedReturn[] | null {
  const entry = chartEntries.get(buildChartKey(request));
  const history = entry?.data ?? entry?.lastGoodData ?? null;
  if (!history || history.length < 11) return null;
  const returns = computeDatedReturns(history);
  return returns.length > 0 ? returns : null;
}

export function buildAnalyticsSummaryRows({
  accountState,
  brokerPerformance,
  portfolioStats,
}: {
  accountState: ResolvedPortfolioAccountState | null;
  activePortfolio: Portfolio | null;
  brokerPerformance: BrokerPortfolioPerformance | null;
  portfolioStats: PortfolioSummaryTotals;
}): AnalyticsMetricRow[] {
  const rows: AnalyticsMetricRow[] = [];
  const account = accountState?.account;
  const accountMetrics = resolvePortfolioAccountMetrics(portfolioStats, account);
  const accountFreshness = formatAccountFreshness(account);
  const totalMarketValue = resolvePortfolioMarketValue(portfolioStats, account);

  if (account?.netLiquidation != null) {
    rows.push({
      id: "net-liquidation",
      label: "Net Liq",
      value: formatCompact(account.netLiquidation),
      color: colors.text,
    });
  }

  rows.push({
    id: "total-value",
    label: "Val",
    value: formatCompact(totalMarketValue),
    color: colors.text,
  });

  const marginLeverage = formatMarginLeverage(account?.netLiquidation, totalMarketValue);
  if (marginLeverage) {
    rows.push({
      id: "margin-leverage",
      label: "Margin Lev",
      value: marginLeverage,
      color: colors.text,
    });
  }

  if (account?.totalCashValue != null) {
    rows.push({
      id: "cash",
      label: "Cash",
      value: formatCompact(account.totalCashValue),
      color: colors.text,
    });
  }

  rows.push({
    id: "day-pnl",
    label: "Day",
    value: formatSignedCompact(accountMetrics.dailyPnl),
    detail: `(${formatPercentRaw(accountMetrics.dailyPnlPct)})`,
    color: priceColor(accountMetrics.dailyPnl),
  });
  rows.push({
    id: "pnl",
    label: "P&L",
    value: formatSignedCompact(accountMetrics.unrealizedPnl),
    detail: `(${formatPercentRaw(accountMetrics.unrealizedPnlPct)})`,
    color: priceColor(accountMetrics.unrealizedPnl),
  });
  if (accountMetrics.realizedPnl != null) {
    rows.push({
      id: "realized-pnl",
      label: "Realized",
      value: formatSignedCompact(accountMetrics.realizedPnl),
      color: priceColor(accountMetrics.realizedPnl),
    });
  }

  const latestPerformancePoint = brokerPerformance?.points.at(-1);
  if (latestPerformancePoint?.cumulativeReturn != null) {
    rows.push({
      id: "historical-return",
      label: "Hist Ret",
      value: formatReturn(latestPerformancePoint.cumulativeReturn),
      detail: brokerPerformance?.period,
      color: priceColor(latestPerformancePoint.cumulativeReturn),
    });
  }

  if (account?.settledCash != null) {
    rows.push({
      id: "settled-cash",
      label: "Settled",
      value: formatCompact(account.settledCash),
      color: colors.text,
    });
  }
  if (account?.availableFunds != null) {
    rows.push({
      id: "available-funds",
      label: "Avail",
      value: formatCompact(account.availableFunds),
      color: colors.text,
    });
  }
  if (account?.excessLiquidity != null) {
    rows.push({
      id: "excess-liquidity",
      label: "Excess",
      value: formatCompact(account.excessLiquidity),
      color: colors.text,
    });
  }
  if (account?.buyingPower != null) {
    rows.push({
      id: "buying-power",
      label: "BP",
      value: formatCompact(account.buyingPower),
      color: colors.text,
    });
  }
  if (accountState) {
    if (accountFreshness) {
      rows.push({
        id: "account-freshness",
        label: "As Of",
        value: accountFreshness,
        color: colors.textDim,
      });
    }
    rows.push({
      id: "account-source",
      label: "Source",
      value: accountState.sourceLabel,
      color: colors.textDim,
    });
  }

  return rows;
}

export function buildAnalyticsRiskRows({
  sharpe,
  beta,
}: {
  sharpe: number | null;
  beta: number | null;
}): AnalyticsMetricRow[] {
  return [
    sharpe !== null
      ? {
        id: "sharpe",
        label: "Sharpe Ratio",
        value: formatNumber(sharpe, 2),
        detail: sharpeLabel(sharpe),
        color: sharpeColor(sharpe),
      }
      : {
        id: "sharpe",
        label: "Sharpe Ratio",
        value: "—",
        detail: "insufficient data",
        color: colors.textMuted,
      },
    beta !== null
      ? {
        id: "beta",
        label: "Beta (SPY)",
        value: formatNumber(beta, 2),
        detail: betaLabel(beta),
        color: betaColor(beta),
      }
      : {
        id: "beta",
        label: "Beta (SPY)",
        value: "—",
        detail: "insufficient data",
        color: colors.textMuted,
      },
  ];
}

export function resolvePerformancePalette(
  performance: BrokerPortfolioPerformance | null,
): ReturnType<typeof resolveChartPalette> {
  const points = performance?.points ?? [];
  const first = points.find((point) => performancePointValue(point) != null);
  const last = [...points].reverse().find((point) => performancePointValue(point) != null);
  const firstValue = first ? performancePointValue(first) : null;
  const lastValue = last ? performancePointValue(last) : null;
  return resolveChartPalette(colors, firstValue != null && lastValue != null && lastValue < firstValue ? "negative" : "positive");
}

export function buildHistoryAxisLabel({
  performance,
  activePortfolio,
  baseCurrency,
}: {
  performance: BrokerPortfolioPerformance | null;
  activePortfolio: Portfolio | null;
  baseCurrency: string;
}): string {
  return performance?.points.some((point) => point.value != null)
    ? `Value (${performance.currency ?? activePortfolio?.currency ?? baseCurrency})`
    : "Return";
}

export function formatHistoryAxisValue(
  value: number,
  performance: BrokerPortfolioPerformance | null,
): string {
  return performance?.points.some((point) => point.value != null)
    ? formatCompact(value)
    : `${(value * 100).toFixed(1)}%`;
}
