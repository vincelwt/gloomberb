import { useRef, useEffect, useState, useCallback } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { TabSelectRenderable, TextareaRenderable } from "@opentui/core";
import type { GloomPlugin, PaneProps } from "../../types/plugin";
import { useAppState, useSelectedTicker } from "../../state/app-context";
import { colors, priceColor } from "../../theme/colors";
import { formatCurrency, formatCompact, formatPercent, formatPercentRaw, formatNumber } from "../../utils/format";
import { inlineSparkline, renderStockChart } from "../../utils/ascii-chart";
import type { MarkdownStore } from "../../data/markdown-store";

const DETAIL_TABS = [
  { name: "Overview", description: "", value: "overview" },
  { name: "Financials", description: "", value: "financials" },
  { name: "Chart", description: "", value: "chart" },
  { name: "Notes", description: "", value: "notes" },
];

function MetricRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <box flexDirection="row" height={1}>
      <box width={16}>
        <text fg={colors.textDim}>{label}</text>
      </box>
      <text fg={color || colors.text}>{value}</text>
    </box>
  );
}

function OverviewTab({ width }: { width?: number }) {
  const { ticker, financials } = useSelectedTicker();
  const { width: termWidth } = useTerminalDimensions();
  if (!ticker) return <text fg={colors.textDim}>Select a ticker from the list.</text>;

  const q = financials?.quote;
  const f = financials?.fundamentals;

  // Use last 1 year of data for overview chart, full available width
  const chartWidth = Math.max((width || Math.floor(termWidth * 0.5)) - 4, 20);
  const history = financials?.priceHistory || [];
  const last1y = history.slice(-252); // ~1 year of trading days
  const chartData = last1y.map((p) => p.close);
  const chartDates = last1y.map((p) => p.date);
  const chartColor = chartData.length >= 2
    ? priceColor(chartData[chartData.length - 1]! - chartData[0]!)
    : colors.neutral;

  const chartLines = chartData.length > 2
    ? renderStockChart(
        { dates: chartDates, prices: chartData },
        { width: chartWidth, height: 6, showAxis: true, showLabels: true },
      )
    : [];

  return (
    <scrollbox flexGrow={1} scrollY>
      <box flexDirection="column" padding={1} gap={1}>
        {/* Title */}
        <box flexDirection="row">
          <text attributes={TextAttributes.BOLD} fg={colors.textBright}>
            {ticker.frontmatter.ticker}
          </text>
          <text fg={colors.textDim}>
            {" "}- {ticker.frontmatter.name || q?.name || ""}
          </text>
        </box>

        {/* Price */}
        {q && (
          <box flexDirection="row" gap={2}>
            <text attributes={TextAttributes.BOLD} fg={priceColor(q.change)}>
              {formatCurrency(q.price, q.currency)}
            </text>
            <text fg={priceColor(q.change)}>
              {q.change >= 0 ? "+" : ""}{q.change.toFixed(2)} ({formatPercentRaw(q.changePercent)})
            </text>
          </box>
        )}

        {/* 1Y Chart */}
        {chartLines.length > 0 && (
          <box flexDirection="column">
            {chartLines.map((line, i) => (
              <box key={i} height={1}>
                <text fg={i < chartLines.length - 1 ? chartColor : colors.textDim}>{line}</text>
              </box>
            ))}
          </box>
        )}

        {/* Key metrics */}
        <box flexDirection="column">
          <MetricRow label="Market Cap" value={q?.marketCap ? formatCompact(q.marketCap) : "—"} />
          <MetricRow label="P/E (TTM)" value={f?.trailingPE ? formatNumber(f.trailingPE, 1) : "—"} />
          <MetricRow label="Forward P/E" value={f?.forwardPE ? formatNumber(f.forwardPE, 1) : "—"} />
          <MetricRow label="PEG Ratio" value={f?.pegRatio ? formatNumber(f.pegRatio, 2) : "—"} />
          <MetricRow label="EPS" value={f?.eps ? formatCurrency(f.eps) : "—"} />
          <MetricRow label="Div Yield" value={f?.dividendYield != null ? formatPercent(f.dividendYield) : "—"} />
          <MetricRow label="Revenue" value={f?.revenue ? formatCompact(f.revenue) : "—"} />
          <MetricRow label="Net Income" value={f?.netIncome ? formatCompact(f.netIncome) : "—"} />
          <MetricRow label="FCF" value={f?.freeCashFlow ? formatCompact(f.freeCashFlow) : "—"} />
          <MetricRow label="Op. Margin" value={f?.operatingMargin != null ? formatPercent(f.operatingMargin) : "—"} />
          <MetricRow label="Profit Margin" value={f?.profitMargin != null ? formatPercent(f.profitMargin) : "—"} />
          <MetricRow
            label="52W Range"
            value={q?.low52w && q?.high52w ? `${formatCurrency(q.low52w)} - ${formatCurrency(q.high52w)}` : "—"}
          />
          <MetricRow
            label="1Y Return"
            value={f?.return1Y != null ? formatPercent(f.return1Y) : "—"}
            color={f?.return1Y != null ? priceColor(f.return1Y) : undefined}
          />
          <MetricRow
            label="3Y Return"
            value={f?.return3Y != null ? formatPercent(f.return3Y) : "—"}
            color={f?.return3Y != null ? priceColor(f.return3Y) : undefined}
          />
        </box>

        {/* Sector / classification */}
        {(ticker.frontmatter.sector || ticker.frontmatter.industry || ticker.frontmatter.asset_category || ticker.frontmatter.isin) && (
          <box flexDirection="column">
            {ticker.frontmatter.asset_category && (
              <MetricRow label="Type" value={ticker.frontmatter.asset_category} />
            )}
            {ticker.frontmatter.sector && (
              <MetricRow label="Sector" value={ticker.frontmatter.sector} />
            )}
            {ticker.frontmatter.industry && (
              <MetricRow label="Industry" value={ticker.frontmatter.industry} />
            )}
            {ticker.frontmatter.isin && (
              <MetricRow label="ISIN" value={ticker.frontmatter.isin} />
            )}
          </box>
        )}

        {/* Positions */}
        {ticker.frontmatter.positions.length > 0 && (
          <box flexDirection="column">
            <box height={1}>
              <text attributes={TextAttributes.BOLD} fg={colors.textBright}>Positions</text>
            </box>
            {ticker.frontmatter.positions.map((pos, i) => {
              const costBasis = pos.shares * pos.avg_cost * (pos.multiplier || 1);
              const pnlText = pos.unrealized_pnl != null
                ? `  P&L: ${pos.unrealized_pnl >= 0 ? "+" : ""}${formatCurrency(pos.unrealized_pnl, pos.currency)}`
                : "";
              return (
                <box key={i} flexDirection="column">
                  <box flexDirection="row" height={1}>
                    <text fg={colors.textDim}>{pos.portfolio}</text>
                    <text fg={colors.textMuted}>{" via "}{pos.broker}</text>
                    {pos.side === "short" && <text fg={colors.negative}>{" SHORT"}</text>}
                  </box>
                  <box flexDirection="row" height={1}>
                    <text fg={colors.text}>
                      {pos.shares} shares @ {formatCurrency(pos.avg_cost, pos.currency)}
                      {" = "}{formatCurrency(costBasis, pos.currency)}
                    </text>
                    {pnlText && (
                      <text fg={priceColor(pos.unrealized_pnl!)}>{pnlText}</text>
                    )}
                  </box>
                </box>
              );
            })}
          </box>
        )}
      </box>
    </scrollbox>
  );
}

