import type { ChoiceDialogChoice } from "../../../components";
import type { AccountProfile, PublicPortfolioAnalytics } from "../../../api-client";
import { calculatePortfolioSummaryTotals } from "../portfolio-list/metrics";
import { resolvePortfolioAccountMetrics, resolvePortfolioMarketValue } from "../portfolio-list/account-metrics";
import type { ResolvedPortfolioAccountState } from "../portfolio-list/summary";
import type { AppConfig } from "../../../types/config";
import type { TickerFinancials } from "../../../types/financials";
import type { Portfolio, TickerRecord } from "../../../types/ticker";
import { formatCompact, formatNumber, formatPercentRaw } from "../../../utils/format";

export type AccountFieldKey =
  | "username"
  | "name"
  | "company"
  | "title"
  | "bio"
  | "profilePublic"
  | "publicEmail"
  | "xAccount"
  | "acceptUnknownDms"
  | "sharedPortfolioId"
  | "syncEnabled"
  | "weeklyRoundupEnabled"
  | "positionAlertsEnabled"
  | "emailAlertsOffAction"
  | "passwordAction";

export interface AccountDraft {
  username: string;
  name: string;
  company: string;
  title: string;
  bio: string;
  profilePublic: boolean;
  publicEmail: string;
  xAccount: string;
  sharedPortfolioId: string;
  acceptUnknownDms: boolean;
  syncEnabled: boolean;
  weeklyRoundupEnabled: boolean;
  positionAlertsEnabled: boolean;
}

export interface ProfileAnalyticsPreviewMetric {
  id: string;
  label: string;
  value: string;
  detail?: string;
  tone?: "positive" | "negative" | "muted";
}

export interface ProfileAnalyticsPreview {
  status: "off" | "missing" | "empty" | "ready";
  title: string;
  subtitle: string;
  metrics: ProfileAnalyticsPreviewMetric[];
  publicAnalytics: PublicPortfolioAnalytics | null;
}

export const BASE_FIELD_ORDER: AccountFieldKey[] = [
  "username",
  "name",
  "company",
  "title",
  "bio",
  "profilePublic",
  "publicEmail",
  "xAccount",
  "acceptUnknownDms",
  "sharedPortfolioId",
  "syncEnabled",
  "weeklyRoundupEnabled",
  "positionAlertsEnabled",
  "emailAlertsOffAction",
  "passwordAction",
];

export const NO_PORTFOLIO_VALUE = "__none__";

export function profileToDraft(profile: AccountProfile | null): AccountDraft {
  return {
    username: profile?.username ?? "",
    name: profile?.name ?? "",
    company: profile?.company ?? "",
    title: profile?.title ?? "",
    bio: profile?.bio ?? "",
    profilePublic: profile?.profilePublic === true,
    publicEmail: profile?.publicEmail ?? "",
    xAccount: profile?.xAccount ?? "",
    sharedPortfolioId: profile?.sharedPortfolioId ?? "",
    acceptUnknownDms: profile?.acceptUnknownDms === true,
    syncEnabled: profile?.syncEnabled === false ? false : true,
    weeklyRoundupEnabled: profile?.weeklyRoundupEnabled === false ? false : true,
    positionAlertsEnabled: profile?.positionAlertsEnabled === false ? false : true,
  };
}

export function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function truncate(value: string, width: number): string {
  if (width <= 0) return "";
  if (value.length <= width) return value;
  if (width <= 3) return value.slice(0, width);
  return `${value.slice(0, width - 3)}...`;
}

export function formatPlan(plan: AccountProfile["plan"] | null | undefined): string {
  return plan === "pro" ? "Pro" : "Free";
}

export function countPortfolioHoldings(tickers: ReadonlyMap<string, TickerRecord>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of tickers.values()) {
    for (const portfolioId of record.metadata.portfolios) {
      counts[portfolioId] = (counts[portfolioId] ?? 0) + 1;
    }
  }
  return counts;
}

export function buildPortfolioChoices(portfolios: Portfolio[], holdingCounts: Record<string, number>): ChoiceDialogChoice[] {
  return [
    { id: NO_PORTFOLIO_VALUE, label: "None", detail: "Off", description: "Do not show portfolio analytics on your public profile." },
    ...portfolios.map((portfolio) => ({
      id: portfolio.id,
      label: portfolio.name,
      detail: `${holdingCounts[portfolio.id] ?? 0} tickers`,
      description: "Shares this portfolio's 1Y return and SPY Beta on your public profile.",
    })),
  ];
}

export function portfolioOptionIds(portfolios: Portfolio[]): string[] {
  return [NO_PORTFOLIO_VALUE, ...portfolios.map((portfolio) => portfolio.id)];
}

export function selectedPortfolioLabel(portfolios: Portfolio[], value: string): string {
  if (!value) return "None";
  return portfolios.find((portfolio) => portfolio.id === value)?.name ?? value;
}

