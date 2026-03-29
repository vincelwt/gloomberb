import { useState, useMemo, useRef, useEffect, useCallback, useSyncExternalStore } from "react";
import { useKeyboard } from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { TextAttributes } from "@opentui/core";
import { EmptyState } from "../../components";
import { TabBar } from "../../components/tab-bar";
import type { GloomPlugin, PaneProps } from "../../types/plugin";
import { getSharedRegistry } from "../../plugins/registry";
import {
  useAppState,
  usePaneCollection,
  usePaneInstanceId,
  usePaneStateValue,
  type CollectionSortPreference,
} from "../../state/app-context";
import { getAllCollections, getCollectionTickers, getCollectionType } from "../../state/selectors";
import { colors, priceColor, hoverBg } from "../../theme/colors";
import { formatCurrency, formatPercentRaw, formatCompact, formatNumber, padTo, convertCurrency } from "../../utils/format";
import type { ColumnConfig } from "../../types/config";
import type { TickerRecord, Portfolio } from "../../types/ticker";
import type { TickerFinancials } from "../../types/financials";
import type { BrokerAccount, BrokerCashBalance } from "../../types/trading";
import { getBrokerInstance } from "../../utils/broker-instances";
import { formatOptionTicker } from "../../utils/options";
import { ibkrGatewayManager } from "../ibkr/gateway-service";

interface ColumnContext {
  activeTab?: string;
  baseCurrency: string;
  exchangeRates: Map<string, number>;
  now: number;
}

function getColumnValue(
  col: ColumnConfig,
  ticker: TickerRecord,
  financials: TickerFinancials | undefined,
  ctx: ColumnContext,
): { text: string; color?: string } {
  const q = financials?.quote;
  const f = financials?.fundamentals;
  const quoteCurrency = q?.currency || ticker.metadata.currency || "USD";

  const toBase = (v: number) =>
    convertCurrency(v, quoteCurrency, ctx.baseCurrency, ctx.exchangeRates);

  // Helper to get positions relevant to the active portfolio tab
  const tabPositions = ctx.activeTab
    ? ticker.metadata.positions.filter((p) => p.portfolio === ctx.activeTab)
    : ticker.metadata.positions;
  const totalShares = tabPositions.reduce((sum, p) => sum + p.shares * (p.side === "short" ? -1 : 1), 0);
  const totalCost = tabPositions.reduce(
    (sum, p) => sum + p.shares * p.avgCost * (p.multiplier || 1),
    0,
  );

  // For options without Yahoo quotes, use broker-provided position data
  const isOption = ticker.metadata.assetCategory === "OPT";
  const brokerMktValue = tabPositions.reduce(
    (sum, p) => sum + (p.marketValue || 0),
    0,
  );
  const brokerPnl = tabPositions.reduce(
    (sum, p) => sum + (p.unrealizedPnl || 0),
    0,
  );
  const brokerMarkPrice = tabPositions.length === 1 ? tabPositions[0]?.markPrice : undefined;

  switch (col.id) {
    case "ticker": {
      const mkt = q?.marketState;
      const statusDot = mkt === "REGULAR" ? "\u25CF" : "\u25CB";
      const displayName = isOption
        ? formatOptionTicker(ticker.metadata.ticker)
        : ticker.metadata.ticker;
      return { text: `${statusDot} ${displayName}` };
    }
    case "price": {
      if (q) {
        const converted = toBase(q.price);
        return {
          text: formatCurrency(converted, ctx.baseCurrency),
          color: priceColor(q.change),
        };
      }
      if (isOption && brokerMarkPrice != null) {
        return { text: formatCurrency(toBase(brokerMarkPrice), ctx.baseCurrency) };
      }
      return { text: "—" };
    }
    case "change": {
      if (!q) return { text: "—" };
      const converted = toBase(q.change);
      return {
        text: (converted >= 0 ? "+" : "") + converted.toFixed(2),
        color: priceColor(q.change),
      };
    }
    case "change_pct": {
      // During pre/post market, show extended-hours change instead
      if (q?.marketState === "PRE" && q.preMarketPrice != null) {
        const chg = q.preMarketChangePercent ?? 0;
        return { text: formatPercentRaw(chg), color: priceColor(chg) };
      }
      if (q?.marketState === "POST" && q.postMarketPrice != null) {
        const chg = q.postMarketChangePercent ?? 0;
        return { text: formatPercentRaw(chg), color: priceColor(chg) };
      }
      return {
        text: q ? formatPercentRaw(q.changePercent) : "—",
        color: q ? priceColor(q.changePercent) : undefined,
      };
    }
    case "market_cap": {
      if (!q?.marketCap) return { text: "—" };
      return { text: formatCompact(toBase(q.marketCap)) };
    }
    case "pe":
      return { text: f?.trailingPE ? formatNumber(f.trailingPE, 1) : "—" };
    case "forward_pe":
      return { text: f?.forwardPE ? formatNumber(f.forwardPE, 1) : "—" };
    case "dividend_yield":
      return {
        text: f?.dividendYield != null ? (f.dividendYield * 100).toFixed(2) + "%" : "—",
      };
    case "ext_hours": {
      if (q?.marketState === "PRE" && q.preMarketPrice != null) {
        const chg = q.preMarketChangePercent ?? 0;
        return { text: formatPercentRaw(chg), color: priceColor(chg) };
      }
      if (q?.marketState === "POST" && q.postMarketPrice != null) {
        const chg = q.postMarketChangePercent ?? 0;
        return { text: formatPercentRaw(chg), color: priceColor(chg) };
      }
      return { text: "—" };
    }
    case "shares":
      return { text: totalShares !== 0 ? formatCompact(totalShares) : "—" };
    case "avg_cost": {
      if (totalShares === 0) return { text: "—" };
      const avgCost = totalCost / Math.abs(totalShares);
      return { text: formatCurrency(toBase(avgCost), ctx.baseCurrency) };
    }
    case "cost_basis": {
      if (totalCost === 0) return { text: "—" };
      return { text: formatCompact(toBase(totalCost)) };
    }
    case "mkt_value": {
      if (q && totalShares !== 0) {
        const mv = Math.abs(totalShares) * q.price;
        return { text: formatCompact(toBase(mv)) };
      }
      if (isOption && brokerMktValue !== 0) {
        return { text: formatCompact(toBase(brokerMktValue)) };
      }
      return { text: "—" };
    }
    case "pnl": {
      if (q && totalShares !== 0) {
        const mv = Math.abs(totalShares) * q.price;
        const pnl = toBase(mv - totalCost);
        return { text: (pnl >= 0 ? "+" : "") + formatCompact(pnl), color: priceColor(pnl) };
      }
      if (isOption && brokerPnl !== 0) {
        const pnl = toBase(brokerPnl);
        return { text: (pnl >= 0 ? "+" : "") + formatCompact(pnl), color: priceColor(pnl) };
      }
      return { text: "—" };
    }
    case "pnl_pct": {
      if (q && totalCost !== 0) {
        const mv = Math.abs(totalShares) * q.price;
        const pct = ((mv - totalCost) / totalCost) * 100;
        return { text: formatPercentRaw(pct), color: priceColor(pct) };
      }
      if (isOption && brokerPnl !== 0 && totalCost !== 0) {
        const pct = (brokerPnl / totalCost) * 100;
        return { text: formatPercentRaw(pct), color: priceColor(pct) };
      }
      return { text: "—" };
    }
    case "latency": {
      if (!q?.lastUpdated) return { text: "—" };
      const ago = (ctx.now - q.lastUpdated) / 1000;
      // ◷ = delayed broker data, ◌ = Yahoo fallback, no prefix = live
      const prefix = q.dataSource === "delayed" ? "◷" : q.dataSource === "yahoo" ? "◌" : "";
      let age: string;
      if (ago < 60) age = `${Math.floor(ago)}s`;
      else if (ago < 3600) age = `${Math.floor(ago / 60)}m`;
      else if (ago < 86400) age = `${Math.floor(ago / 3600)}h`;
      else age = `${Math.floor(ago / 86400)}d`;
      return { text: prefix ? `${prefix}${age}` : age };
    }
    default:
      return { text: "—" };
  }
}

