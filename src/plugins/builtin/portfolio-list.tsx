import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { TextAttributes } from "@opentui/core";
import { TabBar } from "../../components/tab-bar";
import type { GloomPlugin, PaneProps } from "../../types/plugin";
import { getSharedRegistry } from "../../plugins/registry";
import { useAppState, usePaneCollection, usePaneInstanceId, usePaneStateValue } from "../../state/app-context";
import { getAllCollections, getCollectionTickers, getCollectionType } from "../../state/selectors";
import { colors, priceColor, hoverBg } from "../../theme/colors";
import { formatCurrency, formatPercentRaw, formatCompact, formatNumber, padTo } from "../../utils/format";
import type { ColumnConfig } from "../../types/config";
import type { TickerFile } from "../../types/ticker";
import type { TickerFinancials } from "../../types/financials";

const MONTH_ABBREV = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Parse IBKR option symbol like "UBER 260821C00090000" into a readable form.
 * Format: UNDERLYING YYMMDD{C|P}SSSSSSSS (strike in 1/1000 dollars, 8 digits)
 */
function formatOptionTicker(symbol: string): string {
  // Match: TICKER(space)YYMMDDX00SSSSSS  where X is C or P
  const m = symbol.match(/^(\S+)\s+(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!m) return symbol;
  const [, underlying, yy, mm, , side, rawStrike] = m;
  const strike = parseInt(rawStrike!, 10) / 1000;
  const month = MONTH_ABBREV[parseInt(mm!, 10) - 1] || mm;
  const strikeStr = strike % 1 === 0 ? String(strike) : strike.toFixed(1);
  return `${underlying} ${side === "C" ? "C" : "P"} $${strikeStr} ${month}'${yy}`;
}

/** Convert a value from one currency to base currency using cached exchange rates */
function convertCurrency(
  value: number,
  fromCurrency: string,
  baseCurrency: string,
  exchangeRates: Map<string, number>,
): number {
  if (fromCurrency === baseCurrency) return value;
  const fromRate = exchangeRates.get(fromCurrency);
  const baseRate = exchangeRates.get(baseCurrency);
  if (fromRate == null || baseRate == null || baseRate === 0) return value;
  return (value * fromRate) / baseRate;
}

interface ColumnContext {
  activeTab?: string;
  baseCurrency: string;
  exchangeRates: Map<string, number>;
  now: number;
}

function getColumnValue(
  col: ColumnConfig,
  ticker: TickerFile,
  financials: TickerFinancials | undefined,
  ctx: ColumnContext,
): { text: string; color?: string } {
  const q = financials?.quote;
  const f = financials?.fundamentals;
  const quoteCurrency = q?.currency || ticker.frontmatter.currency || "USD";

  const toBase = (v: number) =>
    convertCurrency(v, quoteCurrency, ctx.baseCurrency, ctx.exchangeRates);

  // Helper to get positions relevant to the active portfolio tab
  const tabPositions = ctx.activeTab
    ? ticker.frontmatter.positions.filter((p) => p.portfolio === ctx.activeTab)
    : ticker.frontmatter.positions;
  const totalShares = tabPositions.reduce((sum, p) => sum + p.shares * (p.side === "short" ? -1 : 1), 0);
  const totalCost = tabPositions.reduce(
    (sum, p) => sum + p.shares * p.avg_cost * (p.multiplier || 1),
    0,
  );

  // For options without Yahoo quotes, use broker-provided position data
  const isOption = ticker.frontmatter.asset_category === "OPT";
  const brokerMktValue = tabPositions.reduce(
    (sum, p) => sum + (p.market_value || 0),
    0,
  );
  const brokerPnl = tabPositions.reduce(
    (sum, p) => sum + (p.unrealized_pnl || 0),
    0,
  );
  const brokerMarkPrice = tabPositions.length === 1 ? tabPositions[0]?.mark_price : undefined;

  switch (col.id) {
    case "ticker": {
      const mkt = q?.marketState;
      const statusDot = mkt === "REGULAR" ? "\u25CF" : "\u25CB";
      const displayName = isOption
        ? formatOptionTicker(ticker.frontmatter.ticker)
        : ticker.frontmatter.ticker;
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
  ticker: TickerFile,
  financials: TickerFinancials | undefined,
  ctx: ColumnContext,
): number | string | null {
  const q = financials?.quote;
  const f = financials?.fundamentals;
  const quoteCurrency = q?.currency || ticker.frontmatter.currency || "USD";
  const toBase = (v: number) =>
    convertCurrency(v, quoteCurrency, ctx.baseCurrency, ctx.exchangeRates);

  const tabPositions = ctx.activeTab
    ? ticker.frontmatter.positions.filter((p) => p.portfolio === ctx.activeTab)
    : ticker.frontmatter.positions;
  const totalShares = tabPositions.reduce((sum, p) => sum + p.shares * (p.side === "short" ? -1 : 1), 0);
  const totalCost = tabPositions.reduce(
    (sum, p) => sum + p.shares * p.avg_cost * (p.multiplier || 1),
    0,
  );

  const isOption = ticker.frontmatter.asset_category === "OPT";
  const brokerMktValue = tabPositions.reduce((sum, p) => sum + (p.market_value || 0), 0);
  const brokerPnl = tabPositions.reduce((sum, p) => sum + (p.unrealized_pnl || 0), 0);
  const brokerMarkPrice = tabPositions.length === 1 ? tabPositions[0]?.mark_price : undefined;

  switch (col.id) {
    case "ticker":
      return ticker.frontmatter.ticker;
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

type SortDir = "asc" | "desc";

/** Position-specific columns appended when viewing a portfolio */
const POSITION_COLUMNS: ColumnConfig[] = [
  { id: "shares", label: "SHARES", width: 9, align: "right", format: "number" },
  { id: "avg_cost", label: "AVG COST", width: 10, align: "right", format: "currency" },
  { id: "mkt_value", label: "MKT VAL", width: 10, align: "right", format: "compact" },
  { id: "pnl", label: "P&L", width: 10, align: "right", format: "compact" },
  { id: "pnl_pct", label: "P&L%", width: 8, align: "right", format: "percent" },
];

function PortfolioSummaryBar({
  tickers,
  state,
  isPortfolio,
  collectionId,
}: {
  tickers: TickerFile[];
  state: ReturnType<typeof useAppState>["state"];
  isPortfolio: boolean;
  collectionId: string | null;
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

  const baseCurrency = state.config.baseCurrency;
  const exchangeRates = state.exchangeRates;

  const totals = useMemo(() => {
    let totalMktValue = 0;
    let totalPrevValue = 0;
    let totalCostBasis = 0;
    let hasPositions = false;
    // For watchlists: average daily change %
    let watchlistChangeSum = 0;
    let watchlistCount = 0;

    for (const ticker of tickers) {
      const fin = state.financials.get(ticker.frontmatter.ticker);
      const q = fin?.quote;
      const quoteCurrency = q?.currency || ticker.frontmatter.currency || "USD";
      const toBase = (v: number) => convertCurrency(v, quoteCurrency, baseCurrency, exchangeRates);

      if (!isPortfolio) {
        if (q?.changePercent != null) {
          watchlistChangeSum += q.changePercent;
          watchlistCount++;
        }
        continue;
      }

      const tabPositions = collectionId
        ? ticker.frontmatter.positions.filter((p) => p.portfolio === collectionId)
        : ticker.frontmatter.positions;
      const totalShares = tabPositions.reduce((sum, p) => sum + p.shares * (p.side === "short" ? -1 : 1), 0);
      const totalCost = tabPositions.reduce(
        (sum, p) => sum + p.shares * p.avg_cost * (p.multiplier || 1),
        0,
      );

      const isOption = ticker.frontmatter.asset_category === "OPT";
      const brokerMktValue = tabPositions.reduce((sum, p) => sum + (p.market_value || 0), 0);

      if (q && totalShares !== 0) {
        hasPositions = true;
        const mv = Math.abs(totalShares) * q.price;
        totalMktValue += toBase(mv);
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
      totalMktValue, dailyPnl, dailyPnlPct, totalCostBasis, hasPositions,
      unrealizedPnl, unrealizedPnlPct,
      avgWatchlistChange, watchlistCount,
    };
  }, [tickers, state.financials, collectionId, baseCurrency, exchangeRates, isPortfolio]);

  const refreshText = lastRefresh
    ? lastRefresh.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : "—";
  const isRefreshing = state.refreshing.size > 0;

  // Watchlist: show average daily change %
  if (!isPortfolio) {
    if (totals.watchlistCount === 0) return null;
    return (
      <box flexDirection="row" height={1} paddingRight={1}>
        <text fg={colors.textDim}>{"Avg Day "}</text>
        <text fg={priceColor(totals.avgWatchlistChange)} attributes={TextAttributes.BOLD}>
          {formatPercentRaw(totals.avgWatchlistChange)}
        </text>
        <text fg={colors.textDim}>{"  " + (isRefreshing ? "Refreshing…" : refreshText)}</text>
      </box>
    );
  }

  if (!totals.hasPositions) return null;

  return (
    <box flexDirection="row" height={1} paddingRight={1}>
      <text fg={colors.textDim}>{"Val "}</text>
      <text fg={colors.text} attributes={TextAttributes.BOLD}>
        {formatCompact(totals.totalMktValue)}
      </text>
      <text fg={colors.textDim}>{"  Day "}</text>
      <text fg={priceColor(totals.dailyPnl)} attributes={TextAttributes.BOLD}>
        {(totals.dailyPnl >= 0 ? "+" : "") + formatCompact(totals.dailyPnl)}
      </text>
      <text fg={priceColor(totals.dailyPnlPct)}>
        {" (" + formatPercentRaw(totals.dailyPnlPct) + ")"}
      </text>
      <text fg={colors.textDim}>{"  P&L "}</text>
      <text fg={priceColor(totals.unrealizedPnl)} attributes={TextAttributes.BOLD}>
        {(totals.unrealizedPnl >= 0 ? "+" : "") + formatCompact(totals.unrealizedPnl)}
      </text>
      <text fg={priceColor(totals.unrealizedPnlPct)}>
        {" (" + formatPercentRaw(totals.unrealizedPnlPct) + ")"}
      </text>
      <text fg={colors.textDim}>{"  " + (isRefreshing ? "Refreshing…" : refreshText)}</text>
    </box>
  );
}

function PortfolioListPane({ focused }: PaneProps) {
  const registry = getSharedRegistry();
  const paneId = usePaneInstanceId();
  const { state } = useAppState();
  const paneCollection = usePaneCollection();
  const [currentCollectionId, setCurrentCollectionId] = usePaneStateValue<string>("collectionId", paneCollection.collectionId ?? "");
  const [cursorSymbol, setCursorSymbol] = usePaneStateValue<string | null>("cursorSymbol", null);
  const tabs = getAllCollections(state);
  const tickers = getCollectionTickers(state, currentCollectionId);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [now, setNow] = useState(Date.now());
  const [flashSymbols, setFlashSymbols] = useState<Set<string>>(new Set());
  const prevPrices = useRef<Map<string, number>>(new Map());
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const headerScrollRef = useRef<ScrollBoxRenderable>(null);

  const currentTabIdx = tabs.findIndex((t) => t.id === currentCollectionId);
  const isPortfolioTab = getCollectionType(state, currentCollectionId) === "portfolio";

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

  // Sort tickers
  const sortedTickers = useMemo(() => {
    if (!sortCol) return tickers;
    const colConfig = cols.find((c) => c.id === sortCol);
    if (!colConfig) return tickers;

    return [...tickers].sort((a, b) => {
      const finA = state.financials.get(a.frontmatter.ticker);
      const finB = state.financials.get(b.frontmatter.ticker);
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

  const selectedIdx = sortedTickers.findIndex((ticker) => ticker.frontmatter.ticker === cursorSymbol);
  const safeSelectedIdx = selectedIdx >= 0 ? selectedIdx : 0;

  const handleHeaderClick = (colId: string) => {
    if (sortCol === colId) {
      // Toggle direction, or clear if already desc
      if (sortDir === "asc") {
        setSortDir("desc");
      } else {
        setSortCol(null);
        setSortDir("asc");
      }
    } else {
      setSortCol(colId);
      setSortDir("asc");
    }
  };

  const handleKeyboard = useCallback((event: { name?: string; shift?: boolean }) => {
    if (!focused) return;
    const key = event.name;
    const isEnter = key === "enter" || key === "return";

    if (isEnter && event.shift) {
      const ticker = sortedTickers[safeSelectedIdx];
      if (ticker) {
        registry?.pinTickerFn(ticker.frontmatter.ticker, { floating: true, paneType: "ticker-detail" });
      }
      return;
    }

    if (key === "j" || key === "down") {
      const next = Math.min(safeSelectedIdx + 1, sortedTickers.length - 1);
      if (sortedTickers[next]) setCursorSymbol(sortedTickers[next]!.frontmatter.ticker);
    } else if (key === "k" || key === "up") {
      const next = Math.max(safeSelectedIdx - 1, 0);
      if (sortedTickers[next]) setCursorSymbol(sortedTickers[next]!.frontmatter.ticker);
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
  }, [focused, registry, safeSelectedIdx, sortedTickers, state.config.layout.instances, paneId, tabs, currentTabIdx, setCurrentCollectionId, setCursorSymbol]);

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
  }, [sortedTickers.length]);

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
    const exists = cursorSymbol && sortedTickers.some((ticker) => ticker.frontmatter.ticker === cursorSymbol);
    if (!exists) {
      setCursorSymbol(sortedTickers[0]!.frontmatter.ticker);
    }
  }, [sortedTickers, cursorSymbol, setCursorSymbol]);

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" height={2} justifyContent="space-between">
        <TabBar
          tabs={tabs.map((t) => ({ label: t.name, value: t.id }))}
          activeValue={currentCollectionId}
          onSelect={setCurrentCollectionId}
        />
        <PortfolioSummaryBar tickers={sortedTickers} state={state} isPortfolio={isPortfolioTab} collectionId={currentCollectionId} />
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
                onMouseDown={() => handleHeaderClick(col.id)}
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
            <text fg={colors.textDim}>No tickers. Press Ctrl+P to add one.</text>
          </box>
        ) : (
          sortedTickers.map((ticker, idx) => {
            const isSelected = ticker.frontmatter.ticker === cursorSymbol;
            const isHovered = idx === hoveredIdx && !isSelected;
            const fin = state.financials.get(ticker.frontmatter.ticker);
            const rowBg = isSelected ? colors.selected : isHovered ? hoverBg() : colors.bg;
            const isFlashing = flashSymbols.has(ticker.frontmatter.ticker);

            return (
              <box
                key={ticker.frontmatter.ticker}
                flexDirection="row"
                height={1}
                paddingX={1}
                backgroundColor={rowBg}
                onMouseMove={() => setHoveredIdx(idx)}
                onMouseDown={() => {
                  setCursorSymbol(ticker.frontmatter.ticker);
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