function signedCompact(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatCompact(value)}`;
}

function signedReturn(value: number): string {
  const percent = value * 100;
  return `${percent >= 0 ? "+" : ""}${formatNumber(percent, 2)}%`;
}

function signedTone(value: number | null | undefined): ProfileAnalyticsPreviewMetric["tone"] {
  if (value == null || !Number.isFinite(value)) return "muted";
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "muted";
}

function finiteMetric(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function getPortfolioPositionTickers(
  tickers: ReadonlyMap<string, TickerRecord>,
  portfolioId: string,
): TickerRecord[] {
  return [...tickers.values()].filter((ticker) => (
    ticker.metadata.positions.some((position) => position.portfolio === portfolioId)
  ));
}

export function computeCumulativeReturn(
  returns: Array<{ dateKey: string; value: number }>,
  options?: { sinceDateKey?: string },
): number | null {
  const filtered = options?.sinceDateKey
    ? returns.filter((point) => point.dateKey >= options.sinceDateKey!)
    : returns;
  if (filtered.length === 0) return null;
  const value = filtered.reduce((acc, point) => (
    Number.isFinite(point.value) ? acc * (1 + point.value) : acc
  ), 1) - 1;
  return Number.isFinite(value) ? value : null;
}

export function buildProfileAnalyticsPreview({
  accountState,
  baseCurrency,
  beta,
  config,
  exchangeRates,
  financials,
  portfolio,
  portfolioTickers,
  selectedPortfolioId,
  oneYearReturn,
}: {
  accountState: ResolvedPortfolioAccountState | null;
  baseCurrency: string;
  beta: number | null;
  config: AppConfig;
  exchangeRates: Map<string, number>;
  financials: Map<string, TickerFinancials>;
  portfolio: Portfolio | null;
  portfolioTickers: TickerRecord[];
  selectedPortfolioId: string;
  oneYearReturn: number | null;
}): ProfileAnalyticsPreview {
  if (!selectedPortfolioId) {
    return {
      status: "off",
      title: "No public portfolio analytics",
      subtitle: "Choose a portfolio to preview the public profile metrics.",
      metrics: [],
      publicAnalytics: null,
    };
  }

  if (!portfolio) {
    return {
      status: "missing",
      title: "Portfolio not found",
      subtitle: selectedPortfolioId,
      metrics: [],
      publicAnalytics: null,
    };
  }

  if (portfolioTickers.length === 0) {
    return {
      status: "empty",
      title: portfolio.name,
      subtitle: "No positions to preview yet.",
      metrics: [],
      publicAnalytics: null,
    };
  }

  const totals = calculatePortfolioSummaryTotals(
    portfolioTickers,
    financials,
    baseCurrency,
    exchangeRates,
    true,
    portfolio.id,
  );
  const accountMetrics = resolvePortfolioAccountMetrics(totals, accountState?.account);
  const marketValue = resolvePortfolioMarketValue(totals, accountState?.account);
  const currency = portfolio.currency || config.baseCurrency;
  const sourceLabel = accountState?.sourceLabel ?? null;
  const publicAnalytics: PublicPortfolioAnalytics = {
    portfolioName: portfolio.name,
    holdingsCount: portfolioTickers.length,
    oneYearReturn: finiteMetric(oneYearReturn),
    spyBeta: finiteMetric(beta),
    marketValue: finiteMetric(marketValue),
    currency,
    sourceLabel,
    asOf: new Date().toISOString(),
  };

  return {
    status: "ready",
    title: portfolio.name,
    subtitle: `${portfolioTickers.length} holdings${sourceLabel ? ` · ${sourceLabel}` : ""}`,
    publicAnalytics,
    metrics: [
      {
        id: "one-year",
        label: "1Y",
        value: oneYearReturn == null ? "Pending" : signedReturn(oneYearReturn),
        detail: oneYearReturn == null ? "needs price history" : undefined,
        tone: signedTone(oneYearReturn),
      },
      {
        id: "beta",
        label: "SPY Beta",
        value: beta == null ? "Pending" : formatNumber(beta, 2),
        detail: beta == null ? "needs SPY overlap" : undefined,
        tone: beta == null ? "muted" : undefined,
      },
      {
        id: "value",
        label: "Value",
        value: `${formatCompact(marketValue)} ${currency}`,
      },
      {
        id: "day",
        label: "Day",
        value: signedCompact(accountMetrics.dailyPnl),
        detail: formatPercentRaw(accountMetrics.dailyPnlPct),
        tone: signedTone(accountMetrics.dailyPnl),
      },
      {
        id: "pnl",
        label: "P&L",
        value: signedCompact(accountMetrics.unrealizedPnl),
        detail: formatPercentRaw(accountMetrics.unrealizedPnlPct),
        tone: signedTone(accountMetrics.unrealizedPnl),
      },
    ],
  };
}
