import { useState, useMemo, useRef, useEffect, useCallback, useSyncExternalStore } from "react";
import { useKeyboard } from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { TextAttributes } from "@opentui/core";
import { EmptyState } from "../../components";
import { TabBar } from "../../components/tab-bar";
import type { GloomPlugin, PaneProps, PaneSettingOption, PaneSettingsDef, PaneTemplateContext } from "../../types/plugin";
import { getSharedRegistry } from "../../plugins/registry";
import { getSharedMarketDataCoordinator } from "../../market-data/coordinator";
import { useFxRatesMap, useTickerFinancialsMap } from "../../market-data/hooks";
import { instrumentFromTicker, quoteSubscriptionTargetFromTicker } from "../../market-data/request-types";
import { useAppActive } from "../../state/app-activity";
import {
  useAppState,
  usePaneCollection,
  usePaneInstance,
  usePaneInstanceId,
  usePaneStateValue,
  type CollectionSortPreference,
} from "../../state/app-context";
import { getAllCollections, getCollectionTickers, getCollectionType } from "../../state/selectors";
import { useQuoteStreaming } from "../../state/use-quote-streaming";
import { colors, priceColor, hoverBg } from "../../theme/colors";
import { formatCurrency, formatPercentRaw, formatCompact, formatNumber, padTo, convertCurrency } from "../../utils/format";
import { getActiveQuoteDisplay } from "../../utils/market-status";
import { clampQuoteTimestamp, formatQuoteAgeWithSource, getMostRecentQuoteUpdate } from "../../utils/quote-time";
import { DEFAULT_COLUMNS, type AppConfig, type ColumnConfig } from "../../types/config";
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

function getPositionCurrency(positions: TickerRecord["metadata"]["positions"], fallbackCurrency: string): string {
  return positions.find((position) => position.currency)?.currency || fallbackCurrency;
}
type CollectionScope = "all" | "portfolios" | "watchlists" | "custom";

interface PortfolioPaneSettings {
  columnIds: string[];
  collectionScope: CollectionScope;
  visibleCollectionIds: string[];
  hideTabs: boolean;
  hideHeader: boolean;
  hideCash: boolean;
  lockedCollectionId: string;
}

interface CollectionEntry {
  id: string;
  name: string;
  kind: "portfolio" | "watchlist";
}

type QuoteFlashDirection = "up" | "down" | "flat";

const PORTFOLIO_COLUMN_DEFS: ColumnConfig[] = [
  ...DEFAULT_COLUMNS,
  { id: "bid", label: "BID", width: 10, align: "right", format: "currency" },
  { id: "ask", label: "ASK", width: 10, align: "right", format: "currency" },
  { id: "spread", label: "SPREAD", width: 10, align: "right", format: "currency" },
  { id: "change", label: "CHG", width: 9, align: "right", format: "currency" },
  { id: "ext_hours", label: "EXT%", width: 8, align: "right", format: "percent" },
  { id: "dividend_yield", label: "DIV%", width: 7, align: "right", format: "percent" },
  { id: "shares", label: "SHARES", width: 9, align: "right", format: "number" },
  { id: "avg_cost", label: "AVG COST", width: 10, align: "right", format: "currency" },
  { id: "cost_basis", label: "COST", width: 10, align: "right", format: "compact" },
  { id: "mkt_value", label: "MKT VAL", width: 10, align: "right", format: "compact" },
  { id: "pnl", label: "P&L", width: 10, align: "right", format: "compact" },
  { id: "pnl_pct", label: "P&L%", width: 8, align: "right", format: "percent" },
];

const PORTFOLIO_COLUMNS_BY_ID = new Map(PORTFOLIO_COLUMN_DEFS.map((column) => [column.id, column]));
const DEFAULT_PORTFOLIO_COLUMN_IDS = [
  ...DEFAULT_COLUMNS.map((column) => column.id),
  "shares",
  "avg_cost",
  "cost_basis",
  "mkt_value",
  "pnl",
  "pnl_pct",
];
const PORTFOLIO_ONLY_COLUMN_IDS = new Set([
  "shares",
  "avg_cost",
  "cost_basis",
  "mkt_value",
  "pnl",
  "pnl_pct",
]);
const FLASHABLE_QUOTE_COLUMN_IDS = new Set([
  "price",
  "change",
  "change_pct",
  "bid",
  "ask",
  "spread",
  "ext_hours",
  "market_cap",
  "mkt_value",
  "pnl",
  "pnl_pct",
]);
const VISIBLE_FINANCIAL_REFRESH_COOLDOWN_MS = 5 * 60_000;
const COLLECTION_SCOPE_OPTIONS: PaneSettingOption[] = [
  {
    value: "all",
    label: "All Collections",
    description: "Show portfolios and watchlists in this pane.",
  },
  {
    value: "portfolios",
    label: "Portfolios Only",
    description: "Limit the pane to portfolios.",
  },
  {
    value: "watchlists",
    label: "Watchlists Only",
    description: "Limit the pane to watchlists.",
  },
  {
    value: "custom",
    label: "Custom Selection",
    description: "Choose exactly which collections this pane should show.",
  },
];

function resolveQuoteFlashColor(
  direction: QuoteFlashDirection,
  fallbackColor: string,
): string {
  switch (direction) {
    case "up":
      return colors.positive;
    case "down":
      return colors.negative;
    default:
      return fallbackColor === colors.textDim ? colors.text : colors.textBright;
  }
}

