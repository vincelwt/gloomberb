import { useState, useMemo, useRef, useEffect } from "react";
import { useKeyboard } from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { TextAttributes } from "@opentui/core";
import { TabBar } from "../../components/tab-bar";
import type { GloomPlugin, PaneProps } from "../../types/plugin";
import { useAppState } from "../../state/app-context";
import { getActiveTabTickers, getLeftTabs } from "../../state/selectors";
import { colors, priceColor, hoverBg } from "../../theme/colors";
import { formatCurrency, formatPercentRaw, formatCompact, formatNumber, padTo } from "../../utils/format";
import type { ColumnConfig } from "../../types/config";
import type { TickerFile } from "../../types/ticker";
import type { TickerFinancials } from "../../types/financials";

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

  switch (col.id) {
    case "ticker": {
      const mkt = q?.marketState;
      const statusDot = mkt === "REGULAR" ? "\u25CF" : "\u25CB";
      return { text: `${statusDot} ${ticker.frontmatter.ticker}` };
    }
    case "price": {
      if (!q) return { text: "—" };
      const converted = toBase(q.price);
      return {
        text: formatCurrency(converted, ctx.baseCurrency),
        color: priceColor(q.change),
      };
    }
    case "change": {
      if (!q) return { text: "—" };
      const converted = toBase(q.change);
      return {
        text: (converted >= 0 ? "+" : "") + converted.toFixed(2),
        color: priceColor(q.change),
      };
    }
    case "change_pct":
      return {
        text: q ? formatPercentRaw(q.changePercent) : "—",
        color: q ? priceColor(q.changePercent) : undefined,
      };
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
      return { text: totalShares !== 0 ? formatNumber(totalShares, 2) : "—" };
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
      if (!q || totalShares === 0) return { text: "—" };
      const mv = Math.abs(totalShares) * q.price;
      return { text: formatCompact(toBase(mv)) };
    }
    case "pnl": {
      if (!q || totalShares === 0) return { text: "—" };
      const mv = Math.abs(totalShares) * q.price;
      const pnl = toBase(mv - totalCost);
      return { text: (pnl >= 0 ? "+" : "") + formatCompact(pnl), color: priceColor(pnl) };
    }
    case "pnl_pct": {
      if (!q || totalCost === 0) return { text: "—" };
      const mv = Math.abs(totalShares) * q.price;
      const pct = ((mv - totalCost) / totalCost) * 100;
      return { text: formatPercentRaw(pct), color: priceColor(pct) };
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

  switch (col.id) {
    case "ticker":
      return ticker.frontmatter.ticker;
    case "price":
      return q ? toBase(q.price) : null;
    case "change":
      return q ? toBase(q.change) : null;
    case "change_pct":
      return q?.changePercent ?? null;
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
      if (!q || totalShares === 0) return null;
      return toBase(Math.abs(totalShares) * q.price);
    }
    case "pnl": {
      if (!q || totalShares === 0) return null;
      const mv = Math.abs(totalShares) * q.price;
      return toBase(mv - totalCost);
    }
    case "pnl_pct": {
      if (!q || totalCost === 0) return null;
      const mv = Math.abs(totalShares) * q.price;
      return ((mv - totalCost) / totalCost) * 100;
    }
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

function PortfolioListPane({ focused, width, height }: PaneProps) {
  const { state, dispatch } = useAppState();
  const tabs = getLeftTabs(state);
  const tickers = getActiveTabTickers(state);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const scrollRef = useRef<ScrollBoxRenderable>(null);

  const currentTabIdx = tabs.findIndex((t) => t.id === state.activeLeftTab);
  const isPortfolioTab = state.config.portfolios.some((p) => p.id === state.activeLeftTab);

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
    activeTab: state.activeLeftTab,
    baseCurrency: state.config.baseCurrency,
    exchangeRates: state.exchangeRates,
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

  useKeyboard((event) => {
    if (!focused) return;
    const key = event.name;

    if (key === "j" || key === "down") {
      const next = Math.min(selectedIdx + 1, sortedTickers.length - 1);
      setSelectedIdx(next);
      if (sortedTickers[next]) dispatch({ type: "PREVIEW_TICKER", symbol: sortedTickers[next]!.frontmatter.ticker });
    } else if (key === "k" || key === "up") {
      const next = Math.max(selectedIdx - 1, 0);
      setSelectedIdx(next);
      if (sortedTickers[next]) dispatch({ type: "PREVIEW_TICKER", symbol: sortedTickers[next]!.frontmatter.ticker });
    } else if (key === "h" || key === "left") {
      const newIdx = Math.max(currentTabIdx - 1, 0);
      if (tabs[newIdx]) dispatch({ type: "SET_LEFT_TAB", tab: tabs[newIdx]!.id });
    } else if (key === "l" || key === "right") {
      const newIdx = Math.min(currentTabIdx + 1, tabs.length - 1);
      if (tabs[newIdx]) dispatch({ type: "SET_LEFT_TAB", tab: tabs[newIdx]!.id });
    } else if (key === "enter") {
      if (sortedTickers[selectedIdx]) dispatch({ type: "SELECT_TICKER", symbol: sortedTickers[selectedIdx]!.frontmatter.ticker });
    }
  });

  // Auto-scroll to keep selected row visible
  useEffect(() => {
    const sb = scrollRef.current;
    if (!sb) return;
    const viewportH = sb.viewport.height;
    if (selectedIdx < sb.scrollTop) {
      sb.scrollTo(selectedIdx);
    } else if (selectedIdx >= sb.scrollTop + viewportH) {
      sb.scrollTo(selectedIdx - viewportH + 1);
    }
  }, [selectedIdx]);

  // Auto-select first ticker when list changes
  if (sortedTickers.length > 0 && selectedIdx >= sortedTickers.length) {
    setSelectedIdx(0);
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      <TabBar
        tabs={tabs.map((t) => ({ label: t.name, value: t.id }))}
        activeValue={state.activeLeftTab}
        onSelect={(val) => dispatch({ type: "SET_LEFT_TAB", tab: val })}
      />

      {/* Scrollable table with headers + rows */}
      <scrollbox ref={scrollRef} flexGrow={1} scrollX scrollY>
        {/* Column headers — clickable for sorting */}
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

        {/* Ticker rows */}
        {sortedTickers.length === 0 ? (
          <box paddingX={1} paddingY={1}>
            <text fg={colors.textDim}>No tickers. Press Cmd+K to add one.</text>
          </box>
        ) : (
          sortedTickers.map((ticker, idx) => {
            const isSelected = idx === selectedIdx;
            const isHovered = idx === hoveredIdx && !isSelected;
            const fin = state.financials.get(ticker.frontmatter.ticker);
            const rowBg = isSelected ? colors.selected : isHovered ? hoverBg() : colors.bg;

            return (
              <box
                key={ticker.frontmatter.ticker}
                flexDirection="row"
                height={1}
                paddingX={1}
                backgroundColor={rowBg}
                onMouseMove={() => setHoveredIdx(idx)}
                onMouseDown={() => {
                  setSelectedIdx(idx);
                  dispatch({ type: "SELECT_TICKER", symbol: ticker.frontmatter.ticker });
                }}
              >
                {cols.map((col) => {
                  const { text, color } = getColumnValue(col, ticker, fin, columnCtx);
                  return (
                    <box key={col.id} width={col.width + 1}>
                      <text
                        fg={color || (isSelected ? colors.selectedText : colors.text)}
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