/** Extract a numeric sort value for a column (returns null for "—" values) */
function getSortValue(
  col: ColumnConfig,
  ticker: TickerRecord,
  financials: TickerFinancials | undefined,
  ctx: ColumnContext,
): number | string | null {
  const q = financials?.quote;
  const f = financials?.fundamentals;
  const quoteCurrency = q?.currency || ticker.metadata.currency || "USD";
  const toBase = (v: number) =>
    convertCurrency(v, quoteCurrency, ctx.baseCurrency, ctx.exchangeRates);

  const tabPositions = ctx.activeTab
    ? ticker.metadata.positions.filter((p) => p.portfolio === ctx.activeTab)
    : ticker.metadata.positions;
  const totalShares = tabPositions.reduce((sum, p) => sum + p.shares * (p.side === "short" ? -1 : 1), 0);
  const totalCost = tabPositions.reduce(
    (sum, p) => sum + p.shares * p.avgCost * (p.multiplier || 1),
    0,
  );

  const isOption = ticker.metadata.assetCategory === "OPT";
  const brokerMktValue = tabPositions.reduce((sum, p) => sum + (p.marketValue || 0), 0);
  const brokerPnl = tabPositions.reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0);
  const brokerMarkPrice = tabPositions.length === 1 ? tabPositions[0]?.markPrice : undefined;

  switch (col.id) {
    case "ticker":
      return ticker.metadata.ticker;
    case "price":
      if (q) return toBase(q.price);
      if (isOption && brokerMarkPrice != null) return toBase(brokerMarkPrice);
      return null;
    case "change":
      return q ? toBase(q.change) : null;
    case "change_pct": {
      if (q?.marketState === "PRE" && q.preMarketPrice != null) return q.preMarketChangePercent ?? 0;
      if (q?.marketState === "POST" && q.postMarketPrice != null) return q.postMarketChangePercent ?? 0;
      return q?.changePercent ?? null;
    }
    case "market_cap":
      return q?.marketCap ? toBase(q.marketCap) : null;
    case "pe":
      return f?.trailingPE ?? null;
    case "forward_pe":
      return f?.forwardPE ?? null;
    case "dividend_yield":
      return f?.dividendYield ?? null;
    case "ext_hours": {
      if (q?.marketState === "PRE" && q.preMarketPrice != null) return q.preMarketChangePercent ?? 0;
      if (q?.marketState === "POST" && q.postMarketPrice != null) return q.postMarketChangePercent ?? 0;
      return null;
    }
    case "shares":
      return totalShares !== 0 ? totalShares : null;
    case "avg_cost":
      return totalShares !== 0 ? toBase(totalCost / Math.abs(totalShares)) : null;
    case "cost_basis":
      return totalCost !== 0 ? toBase(totalCost) : null;
    case "mkt_value": {
      if (q && totalShares !== 0) return toBase(Math.abs(totalShares) * q.price);
      if (isOption && brokerMktValue !== 0) return toBase(brokerMktValue);
      return null;
    }
    case "pnl": {
      if (q && totalShares !== 0) {
        const mv = Math.abs(totalShares) * q.price;
        return toBase(mv - totalCost);
      }
      if (isOption && brokerPnl !== 0) return toBase(brokerPnl);
      return null;
    }
    case "pnl_pct": {
      if (q && totalCost !== 0) {
        const mv = Math.abs(totalShares) * q.price;
        return ((mv - totalCost) / totalCost) * 100;
      }
      if (isOption && brokerPnl !== 0 && totalCost !== 0) return (brokerPnl / totalCost) * 100;
      return null;
    }
    case "latency":
      return q?.lastUpdated ?? null;
    default:
      return null;
  }
}