function needsVisibleFinancialWarmup(ticker: TickerRecord, financials: TickerFinancials | undefined): boolean {
  if (ticker.metadata.assetCategory === "OPT") return false;
  if (!financials) return true;
  if (Object.keys(financials.fundamentals ?? {}).length === 0) return true;
  return financials.priceHistory.length === 0;
}

function selectStreamTickers(
  tickers: TickerRecord[],
  _visibleRange: { start: number; end: number },
  _cursorSymbol: string | null,
): TickerRecord[] {
  return tickers;
}

export function resolvePortfolioPriceValue(
  activeQuote: ReturnType<typeof getActiveQuoteDisplay>,
  brokerMarkPrice: number | undefined,
  quoteCurrency: string,
  positionCurrency: string,
): { text: string; color?: string } {
  if (activeQuote) {
    return {
      text: formatCurrency(activeQuote.price, quoteCurrency),
      color: priceColor(activeQuote.change),
    };
  }
  if (brokerMarkPrice != null) {
    return { text: formatCurrency(brokerMarkPrice, positionCurrency) };
  }
  return { text: "—" };
}

function getColumnValue(
  col: ColumnConfig,
  ticker: TickerRecord,
  financials: TickerFinancials | undefined,
  ctx: ColumnContext,
): { text: string; color?: string } {
  const q = financials?.quote;
  const activeQuote = getActiveQuoteDisplay(q);
  const f = financials?.fundamentals;
  const quoteCurrency = q?.currency || ticker.metadata.currency || "USD";

  // Helper to get positions relevant to the active portfolio tab
  const tabPositions = ctx.activeTab
    ? ticker.metadata.positions.filter((p) => p.portfolio === ctx.activeTab)
    : ticker.metadata.positions;
  const positionCurrency = getPositionCurrency(tabPositions, quoteCurrency);
  const toBaseQuote = (value: number) =>
    convertCurrency(value, quoteCurrency, ctx.baseCurrency, ctx.exchangeRates);
  const toBasePosition = (value: number) =>
    convertCurrency(value, positionCurrency, ctx.baseCurrency, ctx.exchangeRates);
  const totalShares = tabPositions.reduce((sum, p) => sum + p.shares * (p.side === "short" ? -1 : 1), 0);
  const totalCost = tabPositions.reduce(
    (sum, p) => sum + p.shares * p.avgCost * (p.multiplier || 1),
    0,
  );

  // Fall back to the imported broker mark when a live quote is unavailable.
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
      return resolvePortfolioPriceValue(
        activeQuote,
        brokerMarkPrice,
        quoteCurrency,
        positionCurrency,
      );
    }
    case "change": {
      if (!activeQuote) return { text: "—" };
      return {
        text: (activeQuote.change >= 0 ? "+" : "") + activeQuote.change.toFixed(2),
        color: priceColor(activeQuote.change),
      };
    }
    case "bid":
      return { text: q?.bid != null ? formatCurrency(q.bid, quoteCurrency) : "—" };
    case "ask":
      return { text: q?.ask != null ? formatCurrency(q.ask, quoteCurrency) : "—" };
    case "spread":
      return {
        text: q?.bid != null && q?.ask != null
          ? formatCurrency(q.ask - q.bid, quoteCurrency)
          : "—",
      };
    case "change_pct": {
      return activeQuote
        ? { text: formatPercentRaw(activeQuote.changePercent), color: priceColor(activeQuote.changePercent) }
        : { text: q ? formatPercentRaw(q.changePercent) : "—", color: q ? priceColor(q.changePercent) : undefined };
    }
    case "market_cap": {
      if (!q?.marketCap) return { text: "—" };
      return { text: formatCompact(toBaseQuote(q.marketCap)) };
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
      if ((q?.marketState === "PRE" || q?.marketState === "PREPRE") && q.preMarketPrice != null) {
        const chg = activeQuote?.changePercent ?? q.preMarketChangePercent ?? 0;
        return { text: formatPercentRaw(chg), color: priceColor(chg) };
      }
      if ((q?.marketState === "POST" || q?.marketState === "POSTPOST") && q.postMarketPrice != null) {
        const chg = activeQuote?.changePercent ?? q.postMarketChangePercent ?? 0;
        return { text: formatPercentRaw(chg), color: priceColor(chg) };
      }
      return { text: "—" };
    }
    case "shares":
      return { text: totalShares !== 0 ? formatCompact(totalShares) : "—" };
    case "avg_cost": {
      if (totalShares === 0) return { text: "—" };
      const avgCost = totalCost / Math.abs(totalShares);
      return { text: formatCurrency(avgCost, positionCurrency) };
    }
    case "cost_basis": {
      if (totalCost === 0) return { text: "—" };
      return { text: formatCompact(toBasePosition(totalCost)) };
    }
    case "mkt_value": {
      if (activeQuote && totalShares !== 0) {
        const mv = Math.abs(totalShares) * activeQuote.price;
        return { text: formatCompact(toBaseQuote(mv)) };
      }
      if (isOption && brokerMktValue !== 0) {
        return { text: formatCompact(toBasePosition(brokerMktValue)) };
      }
      return { text: "—" };
    }
    case "pnl": {
      if (activeQuote && totalShares !== 0) {
        const mv = Math.abs(totalShares) * activeQuote.price;
        const pnl = toBaseQuote(mv) - toBasePosition(totalCost);
        return { text: (pnl >= 0 ? "+" : "") + formatCompact(pnl), color: priceColor(pnl) };
      }
      if (isOption && brokerPnl !== 0) {
        const pnl = toBasePosition(brokerPnl);
        return { text: (pnl >= 0 ? "+" : "") + formatCompact(pnl), color: priceColor(pnl) };
      }
      return { text: "—" };
    }
    case "pnl_pct": {
      if (activeQuote && totalCost !== 0) {
        const mv = toBaseQuote(Math.abs(totalShares) * activeQuote.price);
        const costBasis = toBasePosition(totalCost);
        const pct = costBasis !== 0 ? ((mv - costBasis) / costBasis) * 100 : 0;
        return { text: formatPercentRaw(pct), color: priceColor(pct) };
      }
      if (isOption && brokerPnl !== 0 && totalCost !== 0) {
        const costBasis = toBasePosition(totalCost);
        const pnl = toBasePosition(brokerPnl);
        const pct = costBasis !== 0 ? (pnl / costBasis) * 100 : 0;
        return { text: formatPercentRaw(pct), color: priceColor(pct) };
      }
      return { text: "—" };
    }
    case "latency": {
      return { text: formatQuoteAgeWithSource(q, ctx.now) };
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
  const activeQuote = getActiveQuoteDisplay(q);
  const f = financials?.fundamentals;
  const quoteCurrency = q?.currency || ticker.metadata.currency || "USD";

  const tabPositions = ctx.activeTab
    ? ticker.metadata.positions.filter((p) => p.portfolio === ctx.activeTab)
    : ticker.metadata.positions;
  const positionCurrency = getPositionCurrency(tabPositions, quoteCurrency);
  const toBaseQuote = (value: number) =>
    convertCurrency(value, quoteCurrency, ctx.baseCurrency, ctx.exchangeRates);
  const toBasePosition = (value: number) =>
    convertCurrency(value, positionCurrency, ctx.baseCurrency, ctx.exchangeRates);
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
      if (activeQuote) return activeQuote.price;
      if (isOption && brokerMarkPrice != null) return brokerMarkPrice;
      return null;
    case "bid":
      return q?.bid ?? null;
    case "ask":
      return q?.ask ?? null;
    case "spread":
      return q?.bid != null && q?.ask != null ? q.ask - q.bid : null;
    case "change":
      return activeQuote ? activeQuote.change : null;
    case "change_pct":
      return activeQuote?.changePercent ?? null;
    case "market_cap":
      return q?.marketCap ? toBaseQuote(q.marketCap) : null;
    case "pe":
      return f?.trailingPE ?? null;
    case "forward_pe":
      return f?.forwardPE ?? null;
    case "dividend_yield":
      return f?.dividendYield ?? null;
    case "ext_hours": {
      if ((q?.marketState === "PRE" || q?.marketState === "PREPRE") && q.preMarketPrice != null) return activeQuote?.changePercent ?? q.preMarketChangePercent ?? 0;
      if ((q?.marketState === "POST" || q?.marketState === "POSTPOST") && q.postMarketPrice != null) return activeQuote?.changePercent ?? q.postMarketChangePercent ?? 0;
      return null;
    }
    case "shares":
      return totalShares !== 0 ? totalShares : null;
    case "avg_cost":
      return totalShares !== 0 ? totalCost / Math.abs(totalShares) : null;
    case "cost_basis":
      return totalCost !== 0 ? toBasePosition(totalCost) : null;
    case "mkt_value": {
      if (activeQuote && totalShares !== 0) return toBaseQuote(Math.abs(totalShares) * activeQuote.price);
      if (isOption && brokerMktValue !== 0) return toBasePosition(brokerMktValue);
      return null;
    }
    case "pnl": {
      if (activeQuote && totalShares !== 0) {
        const mv = Math.abs(totalShares) * activeQuote.price;
        return toBaseQuote(mv) - toBasePosition(totalCost);
      }
      if (isOption && brokerPnl !== 0) return toBasePosition(brokerPnl);
      return null;
    }
    case "pnl_pct": {
      if (activeQuote && totalCost !== 0) {
        const mv = toBaseQuote(Math.abs(totalShares) * activeQuote.price);
        const costBasis = toBasePosition(totalCost);
        return costBasis !== 0 ? ((mv - costBasis) / costBasis) * 100 : null;
      }
      if (isOption && brokerPnl !== 0 && totalCost !== 0) {
        const costBasis = toBasePosition(totalCost);
        const pnl = toBasePosition(brokerPnl);
        return costBasis !== 0 ? (pnl / costBasis) * 100 : null;
      }
      return null;
    }
    case "latency":
      return q?.lastUpdated != null ? ctx.now - (clampQuoteTimestamp(q.lastUpdated, ctx.now) ?? ctx.now) : null;
    default:
      return null;
  }
}