function FinancialsTab() {
  const { financials } = useSelectedTicker();
  if (!financials) return <text fg={colors.textDim}>No financial data available.</text>;

  const stmts = financials.annualStatements.slice(-5).reverse();

  return (
    <scrollbox flexGrow={1} scrollY>
      <box flexDirection="column" paddingX={1} paddingY={1}>
        <text attributes={TextAttributes.BOLD} fg={colors.textBright}>Annual Financials</text>
        <box height={1} />

        {/* Header row */}
        <box flexDirection="row" height={1}>
          <box width={14}><text attributes={TextAttributes.BOLD} fg={colors.textDim}>Metric</text></box>
          {stmts.map((s) => (
            <box key={s.date} width={14}>
              <text attributes={TextAttributes.BOLD} fg={colors.textDim}>{s.date.slice(0, 7)}</text>
            </box>
          ))}
        </box>

        {/* Data rows */}
        {[
          { label: "Revenue", key: "totalRevenue" as const },
          { label: "Net Income", key: "netIncome" as const },
          { label: "EBITDA", key: "ebitda" as const },
          { label: "EPS", key: "eps" as const },
          { label: "Total Debt", key: "totalDebt" as const },
        ].map(({ label, key }) => (
          <box key={key} flexDirection="row" height={1}>
            <box width={14}><text fg={colors.textDim}>{label}</text></box>
            {stmts.map((s) => (
              <box key={s.date} width={14}>
                <text fg={colors.text}>
                  {s[key] != null
                    ? key === "eps" ? formatNumber(s[key]!, 2) : formatCompact(s[key]!)
                    : "—"}
                </text>
              </box>
            ))}
          </box>
        ))}
      </box>
    </scrollbox>
  );
}