/** Position-specific columns appended when viewing a portfolio */
const POSITION_COLUMNS: ColumnConfig[] = [
  { id: "shares", label: "SHARES", width: 9, align: "right", format: "number" },
  { id: "avg_cost", label: "AVG COST", width: 10, align: "right", format: "currency" },
  { id: "mkt_value", label: "MKT VAL", width: 10, align: "right", format: "compact" },
  { id: "pnl", label: "P&L", width: 10, align: "right", format: "compact" },
  { id: "pnl_pct", label: "P&L%", width: 8, align: "right", format: "percent" },
];

const EMPTY_SORT_PREFERENCE: CollectionSortPreference = {
  columnId: null,
  direction: "asc",
};

const DEFAULT_PORTFOLIO_SORT_PREFERENCE: CollectionSortPreference = {
  columnId: "mkt_value",
  direction: "desc",
};

export function resolveCollectionSortPreference(
  collectionId: string | null,
  isPortfolio: boolean,
  collectionSorts: Record<string, CollectionSortPreference>,
): CollectionSortPreference {
  if (!collectionId) return EMPTY_SORT_PREFERENCE;
  return collectionSorts[collectionId] ?? (isPortfolio ? DEFAULT_PORTFOLIO_SORT_PREFERENCE : EMPTY_SORT_PREFERENCE);
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

export interface PortfolioSummarySegment {
  id: string;
  parts: Array<{
    text: string;
    tone: "label" | "value" | "muted";
    color?: string;
    bold?: boolean;
  }>;
  length: number;
}

export interface PortfolioSummaryAccountState {
  account: BrokerAccount;
  sourceLabel: string;
}

interface ResolvedPortfolioAccountState extends PortfolioSummaryAccountState {
  sourceKind: "live" | "cached" | "flex";
  visibleCashBalances: BrokerCashBalance[];
}

function createSummarySegment(
  id: string,
  parts: PortfolioSummarySegment["parts"],
): PortfolioSummarySegment {
  return {
    id,
    parts,
    length: parts.reduce((sum, part) => sum + part.text.length, 0) + Math.max(0, parts.length - 1),
  };
}

function fitSummarySegments(candidates: PortfolioSummarySegment[], widthBudget: number): PortfolioSummarySegment[] {
  const fitted: PortfolioSummarySegment[] = [];
  let used = 0;
  for (const segment of candidates) {
    const nextUsed = used + (fitted.length > 0 ? 2 : 0) + segment.length;
    if (fitted.length > 0 && nextUsed > widthBudget) break;
    fitted.push(segment);
    used = nextUsed;
  }
  return fitted;
}

function formatSourceBadge(account: BrokerAccount, liveGateway: boolean): { label: string; kind: "live" | "cached" | "flex" } {
  if (liveGateway) {
    return { label: "Live", kind: "live" };
  }
  if (account.source === "flex") {
    return {
      label: account.updatedAt
        ? `Flex ${new Date(account.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
        : "Flex",
      kind: "flex",
    };
  }
  return { label: "Cached", kind: "cached" };
}

function getVisibleCashBalances(cashBalances: BrokerCashBalance[] | undefined): BrokerCashBalance[] {
  if (!cashBalances) return [];
  return cashBalances
    .filter((balance) => {
      const quantity = Math.abs(balance.quantity);
      const baseValue = Math.abs(balance.baseValue ?? 0);
      return quantity > 1e-9 || baseValue > 1e-9;
    })
    .sort((left, right) => {
      const leftValue = Math.abs(left.baseValue ?? left.quantity);
      const rightValue = Math.abs(right.baseValue ?? right.quantity);
      return rightValue - leftValue;
    });
}

function findPortfolioAccount(
  accounts: BrokerAccount[],
  portfolio: Portfolio,
): BrokerAccount | undefined {
  if (accounts.length === 0) return undefined;

  const accountId = portfolio.brokerAccountId?.trim();
  const portfolioName = portfolio.name.trim();
  const collectionAccountId = portfolio.id.split(":").pop()?.trim();

  return accounts.find((account) => account.accountId === accountId)
    ?? accounts.find((account) => account.accountId === portfolioName || account.name === portfolioName)
    ?? accounts.find((account) => account.accountId === collectionAccountId || account.name === collectionAccountId)
    ?? (accounts.length === 1 ? accounts[0] : undefined);
}

function resolvePortfolioAccountState(
  portfolio: Portfolio | null,
  state: ReturnType<typeof useAppState>["state"],
  liveSnapshot: ReturnType<typeof ibkrGatewayManager.getSnapshot>,
): ResolvedPortfolioAccountState | null {
  if (!portfolio?.brokerInstanceId) return null;

  const brokerInstance = getBrokerInstance(state.config.brokerInstances, portfolio.brokerInstanceId);
  const cachedAccounts = state.brokerAccounts[portfolio.brokerInstanceId] ?? [];
  const cachedAccount = findPortfolioAccount(cachedAccounts, portfolio);

  const liveAccount = brokerInstance?.brokerType === "ibkr"
    && brokerInstance.connectionMode === "gateway"
    && liveSnapshot.status.state === "connected"
    ? findPortfolioAccount(liveSnapshot.accounts, portfolio)
    : undefined;

  const account = liveAccount ?? cachedAccount;
  if (!account) return null;

  const source = formatSourceBadge(account, !!liveAccount);
  return {
    account,
    sourceLabel: source.label,
    sourceKind: source.kind,
    visibleCashBalances: getVisibleCashBalances(account.cashBalances),
  };
}

function calculatePortfolioSummaryTotals(
  tickers: TickerRecord[],
  state: ReturnType<typeof useAppState>["state"],
  isPortfolio: boolean,
  collectionId: string | null,
): PortfolioSummaryTotals {
  const baseCurrency = state.config.baseCurrency;
  const exchangeRates = state.exchangeRates;
  let totalMktValue = 0;
  let totalPrevValue = 0;
  let totalCostBasis = 0;
  let hasPositions = false;
  let watchlistChangeSum = 0;
  let watchlistCount = 0;

  for (const ticker of tickers) {
    const fin = state.financials.get(ticker.metadata.ticker);
    const q = fin?.quote;
    const quoteCurrency = q?.currency || ticker.metadata.currency || "USD";
    const toBase = (value: number) => convertCurrency(value, quoteCurrency, baseCurrency, exchangeRates);

    if (!isPortfolio) {
      if (q?.changePercent != null) {
        watchlistChangeSum += q.changePercent;
        watchlistCount++;
      }
      continue;
    }

    const tabPositions = collectionId
      ? ticker.metadata.positions.filter((position) => position.portfolio === collectionId)
      : ticker.metadata.positions;
    const totalShares = tabPositions.reduce((sum, position) => sum + position.shares * (position.side === "short" ? -1 : 1), 0);
    const totalCost = tabPositions.reduce(
      (sum, position) => sum + position.shares * position.avgCost * (position.multiplier || 1),
      0,
    );

    const isOption = ticker.metadata.assetCategory === "OPT";
    const brokerMktValue = tabPositions.reduce((sum, position) => sum + (position.marketValue || 0), 0);

    if (q && totalShares !== 0) {
      hasPositions = true;
      const marketValue = Math.abs(totalShares) * q.price;
      totalMktValue += toBase(marketValue);
      const prevClose = q.previousClose || (q.price - q.change);
      totalPrevValue += toBase(Math.abs(totalShares) * prevClose);
      totalCostBasis += toBase(totalCost);
    } else if (isOption && brokerMktValue !== 0) {
      hasPositions = true;
      totalMktValue += toBase(brokerMktValue);
      totalCostBasis += toBase(totalCost);
      totalPrevValue += toBase(brokerMktValue);
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

export function buildPortfolioSummarySegments({
  totals,
  accountState,
  widthBudget,
  refreshText,
}: {
  totals: PortfolioSummaryTotals;
  accountState: PortfolioSummaryAccountState | null;
  widthBudget: number;
  refreshText?: string;
}): PortfolioSummarySegment[] {
  const candidates: PortfolioSummarySegment[] = [
    createSummarySegment("val", [
      { text: "Val", tone: "label" },
      { text: formatCompact(totals.totalMktValue), tone: "value", bold: true },
    ]),
  ];

  if (accountState) {
    const { account, sourceLabel } = accountState;
    if (account.totalCashValue != null) {
      candidates.push(createSummarySegment("cash", [
        { text: "Cash", tone: "label" },
        { text: formatCompact(account.totalCashValue), tone: "value", bold: true },
      ]));
    }
  }

  candidates.push(createSummarySegment("day", [
    { text: "Day", tone: "label" },
    { text: `${totals.dailyPnl >= 0 ? "+" : ""}${formatCompact(totals.dailyPnl)}`, tone: "value", color: priceColor(totals.dailyPnl), bold: true },
    { text: `(${formatPercentRaw(totals.dailyPnlPct)})`, tone: "muted", color: priceColor(totals.dailyPnlPct) },
  ]));
  candidates.push(createSummarySegment("pnl", [
    { text: "P&L", tone: "label" },
    { text: `${totals.unrealizedPnl >= 0 ? "+" : ""}${formatCompact(totals.unrealizedPnl)}`, tone: "value", color: priceColor(totals.unrealizedPnl), bold: true },
    { text: `(${formatPercentRaw(totals.unrealizedPnlPct)})`, tone: "muted", color: priceColor(totals.unrealizedPnlPct) },
  ]));

  if (accountState) {
    const { account, sourceLabel } = accountState;
    const brokerSegments = [
      account.settledCash != null
        ? createSummarySegment("settled", [
          { text: "Settled", tone: "label" },
          { text: formatCompact(account.settledCash), tone: "value", bold: true },
        ])
        : null,
      account.availableFunds != null
        ? createSummarySegment("avail", [
          { text: "Avail", tone: "label" },
          { text: formatCompact(account.availableFunds), tone: "value", bold: true },
        ])
        : null,
      account.excessLiquidity != null
        ? createSummarySegment("excess", [
          { text: "Excess", tone: "label" },
          { text: formatCompact(account.excessLiquidity), tone: "value", bold: true },
        ])
        : null,
      account.buyingPower != null
        ? createSummarySegment("bp", [
          { text: "BP", tone: "label" },
          { text: formatCompact(account.buyingPower), tone: "value", bold: true },
        ])
        : null,
      createSummarySegment("source", [
        { text: sourceLabel, tone: "muted" },
      ]),
    ].filter((segment): segment is PortfolioSummarySegment => segment != null);

    return fitSummarySegments([...candidates, ...brokerSegments], widthBudget);
  }

  if (refreshText) {
    candidates.push(createSummarySegment("refresh", [
      { text: refreshText, tone: "muted" },
    ]));
  }

  return fitSummarySegments(candidates, widthBudget);
}

export function shouldToggleCashMarginDrawer(key: string | undefined, showCashDrawer: boolean): boolean {
  return key === "c" && showCashDrawer;
}

export function calculatePortfolioSummaryWidth(totalWidth: number, tabLabels: string[]): number {
  const desiredWidth = Math.min(totalWidth, Math.min(72, Math.max(24, Math.floor(totalWidth * 0.55))));
  if (desiredWidth <= 0) return 0;

  const tabRowWidth = tabLabels.reduce((sum, label) => sum + label.length + 4, 0);
  const availableWidth = Math.max(0, totalWidth - tabRowWidth);
  if (availableWidth < Math.min(24, totalWidth)) return 0;

  return Math.min(desiredWidth, availableWidth);
}

function renderSummarySegments(segments: PortfolioSummarySegment[], width: number) {
  if (segments.length === 0) return null;
  return (
    <box flexDirection="row" width={width} justifyContent="flex-start" overflow="hidden">
      {segments.map((segment, segmentIndex) => (
        <box key={segment.id} flexDirection="row">
          {segmentIndex > 0 && <text fg={colors.textDim}>{"  "}</text>}
          {segment.parts.map((part, partIndex) => (
            <box key={`${segment.id}:${partIndex}`} flexDirection="row">
              {partIndex > 0 && <text fg={colors.textDim}>{" "}</text>}
              <text
                fg={part.color ?? (part.tone === "label" || part.tone === "muted" ? colors.textDim : colors.text)}
                attributes={part.bold ? TextAttributes.BOLD : 0}
              >
                {part.text}
              </text>
            </box>
          ))}
        </box>
      ))}
    </box>
  );
}

function buildDrawerMetricSegments(account: BrokerAccount, widthBudget: number): PortfolioSummarySegment[] {
  const candidates = [
    account.totalCashValue != null
      ? createSummarySegment("cash", [{ text: "Cash", tone: "label" }, { text: formatCompact(account.totalCashValue), tone: "value", bold: true }])
      : null,
    account.settledCash != null
      ? createSummarySegment("settled", [{ text: "Settled", tone: "label" }, { text: formatCompact(account.settledCash), tone: "value", bold: true }])
      : null,
    account.netLiquidation != null
      ? createSummarySegment("netliq", [{ text: "Net Liq", tone: "label" }, { text: formatCompact(account.netLiquidation), tone: "value", bold: true }])
      : null,
    account.availableFunds != null
      ? createSummarySegment("avail", [{ text: "Avail", tone: "label" }, { text: formatCompact(account.availableFunds), tone: "value", bold: true }])
      : null,
    account.excessLiquidity != null
      ? createSummarySegment("excess", [{ text: "Excess", tone: "label" }, { text: formatCompact(account.excessLiquidity), tone: "value", bold: true }])
      : null,
    account.buyingPower != null
      ? createSummarySegment("bp", [{ text: "BP", tone: "label" }, { text: formatCompact(account.buyingPower), tone: "value", bold: true }])
      : null,
    account.initMarginReq != null
      ? createSummarySegment("init", [{ text: "Init", tone: "label" }, { text: formatCompact(account.initMarginReq), tone: "value", bold: true }])
      : null,
    account.maintMarginReq != null
      ? createSummarySegment("maint", [{ text: "Maint", tone: "label" }, { text: formatCompact(account.maintMarginReq), tone: "value", bold: true }])
      : null,
  ].filter((segment): segment is PortfolioSummarySegment => segment != null);

  return fitSummarySegments(candidates, widthBudget);
}

function PortfolioCashMarginDrawer({
  accountState,
  expanded,
  onToggle,
  width,
  height,
}: {
  accountState: ResolvedPortfolioAccountState;
  expanded: boolean;
  onToggle: () => void;
  width: number;
  height: number;
}) {
  const previewText = `${accountState.visibleCashBalances.length} ccy · Cash ${formatCompact(accountState.account.totalCashValue)} · ${accountState.sourceLabel}`;
  const drawerHeight = Math.max(1, height);

  if (!expanded) {
    return (
      <box
        width={width}
        height={drawerHeight}
        flexDirection="row"
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onMouseUp={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggle();
        }}
      >
        <text fg={colors.textBright} attributes={TextAttributes.BOLD}>{"▸ Cash & Margin"}</text>
        <box flexGrow={1} />
        <text fg={colors.textDim}>{padTo(previewText, Math.max(0, width - 17), "right")}</text>
      </box>
    );
  }

  const metricSegments = buildDrawerMetricSegments(accountState.account, width);
  const currencyRowsHeight = Math.max(1, drawerHeight - 2);

  return (
    <box flexDirection="column" height={drawerHeight}>
      <box
        width={width}
        height={1}
        flexDirection="row"
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onMouseUp={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggle();
        }}
      >
        <text fg={colors.textBright} attributes={TextAttributes.BOLD}>{"▾ Cash & Margin"}</text>
        <box flexGrow={1} />
        <text fg={colors.textDim}>{accountState.sourceLabel}</text>
      </box>
      <box height={1} overflow="hidden">
        {renderSummarySegments(metricSegments, width)}
      </box>
      <scrollbox height={currencyRowsHeight} scrollY focusable={false}>
        {accountState.visibleCashBalances.length === 0 ? (
          <text fg={colors.textDim}>No non-zero cash balances.</text>
        ) : (
          accountState.visibleCashBalances.map((balance) => (
            <box key={balance.currency} height={1} flexDirection="row">
              <text fg={colors.textBright}>{padTo(balance.currency, 4)}</text>
              <text fg={colors.textDim}>{" qty "}</text>
              <text fg={colors.text}>{padTo(formatNumber(balance.quantity, 2), 14, "right")}</text>
              <text fg={colors.textDim}>{"  value "}</text>
              <text fg={colors.text}>{padTo(balance.baseValue != null ? formatCompact(balance.baseValue) : "—", 10, "right")}</text>
            </box>
          ))
        )}
      </scrollbox>
    </box>
  );
}

function usePortfolioAccountState(
  portfolio: Portfolio | null,
  state: ReturnType<typeof useAppState>["state"],
): ResolvedPortfolioAccountState | null {
  const instanceId = portfolio?.brokerInstanceId;
  const snapshot = useSyncExternalStore(
    (listener) => ibkrGatewayManager.subscribe(instanceId, listener),
    () => ibkrGatewayManager.getSnapshot(instanceId),
  );
  return useMemo(
    () => resolvePortfolioAccountState(portfolio, state, snapshot),
    [portfolio, snapshot, state],
  );
}

function PortfolioSummaryBar({
  tickers,
  state,
  isPortfolio,
  collectionId,
  width,
  accountState,
}: {
  tickers: TickerRecord[];
  state: ReturnType<typeof useAppState>["state"];
  isPortfolio: boolean;
  collectionId: string | null;
  width: number;
  accountState: ResolvedPortfolioAccountState | null;
}) {
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // Track last refresh time — update whenever refreshing set goes from non-empty to empty
  const wasRefreshing = useRef(false);
  useEffect(() => {
    if (state.refreshing.size > 0) {
      wasRefreshing.current = true;
    } else if (wasRefreshing.current) {
      wasRefreshing.current = false;
      setLastRefresh(new Date());
    }
  }, [state.refreshing.size]);

  // Also set initial refresh time when financials first appear
  useEffect(() => {
    if (state.financials.size > 0 && !lastRefresh) {
      setLastRefresh(new Date());
    }
  }, [state.financials.size, lastRefresh]);

  const totals = useMemo(
    () => calculatePortfolioSummaryTotals(tickers, state, isPortfolio, collectionId),
    [tickers, state, isPortfolio, collectionId],
  );

  const refreshText = lastRefresh
    ? lastRefresh.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : "—";
  const isRefreshing = state.refreshing.size > 0;

  // Watchlist: show average daily change %
  if (!isPortfolio) {
    if (totals.watchlistCount === 0) return null;
    return (
      <box flexDirection="row" height={1} width={width} justifyContent="flex-start" overflow="hidden">
        <text fg={colors.textDim}>{"Avg Day "}</text>
        <text fg={priceColor(totals.avgWatchlistChange)} attributes={TextAttributes.BOLD}>
          {formatPercentRaw(totals.avgWatchlistChange)}
        </text>
        <text fg={colors.textDim}>{"  " + (isRefreshing ? "Refreshing…" : refreshText)}</text>
      </box>
    );
  }

  if (!totals.hasPositions && !accountState) return null;

  const segments = buildPortfolioSummarySegments({
    totals,
    accountState: accountState ? { account: accountState.account, sourceLabel: accountState.sourceLabel } : null,
    widthBudget: width,
    refreshText: isRefreshing ? "Refreshing…" : refreshText,
  });

  return <box height={1}>{renderSummarySegments(segments, width)}</box>;
}

function PortfolioListPane({ focused, width, height }: PaneProps) {
  const registry = getSharedRegistry();
  const paneId = usePaneInstanceId();
  const { state } = useAppState();
  const paneCollection = usePaneCollection();
  const [currentCollectionId, setCurrentCollectionId] = usePaneStateValue<string>("collectionId", paneCollection.collectionId ?? "");
  const [cursorSymbol, setCursorSymbol] = usePaneStateValue<string | null>("cursorSymbol", null);
  const [collectionSorts, setCollectionSorts] = usePaneStateValue<Record<string, CollectionSortPreference>>("collectionSorts", {});
  const [cashDrawerExpanded, setCashDrawerExpanded] = usePaneStateValue<boolean>("cashDrawerExpanded", false);
  const tabs = getAllCollections(state);
  const tickers = getCollectionTickers(state, currentCollectionId);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [flashSymbols, setFlashSymbols] = useState<Set<string>>(new Set());
  const prevPrices = useRef<Map<string, number>>(new Map());
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const headerScrollRef = useRef<ScrollBoxRenderable>(null);

  const currentTabIdx = tabs.findIndex((t) => t.id === currentCollectionId);
  const isPortfolioTab = getCollectionType(state, currentCollectionId) === "portfolio";
  const currentPortfolio = isPortfolioTab
    ? state.config.portfolios.find((portfolio) => portfolio.id === currentCollectionId) ?? null
    : null;
  const accountState = usePortfolioAccountState(currentPortfolio, state);
  const showCashDrawer = !!(isPortfolioTab && currentPortfolio?.brokerInstanceId && accountState);
  const requestedDrawerHeight = showCashDrawer
    ? (cashDrawerExpanded
      ? Math.min(6, Math.max(3, 2 + accountState.visibleCashBalances.length))
      : 1)
    : 0;
  const summaryWidth = calculatePortfolioSummaryWidth(width, tabs.map((tab) => tab.name));
  const showStackedSummary = summaryWidth === 0;
  const headerHeight = showStackedSummary ? 2 : 1;
  const drawerHeight = showCashDrawer
    ? Math.min(requestedDrawerHeight, Math.max(1, height - (headerHeight + 2)))
    : 0;

  // Build columns: base config columns + position columns for portfolios
  const cols = useMemo(() => {
    const baseCols = state.config.columns;
    if (!isPortfolioTab) return baseCols;
    // Append position columns that aren't already in base columns
    const baseIds = new Set(baseCols.map((c) => c.id));
    const extra = POSITION_COLUMNS.filter((c) => !baseIds.has(c.id));
    return [...baseCols, ...extra];
  }, [state.config.columns, isPortfolioTab]);

  const columnCtx: ColumnContext = {
    activeTab: isPortfolioTab ? currentCollectionId : undefined,
    baseCurrency: state.config.baseCurrency,
    exchangeRates: state.exchangeRates,
    now,
  };
  const activeSort = resolveCollectionSortPreference(currentCollectionId, isPortfolioTab, collectionSorts);
  const sortCol = activeSort.columnId;
  const sortDir = activeSort.direction;

  const setSortPreference = useCallback((preference: CollectionSortPreference) => {
    if (!currentCollectionId) return;
    setCollectionSorts({
      ...collectionSorts,
      [currentCollectionId]: preference,
    });
  }, [collectionSorts, currentCollectionId, setCollectionSorts]);

  // Sort tickers
  const sortedTickers = useMemo(() => {
    if (!sortCol) return tickers;
    const colConfig = cols.find((c) => c.id === sortCol);
    if (!colConfig) return tickers;

    return [...tickers].sort((a, b) => {
      const finA = state.financials.get(a.metadata.ticker);
      const finB = state.financials.get(b.metadata.ticker);
      const valA = getSortValue(colConfig, a, finA, columnCtx);
      const valB = getSortValue(colConfig, b, finB, columnCtx);

      // Nulls always go to the bottom
      if (valA == null && valB == null) return 0;
      if (valA == null) return 1;
      if (valB == null) return -1;

      let cmp: number;
      if (typeof valA === "string" && typeof valB === "string") {
        cmp = valA.localeCompare(valB);
      } else {
        cmp = (valA as number) - (valB as number);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [tickers, sortCol, sortDir, state.financials, cols, columnCtx]);

  const selectedIdx = sortedTickers.findIndex((ticker) => ticker.metadata.ticker === cursorSymbol);
  const safeSelectedIdx = selectedIdx >= 0 ? selectedIdx : 0;

  const handleHeaderClick = (colId: string) => {
    if (sortCol === colId) {
      // Toggle direction, or clear if already desc
      if (sortDir === "asc") {
        setSortPreference({ columnId: colId, direction: "desc" });
      } else {
        setSortPreference({ columnId: null, direction: "asc" });
      }
    } else {
      setSortPreference({ columnId: colId, direction: "asc" });
    }
  };

  const handleKeyboard = useCallback((event: { name?: string; shift?: boolean }) => {
    if (!focused) return;
    const key = event.name;
    const isEnter = key === "enter" || key === "return";

    if (isEnter && event.shift) {
      const ticker = sortedTickers[safeSelectedIdx];
      if (ticker) {
        registry?.pinTickerFn(ticker.metadata.ticker, { floating: true, paneType: "ticker-detail" });
      }
      return;
    }

    if (shouldToggleCashMarginDrawer(key, showCashDrawer)) {
      setCashDrawerExpanded(!cashDrawerExpanded);
    } else if (key === "j" || key === "down") {
      const next = Math.min(safeSelectedIdx + 1, sortedTickers.length - 1);
      if (sortedTickers[next]) setCursorSymbol(sortedTickers[next]!.metadata.ticker);
    } else if (key === "k" || key === "up") {
      const next = Math.max(safeSelectedIdx - 1, 0);
      if (sortedTickers[next]) setCursorSymbol(sortedTickers[next]!.metadata.ticker);
    } else if (key === "h" || key === "left") {
      const newIdx = Math.max(currentTabIdx - 1, 0);
      if (tabs[newIdx]) setCurrentCollectionId(tabs[newIdx]!.id);
    } else if (key === "l" || key === "right") {
      const newIdx = Math.min(currentTabIdx + 1, tabs.length - 1);
      if (tabs[newIdx]) setCurrentCollectionId(tabs[newIdx]!.id);
    } else if (isEnter) {
      const follower = state.config.layout.instances.find((instance) =>
        instance.paneId === "ticker-detail"
        && instance.binding?.kind === "follow"
        && instance.binding.sourceInstanceId === paneId,
      );
      if (follower) {
        registry?.focusPaneFn(follower.instanceId);
      } else {
        registry?.showPaneFn("ticker-detail");
      }
    }
  }, [
    focused,
    registry,
    safeSelectedIdx,
    sortedTickers,
    state.config.layout.instances,
    paneId,
    tabs,
    currentTabIdx,
    setCurrentCollectionId,
    setCursorSymbol,
    showCashDrawer,
    cashDrawerExpanded,
    setCashDrawerExpanded,
  ]);

  useKeyboard(handleKeyboard);

  // Hide header scrollbar and sync horizontal scroll with body
  useEffect(() => {
    if (headerScrollRef.current) {
      headerScrollRef.current.horizontalScrollBar.visible = false;
    }
    const id = setInterval(() => {
      const body = scrollRef.current;
      const header = headerScrollRef.current;
      if (body && header && header.scrollLeft !== body.scrollLeft) {
        header.scrollLeft = body.scrollLeft;
      }
    }, 16);
    return () => clearInterval(id);
  }, []);

  // Auto-scroll to keep selected row visible
  useEffect(() => {
    const sb = scrollRef.current;
    if (!sb) return;
    const viewportH = sb.viewport.height;
    if (safeSelectedIdx < sb.scrollTop) {
      sb.scrollTo(safeSelectedIdx);
    } else if (safeSelectedIdx >= sb.scrollTop + viewportH) {
      sb.scrollTo(safeSelectedIdx - viewportH + 1);
    }
  }, [safeSelectedIdx]);

  // Hide vertical scrollbar when content fits in viewport
  useEffect(() => {
    const sb = scrollRef.current;
    if (!sb) return;
    sb.verticalScrollBar.visible = sortedTickers.length > sb.viewport.height;
  }, [sortedTickers.length, drawerHeight, cashDrawerExpanded]);

  // Tick every 5s to keep latency column fresh
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  // Detect price changes and trigger flash
  useEffect(() => {
    const changed = new Set<string>();
    for (const [symbol, fin] of state.financials) {
      const price = fin.quote?.price;
      if (price == null) continue;
      const prev = prevPrices.current.get(symbol);
      if (prev != null && prev !== price) {
        changed.add(symbol);
      }
      prevPrices.current.set(symbol, price);
    }
    if (changed.size > 0) {
      setFlashSymbols(changed);
      const tid = setTimeout(() => setFlashSymbols(new Set()), 600);
      return () => clearTimeout(tid);
    }
  }, [state.financials]);

  useEffect(() => {
    if (sortedTickers.length === 0) {
      if (cursorSymbol !== null) setCursorSymbol(null);
      return;
    }
    const exists = cursorSymbol && sortedTickers.some((ticker) => ticker.metadata.ticker === cursorSymbol);
    if (!exists) {
      setCursorSymbol(sortedTickers[0]!.metadata.ticker);
    }
  }, [sortedTickers, cursorSymbol, setCursorSymbol]);

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="column" height={headerHeight}>
        <box flexDirection="row" height={1}>
          <box flexShrink={1} overflow="hidden">
            <TabBar
              tabs={tabs.map((t) => ({ label: t.name, value: t.id }))}
              activeValue={currentCollectionId}
              onSelect={setCurrentCollectionId}
              compact
            />
          </box>
          {summaryWidth > 0 && (
            <box width={summaryWidth} flexShrink={0} alignItems="flex-start" justifyContent="center">
              <PortfolioSummaryBar
                tickers={sortedTickers}
                state={state}
                isPortfolio={isPortfolioTab}
                collectionId={currentCollectionId}
                width={summaryWidth}
                accountState={accountState}
              />
            </box>
          )}
        </box>
        {showStackedSummary && (
          <box height={1}>
            <PortfolioSummaryBar
              tickers={sortedTickers}
              state={state}
              isPortfolio={isPortfolioTab}
              collectionId={currentCollectionId}
              width={Math.max(0, width)}
              accountState={accountState}
            />
          </box>
        )}
      </box>

      {/* Fixed column headers — synced horizontally with rows */}
      <scrollbox
        ref={headerScrollRef}
        height={1}
        scrollX
        focusable={false}
      >
        <box flexDirection="row" height={1} paddingX={1}>
          {cols.map((col) => {
            const isSorted = sortCol === col.id;
            const indicator = isSorted ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : "";
            const labelText = col.label + indicator;
            return (
              <box
                key={col.id}
                width={col.width + 1}
                onMouseDown={(event) => {
                  event.preventDefault();
                  handleHeaderClick(col.id);
                }}
              >
                <text
                  attributes={TextAttributes.BOLD}
                  fg={isSorted ? colors.text : colors.textDim}
                >
                  {padTo(labelText, col.width, col.align)}
                </text>
              </box>
            );
          })}
        </box>
      </scrollbox>

      {/* Scrollable ticker rows */}
      <scrollbox
        ref={scrollRef}
        flexGrow={1}
        scrollX
        scrollY
        focusable={false}
      >
        {sortedTickers.length === 0 ? (
          <box paddingX={1} paddingY={1}>
            <EmptyState title="No tickers." hint="Press Ctrl+P to add one." />
          </box>
        ) : (
          sortedTickers.map((ticker, idx) => {
            const isSelected = ticker.metadata.ticker === cursorSymbol;
            const isHovered = idx === hoveredIdx && !isSelected;
            const fin = state.financials.get(ticker.metadata.ticker);
            const rowBg = isSelected ? colors.selected : isHovered ? hoverBg() : colors.bg;
            const isFlashing = flashSymbols.has(ticker.metadata.ticker);

            return (
              <box
                key={ticker.metadata.ticker}
                flexDirection="row"
                height={1}
                paddingX={1}
                backgroundColor={rowBg}
                onMouseMove={() => setHoveredIdx(idx)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  setCursorSymbol(ticker.metadata.ticker);
                }}
              >
                {cols.map((col) => {
                  const { text, color } = getColumnValue(col, ticker, fin, columnCtx);
                  const shouldFlash = isFlashing && col.id !== "ticker" && col.id !== "latency";
                  return (
                    <box key={col.id} width={col.width + 1}>
                      <text
                        fg={color || (isSelected ? colors.selectedText : colors.text)}
                        attributes={shouldFlash ? TextAttributes.DIM : 0}
                      >
                        {padTo(text, col.width, col.align)}
                      </text>
                    </box>
                  );
                })}
              </box>
            );
          })
        )}
      </scrollbox>

      {showCashDrawer && accountState && (
        <box height={drawerHeight} paddingX={1}>
          <PortfolioCashMarginDrawer
            accountState={accountState}
            expanded={cashDrawerExpanded}
            onToggle={() => setCashDrawerExpanded(!cashDrawerExpanded)}
            width={Math.max(0, width - 2)}
            height={drawerHeight}
          />
        </box>
      )}
    </box>
  );
}

export const portfolioListPlugin: GloomPlugin = {
  id: "portfolio-list",
  name: "Portfolio List",
  version: "1.0.0",

  panes: [
    {
      id: "portfolio-list",
      name: "Portfolio",
      icon: "P",
      component: PortfolioListPane,
      defaultPosition: "left",
      defaultWidth: "40%",
    },
  ],
};