function isCollectionScope(value: unknown): value is CollectionScope {
  return value === "all" || value === "portfolios" || value === "watchlists" || value === "custom";
}

function getPortfolioPaneSettings(settings: Record<string, unknown> | undefined): PortfolioPaneSettings {
  const columnIds = Array.isArray(settings?.columnIds)
    ? settings.columnIds.filter((value): value is string => typeof value === "string")
    : DEFAULT_PORTFOLIO_COLUMN_IDS;
  const visibleCollectionIds = Array.isArray(settings?.visibleCollectionIds)
    ? settings.visibleCollectionIds.filter((value): value is string => typeof value === "string")
    : [];

  return {
    columnIds: columnIds.length > 0 ? columnIds : DEFAULT_PORTFOLIO_COLUMN_IDS,
    collectionScope: isCollectionScope(settings?.collectionScope) ? settings.collectionScope : "all",
    visibleCollectionIds,
    hideTabs: settings?.hideTabs === true,
    hideHeader: settings?.hideHeader === true,
    hideCash: settings?.hideCash === true,
    lockedCollectionId: typeof settings?.lockedCollectionId === "string" ? settings.lockedCollectionId : "",
  };
}

function createPortfolioPaneSettings(overrides: Partial<PortfolioPaneSettings> = {}): PortfolioPaneSettings {
  return {
    columnIds: [...(overrides.columnIds ?? DEFAULT_PORTFOLIO_COLUMN_IDS)],
    collectionScope: overrides.collectionScope ?? "all",
    visibleCollectionIds: [...(overrides.visibleCollectionIds ?? [])],
    hideTabs: overrides.hideTabs ?? false,
    hideHeader: overrides.hideHeader ?? false,
    hideCash: overrides.hideCash ?? false,
    lockedCollectionId: overrides.lockedCollectionId ?? "",
  };
}

