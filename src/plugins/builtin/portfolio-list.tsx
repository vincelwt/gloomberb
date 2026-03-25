import { useState, useCallback, useRef, useEffect } from "react";
import { useKeyboard } from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { TextAttributes } from "@opentui/core";
import { TabBar } from "../../components/tab-bar";
import type { GloomPlugin, PaneProps } from "../../types/plugin";
import { useAppState } from "../../state/app-context";
import { getActiveTabTickers, getLeftTabs } from "../../state/selectors";
import { colors, priceColor, hoverBg } from "../../theme/colors";
import { formatCurrency, formatPercentRaw, formatCompact, formatNumber, padTo } from "../../utils/format";
import { exchangeShortName, marketStateLabel } from "../../utils/market-status";
import type { ColumnConfig } from "../../types/config";
import type { TickerFile } from "../../types/ticker";
import type { TickerFinancials } from "../../types/financials";

function getColumnValue(
  col: ColumnConfig,
  ticker: TickerFile,
  financials: TickerFinancials | undefined,
  activeTab?: string,
): { text: string; color?: string } {
  const q = financials?.quote;
  const f = financials?.fundamentals;

  // Helper to get positions relevant to the active portfolio tab
  const tabPositions = activeTab
    ? ticker.frontmatter.positions.filter((p) => p.portfolio === activeTab)
    : ticker.frontmatter.positions;
  const totalShares = tabPositions.reduce((sum, p) => sum + p.shares * (p.side === "short" ? -1 : 1), 0);
  const totalCost = tabPositions.reduce((sum, p) => sum + p.shares * p.avg_cost * (p.multiplier || 1), 0);

  switch (col.id) {
    case "ticker":
      return { text: ticker.frontmatter.ticker };
    case "name":
      return { text: ticker.frontmatter.name || q?.name || "" };
    case "price":
      return {
        text: q ? formatCurrency(q.price, q.currency) : "—",
        color: q ? priceColor(q.change) : undefined,
      };
    case "change":
      return {
        text: q ? (q.change >= 0 ? "+" : "") + q.change.toFixed(2) : "—",
        color: q ? priceColor(q.change) : undefined,
      };
    case "change_pct":
      return {
        text: q ? formatPercentRaw(q.changePercent) : "—",
        color: q ? priceColor(q.changePercent) : undefined,
      };
    case "market_cap":
      return { text: q?.marketCap ? formatCompact(q.marketCap) : "—" };
    case "pe":
      return { text: f?.trailingPE ? formatNumber(f.trailingPE, 1) : "—" };
    case "dividend_yield":
      return {
        text: f?.dividendYield != null ? (f.dividendYield * 100).toFixed(2) + "%" : "—",
      };
    case "exchange": {
      const exch = exchangeShortName(q?.exchangeName, q?.fullExchangeName) || ticker.frontmatter.exchange;
      const mkt = q?.marketState;
      const statusDot = mkt === "REGULAR" ? "\u25CF" : mkt === "PRE" || mkt === "POST" ? "\u25CB" : "\u25CB";
      return { text: exch ? `${statusDot} ${exch}` : "—" };
    }
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
    case "avg_cost":
      return { text: totalShares !== 0 ? formatCurrency(totalCost / Math.abs(totalShares)) : "—" };
    case "cost_basis":
      return { text: totalCost !== 0 ? formatCompact(totalCost) : "—" };
    case "mkt_value": {
      if (!q || totalShares === 0) return { text: "—" };
      const mv = Math.abs(totalShares) * q.price;
      return { text: formatCompact(mv) };
    }
    case "pnl": {
      if (!q || totalShares === 0) return { text: "—" };
      const mv = Math.abs(totalShares) * q.price;
      const pnl = mv - totalCost;
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

function PortfolioListPane({ focused, width, height }: PaneProps) {
  const { state, dispatch } = useAppState();
  const tabs = getLeftTabs(state);
  const tickers = getActiveTabTickers(state);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const scrollRef = useRef<ScrollBoxRenderable>(null);

  const currentTabIdx = tabs.findIndex((t) => t.id === state.activeLeftTab);

  useKeyboard((event) => {
    if (!focused) return;
    const key = event.name;

    if (key === "j" || key === "down") {
      const next = Math.min(selectedIdx + 1, tickers.length - 1);
      setSelectedIdx(next);
      if (tickers[next]) dispatch({ type: "PREVIEW_TICKER", symbol: tickers[next]!.frontmatter.ticker });
    } else if (key === "k" || key === "up") {
      const next = Math.max(selectedIdx - 1, 0);
      setSelectedIdx(next);
      if (tickers[next]) dispatch({ type: "PREVIEW_TICKER", symbol: tickers[next]!.frontmatter.ticker });
    } else if (key === "h" || key === "left") {
      const newIdx = Math.max(currentTabIdx - 1, 0);
      if (tabs[newIdx]) dispatch({ type: "SET_LEFT_TAB", tab: tabs[newIdx]!.id });
    } else if (key === "l" || key === "right") {
      const newIdx = Math.min(currentTabIdx + 1, tabs.length - 1);
      if (tabs[newIdx]) dispatch({ type: "SET_LEFT_TAB", tab: tabs[newIdx]!.id });
    } else if (key === "enter") {
      // SELECT_TICKER already focuses the right panel
      if (tickers[selectedIdx]) dispatch({ type: "SELECT_TICKER", symbol: tickers[selectedIdx]!.frontmatter.ticker });
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
  if (tickers.length > 0 && selectedIdx >= tickers.length) {
    setSelectedIdx(0);
  }

  const innerWidth = Math.max(width - 2, 20);
  const cols = state.config.columns;

  return (
    <box flexDirection="column" flexGrow={1}>
      <TabBar
        tabs={tabs.map((t) => ({ label: t.name, value: t.id }))}
        activeValue={state.activeLeftTab}
        onSelect={(val) => dispatch({ type: "SET_LEFT_TAB", tab: val })}
      />

      {/* Column headers */}
      <box flexDirection="row" height={1} paddingX={1}>
        {cols.map((col) => (
          <box key={col.id} width={col.width + 1}>
            <text attributes={TextAttributes.BOLD} fg={colors.textDim}>
              {padTo(col.label, col.width, col.align)}
            </text>
          </box>
        ))}
      </box>

      {/* Ticker rows */}
      <scrollbox ref={scrollRef} flexGrow={1} scrollY>
        {tickers.length === 0 ? (
          <box paddingX={1} paddingY={1}>
            <text fg={colors.textDim}>No tickers. Press Cmd+K to add one.</text>
          </box>
        ) : (
          tickers.map((ticker, idx) => {
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
                  const { text, color } = getColumnValue(col, ticker, fin, state.activeLeftTab);
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