function ChartTab({ width, height }: { width?: number; height?: number }) {
  const { ticker, financials } = useSelectedTicker();
  const { width: termWidth, height: termHeight } = useTerminalDimensions();

  if (!financials?.priceHistory.length) {
    return <text fg={colors.textDim}>No price history available.</text>;
  }

  const prices = financials.priceHistory.map((p) => p.close);
  const dates = financials.priceHistory.map((p) => p.date);
  const color = prices.length >= 2 ? priceColor(prices[prices.length - 1]! - prices[0]!) : colors.neutral;
  const change = prices.length >= 2 ? prices[prices.length - 1]! - prices[0]! : 0;
  const changePct = prices[0] ? (change / prices[0]) * 100 : 0;

  // Use available space for chart
  const chartWidth = Math.max((width || Math.floor(termWidth * 0.55)) - 4, 30);
  const chartHeight = Math.max((height || termHeight - 8) - 6, 8);

  const chartLines = renderStockChart(
    { dates, prices },
    { width: chartWidth, height: chartHeight, showAxis: true, showLabels: true },
  );

  return (
    <box flexDirection="column" paddingX={1} paddingY={1} flexGrow={1}>
      {/* Title with price change */}
      <box flexDirection="row" gap={2}>
        <text attributes={TextAttributes.BOLD} fg={colors.textBright}>
          {ticker?.frontmatter.ticker || ""} - 5Y
        </text>
        <text fg={color}>
          {change >= 0 ? "+" : ""}{formatCurrency(change)} ({changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%)
        </text>
      </box>
      <box height={1} />

      {/* Chart */}
      {chartLines.map((line, i) => (
        <box key={i} height={1}>
          <text fg={i < chartLines.length - 1 ? color : colors.textDim}>{line}</text>
        </box>
      ))}
    </box>
  );
}

function NotesTab({ markdownStore, notesFocused }: { markdownStore?: MarkdownStore; notesFocused: boolean }) {
  const { ticker } = useSelectedTicker();
  const { dispatch } = useAppState();
  const textareaRef = useRef<TextareaRenderable>(null);

  // Save notes when unfocusing
  useEffect(() => {
    if (!notesFocused && textareaRef.current && ticker) {
      const text = textareaRef.current.editBuffer.getText();
      if (text !== ticker.notes) {
        const updated = { ...ticker, notes: text };
        dispatch({ type: "UPDATE_TICKER", ticker: updated });
        if (markdownStore) {
          markdownStore.saveTicker(updated).catch(() => {});
        }
      }
    }
  }, [notesFocused]);

  if (!ticker) return <text fg={colors.textDim}>Select a ticker to view notes.</text>;

  return (
    <box flexDirection="column" padding={1} flexGrow={1}>
      <box flexDirection="row" height={1}>
        <text attributes={TextAttributes.BOLD} fg={colors.textBright}>Notes</text>
        <box flexGrow={1} />
        <text fg={colors.textMuted}>
          {notesFocused ? "editing (Esc to stop)" : "Enter to edit"}
        </text>
      </box>
      <box height={1} />
      <textarea
        ref={textareaRef}
        initialValue={ticker.notes || ""}
        placeholder="Write notes about this ticker..."
        focused={notesFocused}
        textColor={colors.text}
        placeholderColor={colors.textDim}
        backgroundColor={notesFocused ? colors.panel : colors.bg}
        flexGrow={1}
      />
    </box>
  );
}

// Store ref is set from the plugin setup
let _markdownStore: MarkdownStore | undefined;
export function setMarkdownStore(store: MarkdownStore) {
  _markdownStore = store;
}

function TickerDetailPane({ focused, width, height }: PaneProps) {
  const { state, dispatch } = useAppState();
  const [notesFocused, setNotesFocused] = useState(false);
  const tabIdx = DETAIL_TABS.findIndex((t) => t.value === state.activeRightTab);
  const tabRef = useRef<TabSelectRenderable>(null);

  useEffect(() => {
    if (tabRef.current && tabIdx >= 0) {
      tabRef.current.setSelectedIndex(tabIdx);
    }
  }, [tabIdx]);

  useKeyboard((event) => {
    if (!focused) return;

    // Handle notes focus toggle
    if (state.activeRightTab === "notes") {
      if (event.name === "enter" && !notesFocused) {
        setNotesFocused(true);
        return;
      }
      if (event.name === "escape" && notesFocused) {
        setNotesFocused(false);
        return;
      }
      if (notesFocused) return; // Let textarea handle keys
    }

    if (event.name === "h" || event.name === "left") {
      const newIdx = Math.max(tabIdx - 1, 0);
      dispatch({ type: "SET_RIGHT_TAB", tab: DETAIL_TABS[newIdx]!.value });
    } else if (event.name === "l" || event.name === "right") {
      const newIdx = Math.min(tabIdx + 1, DETAIL_TABS.length - 1);
      dispatch({ type: "SET_RIGHT_TAB", tab: DETAIL_TABS[newIdx]!.value });
    }
  });

  return (
    <box flexDirection="column" flexGrow={1}>
      <tab-select
        ref={tabRef}
        options={DETAIL_TABS}
        focused={false}
        showUnderline
        textColor={colors.textDim}
        selectedTextColor={colors.text}
        backgroundColor={colors.bg}
        selectedBackgroundColor={colors.bg}
        onChange={(idx) => dispatch({ type: "SET_RIGHT_TAB", tab: DETAIL_TABS[idx]!.value })}
      />

      {state.activeRightTab === "overview" && <OverviewTab width={width} />}
      {state.activeRightTab === "financials" && <FinancialsTab />}
      {state.activeRightTab === "chart" && <ChartTab width={width} height={height} />}
      {state.activeRightTab === "notes" && <NotesTab markdownStore={_markdownStore} notesFocused={notesFocused} />}
    </box>
  );
}

export const tickerDetailPlugin: GloomPlugin = {
  id: "ticker-detail",
  name: "Ticker Detail",
  version: "1.0.0",

  panes: [
    {
      id: "ticker-detail",
      name: "Detail",
      icon: "D",
      component: TickerDetailPane,
      defaultPosition: "right",
    },
  ],
};