function getCollectionEntries(config: AppConfig): CollectionEntry[] {
  return [
    ...config.portfolios.map((portfolio) => ({
      id: portfolio.id,
      name: portfolio.name,
      kind: "portfolio" as const,
    })),
    ...config.watchlists.map((watchlist) => ({
      id: watchlist.id,
      name: watchlist.name,
      kind: "watchlist" as const,
    })),
  ];
}

function filterCollectionEntries(entries: CollectionEntry[], settings: PortfolioPaneSettings): CollectionEntry[] {
  switch (settings.collectionScope) {
    case "portfolios":
      return entries.filter((entry) => entry.kind === "portfolio");
    case "watchlists":
      return entries.filter((entry) => entry.kind === "watchlist");
    case "custom": {
      const selectedIds = new Set(settings.visibleCollectionIds);
      return entries.filter((entry) => selectedIds.has(entry.id));
    }
    default:
      return entries;
  }
}

function resolveScopedCollectionEntries(entries: CollectionEntry[], settings: PortfolioPaneSettings): CollectionEntry[] {
  const filtered = filterCollectionEntries(entries, settings);
  if (settings.collectionScope === "custom" && filtered.length === 0 && entries[0]) {
    return [entries[0]];
  }
  return filtered;
}

function resolveCollectionOptions(entries: CollectionEntry[]): PaneSettingOption[] {
  return entries.map((entry) => ({
    value: entry.id,
    label: entry.name,
    description: entry.kind === "portfolio" ? "Portfolio" : "Watchlist",
  }));
}

function resolveLockedCollectionId(settings: PortfolioPaneSettings, visibleCollections: CollectionEntry[]): string {
  if (visibleCollections.some((entry) => entry.id === settings.lockedCollectionId)) {
    return settings.lockedCollectionId;
  }
  return visibleCollections[0]?.id ?? "";
}

function resolveActiveCollectionId(
  currentCollectionId: string,
  visibleCollections: CollectionEntry[],
  settings: PortfolioPaneSettings,
): string {
  if (visibleCollections.length === 0) return "";
  if (settings.hideTabs) {
    return resolveLockedCollectionId(settings, visibleCollections);
  }
  if (visibleCollections.some((entry) => entry.id === currentCollectionId)) {
    return currentCollectionId;
  }
  return resolveLockedCollectionId(settings, visibleCollections);
}

function resolveVisibleColumns(columnIds: string[], isPortfolioTab: boolean): ColumnConfig[] {
  const resolved = columnIds
    .map((columnId) => PORTFOLIO_COLUMNS_BY_ID.get(columnId))
    .filter((column): column is ColumnConfig => column != null)
    .filter((column) => isPortfolioTab || !PORTFOLIO_ONLY_COLUMN_IDS.has(column.id));

  if (resolved.length > 0) {
    return resolved;
  }

  return DEFAULT_COLUMNS.filter((column) => isPortfolioTab || !PORTFOLIO_ONLY_COLUMN_IDS.has(column.id));
}

