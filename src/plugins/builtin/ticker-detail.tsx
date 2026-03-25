import { useRef, useEffect, useState, useCallback } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { TabSelectRenderable, TextareaRenderable } from "@opentui/core";
import type { GloomPlugin, PaneProps } from "../../types/plugin";
import { useAppState, useSelectedTicker } from "../../state/app-context";
import { colors, priceColor } from "../../theme/colors";
import { formatCurrency, formatCompact, formatPercent, formatPercentRaw, formatNumber } from "../../utils/format";
import { StockChart } from "../../components/chart/stock-chart";
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

  const chartWidth = Math.max((width || Math.floor(termWidth * 0.5)) - 4, 20);
  const hasHistory = (financials?.priceHistory?.length ?? 0) > 2;

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
        {hasHistory && (
          <StockChart width={chartWidth} height={8} focused={false} compact />
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

        {/* Sector info */}
        {(ticker.frontmatter.sector || ticker.frontmatter.industry) && (
          <box flexDirection="column">
            {ticker.frontmatter.sector && (
              <MetricRow label="Sector" value={ticker.frontmatter.sector} />
            )}
            {ticker.frontmatter.industry && (
              <MetricRow label="Industry" value={ticker.frontmatter.industry} />
            )}
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

function ChartTab({ width, height, focused, interactive }: { width?: number; height?: number; focused: boolean; interactive: boolean }) {
  const { width: termWidth, height: termHeight } = useTerminalDimensions();

  const chartWidth = Math.max((width || Math.floor(termWidth * 0.55)) - 2, 30);
  const chartHeight = Math.max((height || termHeight - 8) - 2, 10);

  return (
    <box flexDirection="column" paddingX={1} flexGrow={1}>
      <StockChart width={chartWidth} height={chartHeight} focused={focused} interactive={interactive} />
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
  const [chartInteractive, setChartInteractive] = useState(false);
  const tabIdx = DETAIL_TABS.findIndex((t) => t.value === state.activeRightTab);
  const tabRef = useRef<TabSelectRenderable>(null);

  // Refs to avoid stale closures in useKeyboard
  const stateRef = useRef({ focused, notesFocused, chartInteractive, activeRightTab: state.activeRightTab, tabIdx });
  stateRef.current = { focused, notesFocused, chartInteractive, activeRightTab: state.activeRightTab, tabIdx };

  // Eagerly update ref + state together so subsequent key events see the change immediately
  const setChartInteractiveEager = useCallback((val: boolean) => {
    stateRef.current = { ...stateRef.current, chartInteractive: val };
    setChartInteractive(val);
  }, []);
  const setNotesFocusedEager = useCallback((val: boolean) => {
    stateRef.current = { ...stateRef.current, notesFocused: val };
    setNotesFocused(val);
  }, []);

  useEffect(() => {
    if (tabRef.current && tabIdx >= 0) {
      tabRef.current.setSelectedIndex(tabIdx);
    }
  }, [tabIdx]);

  // Exit chart interactive mode when switching away from chart tab
  useEffect(() => {
    if (state.activeRightTab !== "chart") {
      setChartInteractive(false);
    }
  }, [state.activeRightTab]);

  useKeyboard((event) => {
    const s = stateRef.current;
    if (!s.focused) return;

    const isEnter = event.name === "enter" || event.name === "return";

    // Handle notes focus toggle
    if (s.activeRightTab === "notes") {
      if (isEnter && !s.notesFocused) {
        setNotesFocusedEager(true);
        return;
      }
      if (event.name === "escape" && s.notesFocused) {
        setNotesFocusedEager(false);
        return;
      }
      if (s.notesFocused) return;
    }

    // Handle chart interactive mode
    if (s.activeRightTab === "chart") {
      if (event.name === "escape" && s.chartInteractive) {
        setChartInteractiveEager(false);
        return;
      }
      if (isEnter && !s.chartInteractive) {
        setChartInteractiveEager(true);
        return;
      }
      // When chart is interactive, consume all keys so they don't switch tabs
      if (s.chartInteractive) return;
    }

    // Tab switching — only h/l keys, not arrow keys on chart tab
    // (arrow keys on chart tab would conflict with chart navigation)
    if (event.name === "h" || event.name === "left") {
      const newIdx = Math.max(s.tabIdx - 1, 0);
      dispatch({ type: "SET_RIGHT_TAB", tab: DETAIL_TABS[newIdx]!.value });
    } else if (event.name === "l" || event.name === "right") {
      const newIdx = Math.min(s.tabIdx + 1, DETAIL_TABS.length - 1);
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
      {state.activeRightTab === "chart" && <ChartTab width={width} height={height} focused={focused} interactive={chartInteractive} />}
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
