import { useRef, useEffect, useState, useCallback } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { TabSelectRenderable, TextareaRenderable } from "@opentui/core";
import type { GloomPlugin, PaneProps } from "../../types/plugin";
import { useAppState, useSelectedTicker } from "../../state/app-context";
import { colors, priceColor } from "../../theme/colors";
import { formatCurrency, formatCompact, formatPercent, formatPercentRaw, formatNumber, formatGrowthShort, pickUnit, formatWithDivisor } from "../../utils/format";
import { exchangeShortName, marketStateLabel, marketStateColor } from "../../utils/market-status";
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
        {/* Title with exchange and market state */}
        <box flexDirection="row">
          <text attributes={TextAttributes.BOLD} fg={colors.textBright}>
            {ticker.frontmatter.ticker}
          </text>
          <text fg={colors.textDim}>
            {" "}- {ticker.frontmatter.name || q?.name || ""}
          </text>
          {q?.exchangeName && (
            <text fg={colors.textDim}>
              {" "}({exchangeShortName(q.exchangeName, q.fullExchangeName)})
            </text>
          )}
          {q?.marketState && (
            <text fg={marketStateColor(q.marketState)}>
              {" "}{marketStateLabel(q.marketState)}
            </text>
          )}
        </box>

        {/* Price */}
        {q && (
          <box flexDirection="column" gap={0}>
            <box flexDirection="row" gap={2}>
              <text attributes={TextAttributes.BOLD} fg={priceColor(q.change)}>
                {formatCurrency(q.price, q.currency)}
              </text>
              <text fg={priceColor(q.change)}>
                {q.change >= 0 ? "+" : ""}{q.change.toFixed(2)} ({formatPercentRaw(q.changePercent)})
              </text>
            </box>
            {q.marketState === "PRE" && q.preMarketPrice != null && (
              <box flexDirection="row" gap={2}>
                <text fg={colors.textDim}>Pre-Market:</text>
                <text fg={priceColor(q.preMarketChange ?? 0)}>
                  {formatCurrency(q.preMarketPrice, q.currency)}
                </text>
                <text fg={priceColor(q.preMarketChange ?? 0)}>
                  {(q.preMarketChange ?? 0) >= 0 ? "+" : ""}{(q.preMarketChange ?? 0).toFixed(2)} ({formatPercentRaw(q.preMarketChangePercent ?? 0)})
                </text>
              </box>
            )}
            {q.marketState === "POST" && q.postMarketPrice != null && (
              <box flexDirection="row" gap={2}>
                <text fg={colors.textDim}>After-Hours:</text>
                <text fg={priceColor(q.postMarketChange ?? 0)}>
                  {formatCurrency(q.postMarketPrice, q.currency)}
                </text>
                <text fg={priceColor(q.postMarketChange ?? 0)}>
                  {(q.postMarketChange ?? 0) >= 0 ? "+" : ""}{(q.postMarketChange ?? 0).toFixed(2)} ({formatPercentRaw(q.postMarketChangePercent ?? 0)})
                </text>
              </box>
            )}
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

type MetricDef = {
  label: string;
  key: keyof import("../../types/financials").FinancialStatement;
  format: "compact" | "eps";
};

type FinancialSubTab = {
  name: string;
  key: string;
  metrics: MetricDef[];
};

const FINANCIAL_SUB_TABS: FinancialSubTab[] = [
  {
    name: "Income",
    key: "income",
    metrics: [
      { label: "Revenue", key: "totalRevenue", format: "compact" },
      { label: "Cost of Revenue", key: "costOfRevenue", format: "compact" },
      { label: "Gross Profit", key: "grossProfit", format: "compact" },
      { label: "R&D", key: "researchAndDevelopment", format: "compact" },
      { label: "SG&A", key: "sellingGeneralAndAdministration", format: "compact" },
      { label: "Operating Exp", key: "operatingExpense", format: "compact" },
      { label: "Operating Inc", key: "operatingIncome", format: "compact" },
      { label: "Interest Exp", key: "interestExpense", format: "compact" },
      { label: "Tax Provision", key: "taxProvision", format: "compact" },
      { label: "Net Income", key: "netIncome", format: "compact" },
      { label: "EBITDA", key: "ebitda", format: "compact" },
      { label: "Basic EPS", key: "basicEps", format: "eps" },
      { label: "Diluted EPS", key: "eps", format: "eps" },
      { label: "Shares Out", key: "dilutedShares", format: "compact" },
    ],
  },
  {
    name: "Cash Flow",
    key: "cashflow",
    metrics: [
      { label: "Operating CF", key: "operatingCashFlow", format: "compact" },
      { label: "CapEx", key: "capitalExpenditure", format: "compact" },
      { label: "Free Cash Flow", key: "freeCashFlow", format: "compact" },
      { label: "Investing CF", key: "investingCashFlow", format: "compact" },
      { label: "Financing CF", key: "financingCashFlow", format: "compact" },
      { label: "Debt Issuance", key: "issuanceOfDebt", format: "compact" },
      { label: "Buybacks", key: "repurchaseOfCapitalStock", format: "compact" },
      { label: "Dividends Paid", key: "cashDividendsPaid", format: "compact" },
    ],
  },
  {
    name: "Balance Sheet",
    key: "balance",
    metrics: [
      { label: "Total Assets", key: "totalAssets", format: "compact" },
      { label: "Current Assets", key: "currentAssets", format: "compact" },
      { label: "Cash & Equiv", key: "cashAndCashEquivalents", format: "compact" },
      { label: "Total Liab", key: "totalLiabilities", format: "compact" },
      { label: "Current Liab", key: "currentLiabilities", format: "compact" },
      { label: "Long-Term Debt", key: "longTermDebt", format: "compact" },
      { label: "Total Debt", key: "totalDebt", format: "compact" },
      { label: "Equity", key: "totalEquity", format: "compact" },
      { label: "Retained Earn", key: "retainedEarnings", format: "compact" },
    ],
  },
];

// Flow metrics are summed for TTM; balance sheet metrics use latest quarter value
const FLOW_KEYS = new Set<string>([
  "totalRevenue", "costOfRevenue", "grossProfit",
  "sellingGeneralAndAdministration", "researchAndDevelopment",
  "operatingExpense", "operatingIncome", "interestExpense", "taxProvision",
  "netIncome", "ebitda", "basicEps", "eps",
  "operatingCashFlow", "capitalExpenditure", "freeCashFlow",
  "investingCashFlow", "financingCashFlow",
  "issuanceOfDebt", "repurchaseOfCapitalStock", "cashDividendsPaid",
]);

const BALANCE_KEYS = new Set<string>([
  "totalAssets", "currentAssets", "cashAndCashEquivalents",
  "totalLiabilities", "currentLiabilities", "longTermDebt", "totalDebt",
  "totalEquity", "retainedEarnings", "dilutedShares",
]);

function computeTTM(quarterlyStmts: import("../../types/financials").FinancialStatement[]): import("../../types/financials").FinancialStatement | null {
  const last4 = quarterlyStmts.slice(-4);
  if (last4.length < 4) return null;

  const ttm: import("../../types/financials").FinancialStatement = { date: "TTM" };
  for (const key of FLOW_KEYS) {
    const values = last4.map((s) => (s as any)[key]).filter((v: any): v is number => v != null);
    if (values.length === 4) {
      (ttm as any)[key] = values.reduce((a: number, b: number) => a + b, 0);
    }
  }
  const latest = last4[last4.length - 1]!;
  for (const key of BALANCE_KEYS) {
    if ((latest as any)[key] != null) (ttm as any)[key] = (latest as any)[key];
  }

  return ttm;
}

function computeGrowth(current: number | undefined, previous: number | undefined): number | undefined {
  if (current == null || previous == null || previous === 0) return undefined;
  return (current - previous) / Math.abs(previous);
}

function FinancialsTab({ focused }: { focused: boolean }) {
  const { financials } = useSelectedTicker();
  const [period, setPeriod] = useState<"annual" | "quarterly">("annual");
  const [subTabIdx, setSubTabIdx] = useState(0);

  useKeyboard((event) => {
    if (!focused) return;
    if (event.name === "a") setPeriod("annual");
    else if (event.name === "q") setPeriod("quarterly");
    else if (event.name === "1") setSubTabIdx(0);
    else if (event.name === "2") setSubTabIdx(1);
    else if (event.name === "3") setSubTabIdx(2);
  });

  if (!financials) return <text fg={colors.textDim}>No financial data available.</text>;

  const subTab = FINANCIAL_SUB_TABS[subTabIdx]!;
  const isAnnual = period === "annual";
  const rawStmts = isAnnual
    ? financials.annualStatements.slice(-5).reverse()
    : financials.quarterlyStatements.slice(-6).reverse();

  const ttm = isAnnual ? computeTTM(financials.quarterlyStatements) : null;
  const displayStmts = ttm ? [ttm, ...rawStmts] : rawStmts;

  // Build previous-period lookup for growth rates
  const allStmts = isAnnual ? financials.annualStatements : financials.quarterlyStatements;
  const prevMap = new Map<string, import("../../types/financials").FinancialStatement>();
  for (let i = 0; i < allStmts.length; i++) {
    if (i > 0) prevMap.set(allStmts[i]!.date, allStmts[i - 1]!);
  }
  // TTM previous: compute from quarters 5-8 ago
  if (ttm && allStmts.length >= 8) {
    const prev4 = allStmts.slice(-8, -4);
    const prevTtm: import("../../types/financials").FinancialStatement = { date: "prevTTM" };
    for (const key of FLOW_KEYS) {
      const values = prev4.map((s) => (s as any)[key]).filter((v: any): v is number => v != null);
      if (values.length === 4) (prevTtm as any)[key] = values.reduce((a: number, b: number) => a + b, 0);
    }
    const prevLatest = prev4[prev4.length - 1]!;
    for (const key of BALANCE_KEYS) {
      if ((prevLatest as any)[key] != null) (prevTtm as any)[key] = (prevLatest as any)[key];
    }
    prevMap.set("TTM", prevTtm);
  }

  const COL_W = 18;
  const LABEL_W = 20;

  return (
    <scrollbox flexGrow={1} scrollY>
      <box flexDirection="column" paddingX={2} paddingY={1}>
        {/* Sub-tab selector + period toggle */}
        <box flexDirection="row" height={1}>
          {FINANCIAL_SUB_TABS.map((tab, i) => (
            <box key={tab.key} flexDirection="row">
              <text
                fg={i === subTabIdx ? colors.textBright : colors.textDim}
                attributes={i === subTabIdx ? TextAttributes.BOLD : 0}
              >
                {`${i + 1}:${tab.name}`}
              </text>
              {i < FINANCIAL_SUB_TABS.length - 1 && <text fg={colors.textMuted}>{" │ "}</text>}
            </box>
          ))}
          <box flexGrow={1} />
          <text fg={isAnnual ? colors.textBright : colors.textDim} attributes={isAnnual ? TextAttributes.BOLD : 0}>a</text>
          <text fg={colors.textMuted}>/</text>
          <text fg={!isAnnual ? colors.textBright : colors.textDim} attributes={!isAnnual ? TextAttributes.BOLD : 0}>q</text>
        </box>
        <box height={1} />

        {/* Column headers */}
        <box flexDirection="row" height={1}>
          <box width={LABEL_W}><text attributes={TextAttributes.BOLD} fg={colors.textDim}>{isAnnual ? "Annual" : "Quarterly"}</text></box>
          {displayStmts.map((s) => (
            <box key={s.date} width={COL_W}>
              <text attributes={TextAttributes.BOLD} fg={s.date === "TTM" ? colors.textBright : colors.textDim}>
                {s.date === "TTM" ? "TTM" : s.date.slice(0, 7)}
              </text>
            </box>
          ))}
        </box>
        <box height={1} />

        {/* Metric rows */}
        {subTab.metrics.map(({ label, key, format }, idx) => {
          const isEps = format === "eps";
          const allVals = displayStmts.map((s) => s[key] as number | undefined);
          const { suffix, divisor } = isEps ? { suffix: "", divisor: 1 } : pickUnit(allVals);
          const unitLabel = suffix ? `${label} (${suffix})` : label;

          return (
            <box key={key} flexDirection="column">
              {idx > 0 && idx % 4 === 0 && <box height={1} />}
              <box flexDirection="row" height={1}>
              <box width={LABEL_W}><text fg={colors.textDim}>{unitLabel}</text></box>
              {displayStmts.map((s) => {
                const val = s[key] as number | undefined;
                const prev = prevMap.get(s.date);
                const prevVal = prev ? (prev[key] as number | undefined) : undefined;
                const growth = computeGrowth(val, prevVal);
                const formatted = val != null
                  ? isEps ? formatNumber(val, 2) : formatWithDivisor(val, divisor)
                  : "—";
                const growthStr = growth != null ? " " + formatGrowthShort(growth) : "";
                const isNeg = val != null && val < 0;
                return (
                  <box key={s.date} width={COL_W} flexDirection="row" marginLeft={isNeg ? -1 : 0}>
                    <text fg={colors.text}>{formatted}</text>
                    {growthStr ? <text fg={priceColor(growth!)}>{growthStr}</text> : null}
                  </box>
                );
              })}
              </box>
            </box>
          );
        })}
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

  // Save helper that persists textarea text for a given ticker
  const saveNotesFor = useCallback((t: typeof ticker, text: string) => {
    if (t && text !== t.notes) {
      const updated = { ...t, notes: text };
      dispatch({ type: "UPDATE_TICKER", ticker: updated });
      if (markdownStore) {
        markdownStore.saveTicker(updated).catch(() => {});
      }
    }
  }, [dispatch, markdownStore]);

  // Save notes when unfocusing
  useEffect(() => {
    if (!notesFocused && textareaRef.current && ticker) {
      saveNotesFor(ticker, textareaRef.current.editBuffer.getText());
    }
  }, [notesFocused]);

  // When the selected ticker changes, save pending edits and load new notes
  const tickerSymbol = ticker?.frontmatter.ticker ?? null;
  const prevTickerRef = useRef(ticker);
  const prevSymbolRef = useRef(tickerSymbol);
  useEffect(() => {
    if (tickerSymbol !== prevSymbolRef.current) {
      // Save edits for the previous ticker
      if (textareaRef.current && prevTickerRef.current) {
        saveNotesFor(prevTickerRef.current, textareaRef.current.editBuffer.getText());
      }
      prevSymbolRef.current = tickerSymbol;
      prevTickerRef.current = ticker;
      // Update textarea content to new ticker's notes
      if (textareaRef.current) {
        textareaRef.current.setText(ticker?.notes || "");
      }
    }
  }, [tickerSymbol, ticker, saveNotesFor]);

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
      {state.activeRightTab === "financials" && <FinancialsTab focused={focused} />}
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