function buildPortfolioPaneSettingsDef(config: AppConfig, settings: PortfolioPaneSettings): PaneSettingsDef {
  const collectionEntries = getCollectionEntries(config);
  const scopedEntries = resolveScopedCollectionEntries(collectionEntries, settings);
  const allCollectionOptions = resolveCollectionOptions(collectionEntries);
  const lockedCollectionOptions = resolveCollectionOptions(scopedEntries.length > 0 ? scopedEntries : collectionEntries);

  const fields: PaneSettingsDef["fields"] = [
    {
      key: "columnIds",
      label: "Columns",
      description: "Choose which columns this pane shows and in what order.",
      type: "ordered-multi-select",
      options: PORTFOLIO_COLUMN_DEFS.map((column) => ({
        value: column.id,
        label: column.label,
        description: PORTFOLIO_ONLY_COLUMN_IDS.has(column.id)
          ? "Visible only when this pane is showing a portfolio."
          : "Visible for watchlists and portfolios.",
      })),
    },
    {
      key: "collectionScope",
      label: "Collections",
      description: "Control which portfolios or watchlists appear in this pane.",
      type: "select",
      options: COLLECTION_SCOPE_OPTIONS,
    },
  ];

  if (settings.collectionScope === "custom") {
    fields.push({
      key: "visibleCollectionIds",
      label: "Visible Collections",
      description: "Pick the exact collections that should appear in this pane.",
      type: "multi-select",
      options: allCollectionOptions,
    });
  }

  fields.push({
    key: "hideTabs",
    label: "Hide Tabs",
    description: "Hide the collection tab bar and lock this pane to one collection.",
    type: "toggle",
  });

  fields.push({
    key: "hideHeader",
    label: "Hide Header Bar",
    description: "Hide the summary bar showing portfolio value, P&L, and account metrics.",
    type: "toggle",
  });

  fields.push({
    key: "hideCash",
    label: "Hide Cash Positions",
    description: "Hide the cash & margin drawer at the bottom of the pane.",
    type: "toggle",
  });

  if (settings.hideTabs && lockedCollectionOptions.length > 0) {
    fields.push({
      key: "lockedCollectionId",
      label: "Locked Collection",
      description: "Choose which collection this pane should stay pinned to.",
      type: "select",
      options: lockedCollectionOptions,
    });
  }

  return {
    title: "Portfolio Pane Settings",
    fields,
  };
}

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
    const fin = financialsMap.get(ticker.metadata.ticker);
    const q = fin?.quote;
    const activeQuote = getActiveQuoteDisplay(q);
    const quoteCurrency = q?.currency || ticker.metadata.currency || "USD";

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
    const positionCurrency = getPositionCurrency(tabPositions, quoteCurrency);
    const toBaseQuote = (value: number) => convertCurrency(value, quoteCurrency, baseCurrency, exchangeRates);
    const toBasePosition = (value: number) => convertCurrency(value, positionCurrency, baseCurrency, exchangeRates);
    const totalShares = tabPositions.reduce((sum, position) => sum + position.shares * (position.side === "short" ? -1 : 1), 0);
    const totalCost = tabPositions.reduce(
      (sum, position) => sum + position.shares * position.avgCost * (position.multiplier || 1),
      0,
    );

    const isOption = ticker.metadata.assetCategory === "OPT";
    const brokerMktValue = tabPositions.reduce((sum, position) => sum + (position.marketValue || 0), 0);

    if (q && activeQuote && totalShares !== 0) {
      hasPositions = true;
      const marketValue = Math.abs(totalShares) * activeQuote.price;
      totalMktValue += toBaseQuote(marketValue);
      const prevClose = q.previousClose || (activeQuote.price - activeQuote.change);
      totalPrevValue += toBaseQuote(Math.abs(totalShares) * prevClose);
      totalCostBasis += toBasePosition(totalCost);
    } else if (isOption && brokerMktValue !== 0) {
      hasPositions = true;
      totalMktValue += toBasePosition(brokerMktValue);
      totalCostBasis += toBasePosition(totalCost);
      totalPrevValue += toBasePosition(brokerMktValue);
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
        backgroundColor={colors.bg}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggle();
        }}
        onMouseUp={(event) => {
          event.preventDefault();
          event.stopPropagation();
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
        backgroundColor={colors.bg}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggle();
        }}
        onMouseUp={(event) => {
          event.preventDefault();
          event.stopPropagation();
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
  financialsMap,
  state,
  isPortfolio,
  collectionId,
  width,
  accountState,
}: {
  tickers: TickerRecord[];
  financialsMap: Map<string, TickerFinancials>;
  state: ReturnType<typeof useAppState>["state"];
  isPortfolio: boolean;
  collectionId: string | null;
  width: number;
  accountState: ResolvedPortfolioAccountState | null;
}) {
  const lastRefreshTimestamp = useMemo(() => getMostRecentQuoteUpdate(
    tickers.map((ticker) => financialsMap.get(ticker.metadata.ticker)?.quote),
  ), [financialsMap, tickers]);
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
    if (financialsMap.size > 0 && !lastRefresh) {
      setLastRefresh(new Date());
    }
  }, [financialsMap.size, lastRefresh]);

  const exchangeRates = useFxRatesMap([
    state.config.baseCurrency,
    ...tickers.map((ticker) => ticker.metadata.currency),
    ...tickers.map((ticker) => financialsMap.get(ticker.metadata.ticker)?.quote?.currency),
    ...tickers.flatMap((ticker) => ticker.metadata.positions.map((position) => position.currency)),
    ...(accountState?.visibleCashBalances.map((balance) => balance.currency) ?? []),
    ...(accountState?.visibleCashBalances.map((balance) => balance.baseCurrency) ?? []),
  ]);
  const effectiveExchangeRates = exchangeRates.size > 1 || state.exchangeRates.size === 0
    ? exchangeRates
    : state.exchangeRates;

  const totals = useMemo(
    () => calculatePortfolioSummaryTotals(tickers, financialsMap, state.config.baseCurrency, effectiveExchangeRates, isPortfolio, collectionId),
    [tickers, financialsMap, state.config.baseCurrency, effectiveExchangeRates, isPortfolio, collectionId],
  );

  const refreshTimestamp = lastRefreshTimestamp ?? lastRefresh?.getTime() ?? null;
  const refreshText = refreshTimestamp != null
    ? new Date(refreshTimestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
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
        <text fg={colors.textDim}>{"  " + refreshText}</text>
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
  const paneInstance = usePaneInstance();
  const appActive = useAppActive();
  const { state, dispatch } = useAppState();
  const paneCollection = usePaneCollection();
  const [currentCollectionId, setCurrentCollectionId] = usePaneStateValue<string>("collectionId", paneCollection.collectionId ?? "");
  const [cursorSymbol, setCursorSymbol] = usePaneStateValue<string | null>("cursorSymbol", null);
  const [collectionSorts, setCollectionSorts] = usePaneStateValue<Record<string, CollectionSortPreference>>("collectionSorts", {});
  const [cashDrawerExpanded, setCashDrawerExpanded] = usePaneStateValue<boolean>("cashDrawerExpanded", false);
  const paneSettings = useMemo(
    () => getPortfolioPaneSettings(paneInstance?.settings),
    [paneInstance?.settings],
  );
  const collectionEntries = useMemo(
    () => getCollectionEntries(state.config),
    [state.config],
  );
  const tabs = useMemo(
    () => resolveScopedCollectionEntries(collectionEntries, paneSettings),
    [collectionEntries, paneSettings],
  );
  const activeCollectionId = resolveActiveCollectionId(currentCollectionId, tabs, paneSettings);
  const tickers = getCollectionTickers(state, activeCollectionId);
  const marketFinancialsMap = useTickerFinancialsMap(tickers);
  const sharedCoordinator = getSharedMarketDataCoordinator();
  const financialsMap = useMemo(() => {
    const merged = sharedCoordinator ? new Map<string, TickerFinancials>() : new Map(state.financials);
    for (const [symbol, financials] of marketFinancialsMap) {
      merged.set(symbol, financials);
    }
    return merged;
  }, [marketFinancialsMap, sharedCoordinator, state.financials]);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [flashSymbols, setFlashSymbols] = useState<Map<string, QuoteFlashDirection>>(new Map());
  const [streamWindow, setStreamWindow] = useState({ start: 0, end: 24 });
  const prevPrices = useRef<Map<string, number>>(new Map());
  const mountedRef = useRef(true);
  const financialWarmupInFlight = useRef(new Set<string>());
  const financialWarmupAttempts = useRef(new Map<string, number>());
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const headerScrollRef = useRef<ScrollBoxRenderable>(null);
  const syncHeaderScroll = useCallback(() => {
    const body = scrollRef.current;
    const header = headerScrollRef.current;
    if (body && header && header.scrollLeft !== body.scrollLeft) {
      header.scrollLeft = body.scrollLeft;
    }
  }, []);

  const currentTabIdx = tabs.findIndex((tab) => tab.id === activeCollectionId);
  const isPortfolioTab = getCollectionType(state, activeCollectionId) === "portfolio";
  const currentPortfolio = isPortfolioTab
    ? state.config.portfolios.find((portfolio) => portfolio.id === activeCollectionId) ?? null
    : null;
  const accountState = usePortfolioAccountState(currentPortfolio, state);
  const showCashDrawer = !paneSettings.hideCash && !!(isPortfolioTab && currentPortfolio?.brokerInstanceId && accountState);
  const requestedDrawerHeight = showCashDrawer
    ? (cashDrawerExpanded
      ? Math.min(6, Math.max(3, 2 + accountState.visibleCashBalances.length))
      : 1)
    : 0;
  const summaryWidth = paneSettings.hideTabs || paneSettings.hideHeader
    ? 0
    : calculatePortfolioSummaryWidth(width, tabs.map((tab) => tab.name));
  const showStackedSummary = !paneSettings.hideHeader && (paneSettings.hideTabs || summaryWidth === 0);
  const headerHeight = paneSettings.hideHeader
    ? (paneSettings.hideTabs ? 0 : 1)
    : paneSettings.hideTabs ? 1 : (showStackedSummary ? 2 : 1);
  const drawerHeight = showCashDrawer
    ? Math.min(requestedDrawerHeight, Math.max(1, height - (headerHeight + 2)))
    : 0;

  const cols = useMemo(() => {
    return resolveVisibleColumns(paneSettings.columnIds, isPortfolioTab);
  }, [isPortfolioTab, paneSettings.columnIds]);

  const exchangeRates = useFxRatesMap(useMemo(() => {
    const currencies = new Set<string>([state.config.baseCurrency]);
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
  }, [accountState?.visibleCashBalances, financialsMap, state.config.baseCurrency, tickers]));
  const effectiveExchangeRates = exchangeRates.size > 1 || state.exchangeRates.size === 0
    ? exchangeRates
    : state.exchangeRates;

  const columnCtx: ColumnContext = {
    activeTab: isPortfolioTab ? activeCollectionId : undefined,
    baseCurrency: state.config.baseCurrency,
    exchangeRates: effectiveExchangeRates,
    now,
  };
  const activeSort = resolveCollectionSortPreference(activeCollectionId, isPortfolioTab, collectionSorts);
  const sortCol = activeSort.columnId;
  const sortDir = activeSort.direction;

  const setSortPreference = useCallback((preference: CollectionSortPreference) => {
    if (!activeCollectionId) return;
    setCollectionSorts({
      ...collectionSorts,
      [activeCollectionId]: preference,
    });
  }, [activeCollectionId, collectionSorts, setCollectionSorts]);

  useEffect(() => {
    if (activeCollectionId !== currentCollectionId) {
      setCurrentCollectionId(activeCollectionId);
    }
  }, [activeCollectionId, currentCollectionId, setCurrentCollectionId]);

  // Sort tickers
  const sortedTickers = useMemo(() => {
    if (!sortCol) return tickers;
    const colConfig = cols.find((c) => c.id === sortCol);
    if (!colConfig) return tickers;

    return [...tickers].sort((a, b) => {
      const finA = financialsMap.get(a.metadata.ticker);
      const finB = financialsMap.get(b.metadata.ticker);
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
  }, [tickers, sortCol, sortDir, financialsMap, cols, columnCtx]);

  const selectedIdx = sortedTickers.findIndex((ticker) => ticker.metadata.ticker === cursorSymbol);
  const safeSelectedIdx = selectedIdx >= 0 ? selectedIdx : 0;

  const updateStreamWindow = useCallback(() => {
    const scrollBox = scrollRef.current;
    if (!scrollBox) return;
    const buffer = 3;
    const start = Math.max(0, scrollBox.scrollTop - buffer);
    const end = Math.min(sortedTickers.length, scrollBox.scrollTop + scrollBox.viewport.height + buffer);
    setStreamWindow((current) => (
      current.start === start && current.end === end ? current : { start, end }
    ));
  }, [sortedTickers.length]);

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
    } else if (!paneSettings.hideTabs && (key === "h" || key === "left")) {
      const newIdx = Math.max(currentTabIdx - 1, 0);
      if (tabs[newIdx]) setCurrentCollectionId(tabs[newIdx]!.id);
    } else if (!paneSettings.hideTabs && (key === "l" || key === "right")) {
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
    paneSettings.hideTabs,
  ]);

  useKeyboard(handleKeyboard);

  useEffect(() => (
    () => {
      mountedRef.current = false;
    }
  ), []);

  // Hide the decorative header scrollbar and keep it aligned when the body scrolls.
  useEffect(() => {
    if (headerScrollRef.current) {
      headerScrollRef.current.horizontalScrollBar.visible = false;
    }
    syncHeaderScroll();
  }, [syncHeaderScroll]);

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
    queueMicrotask(updateStreamWindow);
  }, [safeSelectedIdx, updateStreamWindow]);

  // Hide vertical scrollbar when content fits in viewport
  useEffect(() => {
    const sb = scrollRef.current;
    if (!sb) return;
    sb.verticalScrollBar.visible = sortedTickers.length > sb.viewport.height;
    updateStreamWindow();
  }, [sortedTickers.length, drawerHeight, cashDrawerExpanded, updateStreamWindow]);

  // Tick every second so visible live/delayed quote ages feel responsive.
  useEffect(() => {
    if (!appActive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [appActive]);

  // Detect price changes and trigger flash
  useEffect(() => {
    const changed = new Map<string, QuoteFlashDirection>();
    for (const [symbol, fin] of financialsMap) {
      const price = getActiveQuoteDisplay(fin.quote)?.price ?? fin.quote?.price;
      if (price == null) continue;
      const prev = prevPrices.current.get(symbol);
      if (prev != null && prev !== price) {
        changed.set(symbol, price > prev ? "up" : price < prev ? "down" : "flat");
      }
      prevPrices.current.set(symbol, price);
    }
    if (changed.size > 0) {
      setFlashSymbols(changed);
      const tid = setTimeout(() => setFlashSymbols(new Map()), 450);
      return () => clearTimeout(tid);
    }
  }, [financialsMap]);

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

  const streamTickers = useMemo(
    () => selectStreamTickers(sortedTickers, streamWindow, cursorSymbol),
    [cursorSymbol, sortedTickers, streamWindow],
  );
  const streamTargets = useMemo(() => (
    streamTickers
      .map((ticker) => quoteSubscriptionTargetFromTicker(ticker, ticker.metadata.ticker, "provider"))
      .filter((target): target is NonNullable<typeof target> => target != null)
  ), [streamTickers]);
  const visibleFinancialTickers = useMemo(
    () => sortedTickers.slice(streamWindow.start, streamWindow.end),
    [sortedTickers, streamWindow.end, streamWindow.start],
  );

  useEffect(() => {
    if (!appActive) return;
    const coordinator = getSharedMarketDataCoordinator();
    if (!coordinator) return;

    const nowTs = Date.now();
    const queue = visibleFinancialTickers.filter((ticker) => {
      const key = `${ticker.metadata.ticker}:${ticker.metadata.exchange ?? ""}`;
      if (financialWarmupInFlight.current.has(key)) return false;
      if (nowTs - (financialWarmupAttempts.current.get(key) ?? 0) < VISIBLE_FINANCIAL_REFRESH_COOLDOWN_MS) return false;
      return needsVisibleFinancialWarmup(ticker, financialsMap.get(ticker.metadata.ticker));
    });
    if (queue.length === 0) return;

    const runNext = async () => {
      const next = queue.shift();
      if (!next) return;

      const key = `${next.metadata.ticker}:${next.metadata.exchange ?? ""}`;
      const instrument = instrumentFromTicker(next, next.metadata.ticker);
      financialWarmupInFlight.current.add(key);
      financialWarmupAttempts.current.set(key, nowTs);
      try {
        if (instrument) {
          await coordinator.loadSnapshot(instrument);
        }
      } catch {
        // Best-effort warmup for visible rows.
      } finally {
        financialWarmupInFlight.current.delete(key);
      }

      if (mountedRef.current) {
        await runNext();
      }
    };

    const workers = Array.from({ length: Math.min(3, queue.length) }, () => runNext());
    void Promise.all(workers);
  }, [appActive, dispatch, financialsMap, visibleFinancialTickers]);

  useQuoteStreaming(streamTargets);

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="column" height={headerHeight}>
        {!paneSettings.hideTabs && (
          <box flexDirection="row" height={1}>
            <box flexShrink={1} overflow="hidden">
              <TabBar
                tabs={tabs.map((tab) => ({ label: tab.name, value: tab.id }))}
                activeValue={activeCollectionId}
                onSelect={setCurrentCollectionId}
                compact
              />
            </box>
            {summaryWidth > 0 && (
              <box width={summaryWidth} flexShrink={0} alignItems="flex-start" justifyContent="center">
                <PortfolioSummaryBar
                  tickers={sortedTickers}
                  financialsMap={financialsMap}
                  state={state}
                  isPortfolio={isPortfolioTab}
                  collectionId={activeCollectionId}
                  width={summaryWidth}
                  accountState={accountState}
                />
              </box>
            )}
          </box>
        )}
        {showStackedSummary && (
          <box height={1}>
            <PortfolioSummaryBar
              tickers={sortedTickers}
              financialsMap={financialsMap}
              state={state}
              isPortfolio={isPortfolioTab}
              collectionId={activeCollectionId}
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
        onMouseDown={() => queueMicrotask(syncHeaderScroll)}
        onMouseUp={() => queueMicrotask(() => { syncHeaderScroll(); updateStreamWindow(); })}
        onMouseDrag={() => queueMicrotask(() => { syncHeaderScroll(); updateStreamWindow(); })}
        onMouseScroll={() => queueMicrotask(() => { syncHeaderScroll(); updateStreamWindow(); })}
      >
        {sortedTickers.length === 0 ? (
          <box paddingX={1} paddingY={1}>
            <EmptyState title="No tickers." hint="Press Ctrl+P to add one." />
          </box>
        ) : (
          sortedTickers.map((ticker, idx) => {
            const isSelected = ticker.metadata.ticker === cursorSymbol;
            const isHovered = idx === hoveredIdx && !isSelected;
            const fin = financialsMap.get(ticker.metadata.ticker);
            const rowBg = isSelected ? colors.selected : isHovered ? hoverBg() : colors.bg;
            const flashDirection = flashSymbols.get(ticker.metadata.ticker);

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
                  const baseFg = color || (isSelected ? colors.selectedText : colors.text);
                  const shouldFlash = flashDirection != null && FLASHABLE_QUOTE_COLUMN_IDS.has(col.id);
                  const cellFg = shouldFlash
                    ? resolveQuoteFlashColor(flashDirection, baseFg)
                    : baseFg;
                  return (
                    <box key={col.id} width={col.width + 1}>
                      <text
                        fg={cellFg}
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
      defaultMode: "floating",
      defaultWidth: "40%",
      settings: (context) => buildPortfolioPaneSettingsDef(
        context.config,
        getPortfolioPaneSettings(context.settings),
      ),
    },
  ],
  paneTemplates: [
    {
      id: "new-collection-pane",
      paneId: "portfolio-list",
      label: "Collection Pane",
      description: "Open another pane for the current portfolio or watchlist",
      keywords: ["portfolio", "watchlist", "collection", "pane", "list"],
      shortcut: { prefix: "PF" },
      canCreate: (context) => resolveCollectionPaneId(context) !== null,
      createInstance: (context) => {
        const collectionId = resolveCollectionPaneId(context);
        return collectionId
          ? {
            params: { collectionId },
            settings: createPortfolioPaneSettings({
              collectionScope: "custom",
              visibleCollectionIds: [collectionId],
              hideTabs: true,
              lockedCollectionId: collectionId,
            }) as unknown as Record<string, unknown>,
          }
          : null;
      },
    },
    {
      id: "new-portfolio-pane",
      paneId: "portfolio-list",
      label: "New Portfolio Pane",
      description: "Open another portfolio list pane",
      keywords: ["new", "portfolio", "pane", "list"],
      canCreate: (context) => context.config.portfolios.length > 0,
      createInstance: (context) => {
        const collectionId = context.activeCollectionId && context.config.portfolios.some((portfolio) => portfolio.id === context.activeCollectionId)
          ? context.activeCollectionId
          : (context.config.portfolios[0]?.id ?? null);
        if (!collectionId) return null;
        return {
          params: { collectionId },
          settings: createPortfolioPaneSettings({
            collectionScope: "portfolios",
            lockedCollectionId: collectionId,
          }) as unknown as Record<string, unknown>,
        };
      },
    },
    {
      id: "new-watchlist-pane",
      paneId: "portfolio-list",
      label: "New Watchlist Pane",
      description: "Open another watchlist pane",
      keywords: ["new", "watchlist", "pane", "list"],
      canCreate: (context) => context.config.watchlists.length > 0,
      createInstance: (context) => {
        const collectionId = context.activeCollectionId && context.config.watchlists.some((watchlist) => watchlist.id === context.activeCollectionId)
          ? context.activeCollectionId
          : (context.config.watchlists[0]?.id ?? null);
        if (!collectionId) return null;
        return {
          params: { collectionId },
          settings: createPortfolioPaneSettings({
            collectionScope: "watchlists",
            lockedCollectionId: collectionId,
          }) as unknown as Record<string, unknown>,
        };
      },
    },
  ],
};

function resolveCollectionPaneId(context: PaneTemplateContext): string | null {
  if (context.activeCollectionId) {
    const isPortfolio = context.config.portfolios.some((portfolio) => portfolio.id === context.activeCollectionId);
    const isWatchlist = context.config.watchlists.some((watchlist) => watchlist.id === context.activeCollectionId);
    if (isPortfolio || isWatchlist) {
      return context.activeCollectionId;
    }
  }

  return context.config.portfolios[0]?.id ?? context.config.watchlists[0]?.id ?? null;
}
