import type { BrokerAccount } from "../../../types/trading";
import type { PortfolioSummaryTotals } from "./metrics";

export interface PortfolioAccountMetrics {
  dailyPnl: number;
  dailyPnlPct: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  realizedPnl?: number;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function percentChange(value: number, previousValue: number): number {
  return previousValue !== 0 ? (value / previousValue) * 100 : 0;
}

export function resolvePortfolioAccountMetrics(
  totals: PortfolioSummaryTotals,
  account?: BrokerAccount | null,
): PortfolioAccountMetrics {
  const brokerDailyPnl = finiteNumber(account?.dailyPnl) ? account.dailyPnl : null;
  const dailyPnl = brokerDailyPnl ?? totals.dailyPnl;
  const previousNetLiquidation = brokerDailyPnl != null && finiteNumber(account?.netLiquidation)
    ? account.netLiquidation - dailyPnl
    : null;
  const dailyPnlPct = previousNetLiquidation != null
    ? percentChange(dailyPnl, previousNetLiquidation)
    : totals.dailyPnlPct;

  const brokerUnrealizedPnl = finiteNumber(account?.unrealizedPnl) ? account.unrealizedPnl : null;
  const unrealizedPnl = brokerUnrealizedPnl ?? totals.unrealizedPnl;
  const unrealizedPnlPct = totals.totalCostBasis !== 0
    ? percentChange(unrealizedPnl, totals.totalCostBasis)
    : totals.unrealizedPnlPct;

  return {
    dailyPnl,
    dailyPnlPct,
    unrealizedPnl,
    unrealizedPnlPct,
    realizedPnl: finiteNumber(account?.realizedPnl) ? account.realizedPnl : undefined,
  };
}
