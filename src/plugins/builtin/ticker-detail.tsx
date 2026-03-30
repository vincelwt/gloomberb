import { useRef, useEffect, useState, useCallback } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import type { GloomPlugin, PaneProps, DetailTabDef, PaneSettingsDef } from "../../types/plugin";
import type { Quote } from "../../types/financials";
import { getSharedRegistry } from "../../plugins/registry";
import { useFxRatesMap } from "../../market-data/hooks";
import { quoteSubscriptionTargetFromTicker } from "../../market-data/request-types";
import { useAppState, usePaneCollection, usePaneInstance, usePaneStateValue, usePaneTicker } from "../../state/app-context";
import { useQuoteStreaming } from "../../state/use-quote-streaming";
import { getCollectionName, getCollectionTickers } from "../../state/selectors";
import { colors, priceColor } from "../../theme/colors";
import { EmptyState, FieldRow } from "../../components";
import { TabBar } from "../../components/tab-bar";
import { convertCurrency, formatCurrency, formatCompact, formatCompactCurrency, formatPercent, formatPercentRaw, formatNumber, formatGrowthShort, pickUnit, formatWithDivisor, padTo } from "../../utils/format";
import { exchangeShortName, getActiveQuoteDisplay, marketStateLabel, marketStateColor } from "../../utils/market-status";
import { normalizeTickerInput } from "../../utils/ticker-search";
import { StockChart } from "../../components/chart/stock-chart";
import type { ChartAxisMode } from "../../components/chart/chart-types";
import type { TickerFinancials } from "../../types/financials";
import { getConfiguredIbkrGatewayInstances } from "../ibkr/instance-selection";
import { useOptionsAvailability } from "./options-availability";

const CORE_OVERVIEW_TAB = { id: "overview", name: "Overview", order: 10 };
const CORE_FINANCIALS_TAB = { id: "financials", name: "Financials", order: 20 };
const CORE_CHART_TAB = { id: "chart", name: "Chart", order: 30 };

interface TickerDetailPaneSettings {
  hideTabs: boolean;
  lockedTabId: string;
  chartAxisMode: ChartAxisMode;
}

function getTickerDetailPaneSettings(settings: Record<string, unknown> | undefined): TickerDetailPaneSettings {
  return {
    hideTabs: settings?.hideTabs === true,
    lockedTabId: typeof settings?.lockedTabId === "string" ? settings.lockedTabId : "overview",
    chartAxisMode: settings?.chartAxisMode === "percent" ? "percent" : "price",
  };
}

function resolveLockedTabId(
  settings: TickerDetailPaneSettings,
  tabs: Array<{ id: string; name: string; order: number }>,
): string {
  if (tabs.some((tab) => tab.id === settings.lockedTabId)) {
    return settings.lockedTabId;
  }
  return tabs[0]?.id ?? "overview";
}

function buildTickerDetailSettingsDef(settings: TickerDetailPaneSettings): PaneSettingsDef {
  const registry = getSharedRegistry();
  const pluginTabs = registry
    ? [...registry.detailTabs.values()].map((tab) => ({
      id: tab.id,
      name: tab.name,
      order: tab.order,
    }))
    : [];
  const tabs = [CORE_OVERVIEW_TAB, CORE_FINANCIALS_TAB, CORE_CHART_TAB, ...pluginTabs]
    .sort((left, right) => left.order - right.order)
    .filter((tab, index, allTabs) => allTabs.findIndex((candidate) => candidate.id === tab.id) === index);

  return {
    title: "Detail Pane Settings",
    fields: [
      {
        key: "hideTabs",
        label: "Hide Tabs",
        description: "Hide the detail tabs and lock this pane to one view.",
        type: "toggle" as const,
      },
      ...(settings.hideTabs ? [{
        key: "lockedTabId",
        label: "Locked Tab",
        description: "Choose which tab this pane should stay pinned to when tabs are hidden.",
        type: "select" as const,
        options: tabs.map((tab) => ({
          value: tab.id,
          label: tab.name,
        })),
      }] : []),
      {
        key: "chartAxisMode",
        label: "Chart Y-Axis",
        description: "Show chart values as raw prices or percent change from the first visible point.",
        type: "select" as const,
        options: [
          { value: "price", label: "Price" },
          { value: "percent", label: "Percent" },
        ],
      },
    ],
  };
}

function buildQuoteMonitorSettingsDef(): PaneSettingsDef {
  return {
    title: "Quote Monitor Settings",
    fields: [
      {
        key: "symbol",
        label: "Ticker",
        description: "Set the fixed ticker symbol for this quote monitor.",
        type: "text",
        placeholder: "AAPL",
      },
    ],
  };
}

function hasStatementFinancials(financials: TickerFinancials | null | undefined): boolean {
  return (financials?.annualStatements.length ?? 0) > 0 || (financials?.quarterlyStatements.length ?? 0) > 0;
}

export function buildVisibleDetailTabs(
  pluginTabs: DetailTabDef[],
  ticker: import("../../types/ticker").TickerRecord | null,
  financials: TickerFinancials | null | undefined,
  options: {
    hasIbkrGatewayTrading: boolean;
    hasOptionsChain: boolean;
  },
): Array<{ id: string; name: string; order: number }> {
  const tabs = [CORE_OVERVIEW_TAB];
  if (hasStatementFinancials(financials)) {
    tabs.push(CORE_FINANCIALS_TAB);
  }
  tabs.push(CORE_CHART_TAB);

  for (const tab of pluginTabs) {
    if (tab.isVisible && !tab.isVisible({
      ticker,
      financials,
      hasIbkrGatewayTrading: options.hasIbkrGatewayTrading,
      hasOptionsChain: options.hasOptionsChain,
    })) continue;
    if (tab.id === "ibkr-trade" && !options.hasIbkrGatewayTrading) continue;
    if (tab.id === "options" && !options.hasOptionsChain) continue;
    tabs.push({ id: tab.id, name: tab.name, order: tab.order });
  }

  return tabs.sort((a, b) => a.order - b.order);
}

function getQuoteMonitorDisplay(quote: Quote | null | undefined) {
  return getActiveQuoteDisplay(quote);
}

export function QuoteMonitorPane({ focused, width }: PaneProps) {
  const { ticker, financials } = usePaneTicker();
  const streamingTarget = quoteSubscriptionTargetFromTicker(ticker, ticker?.metadata.ticker, "provider");
  useQuoteStreaming(streamingTarget ? [streamingTarget] : []);

  if (!ticker) {
    return (
      <box flexDirection="column" flexGrow={1} paddingX={1}>
        <EmptyState title="No ticker selected." />
      </box>
    );
  }

  const display = getQuoteMonitorDisplay(financials?.quote);
  const changeColor = priceColor(display?.change ?? 0);
  const compact = width < 56;
  const currency = financials?.quote?.currency ?? ticker.metadata.currency ?? "USD";

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={colors.panel} padding={1}>
      <box
        flexGrow={1}
        border
        borderColor={focused ? colors.borderFocused : colors.border}
        backgroundColor={colors.bg}
        paddingX={compact ? 2 : 4}
        paddingY={1}
        justifyContent="center"
      >
        {!display ? (
          <box flexDirection="column" alignItems="center" justifyContent="center" gap={1} flexGrow={1}>
            <text attributes={TextAttributes.BOLD} fg={colors.textBright}>
              {ticker.metadata.ticker}
            </text>
            <text fg={colors.textDim}>Waiting for quote...</text>
          </box>
        ) : (
          <box
            flexDirection={compact ? "column" : "row"}
            alignItems={compact ? "flex-start" : "center"}
            justifyContent="space-between"
            gap={compact ? 1 : 2}
            flexGrow={1}
          >
            <box flexGrow={1} justifyContent="center">
              <text attributes={TextAttributes.BOLD} fg={colors.textBright}>
                {ticker.metadata.ticker}
              </text>
            </box>

            <box flexDirection="column" alignItems={compact ? "flex-start" : "flex-end"}>
              <text attributes={TextAttributes.BOLD} fg={changeColor}>
                {formatCurrency(display.price, currency)}
              </text>
              <box flexDirection="row" gap={1}>
                <text fg={changeColor}>{formatPercentRaw(display.changePercent)}</text>
                <text fg={changeColor}>
                  {display.change > 0 ? "+" : ""}
                  {display.change.toFixed(2)}
                </text>
              </box>
            </box>
          </box>
        )}
      </box>
    </box>
  );
}

function OverviewTab({ width }: { width?: number }) {
  const { state } = useAppState();
  const { ticker, financials } = usePaneTicker();
  const { width: termWidth } = useTerminalDimensions();
  if (!ticker) return <EmptyState title="No ticker selected." />;

  const q = financials?.quote;
  const f = financials?.fundamentals;
  const profile = financials?.profile;
  const baseCurrency = state.config.baseCurrency;
  const exchangeRates = useFxRatesMap([
    baseCurrency,
    ticker.metadata.currency,
    q?.currency,
    ...ticker.metadata.positions.map((position) => position.currency),
  ]);
  const effectiveExchangeRates = exchangeRates.size > 1 || state.exchangeRates.size === 0
    ? exchangeRates
    : state.exchangeRates;
  const quoteCurrency = q?.currency ?? ticker.metadata.currency ?? baseCurrency;
  const toBase = (value: number, fromCurrency: string) =>
    convertCurrency(value, fromCurrency, baseCurrency, effectiveExchangeRates);
  const sector = ticker.metadata.sector ?? profile?.sector;
  const industry = ticker.metadata.industry ?? profile?.industry;
  const description = profile?.description?.trim();

  const chartWidth = Math.max((width || Math.floor(termWidth * 0.5)) - 4, 20);
  const hasHistory = (financials?.priceHistory?.length ?? 0) > 2;

  return (
    <scrollbox flexGrow={1} scrollY>
      <box flexDirection="column" paddingX={1} paddingBottom={1} gap={1}>
        {/* Title with exchange and market state */}
        <box flexDirection="row">
          <text attributes={TextAttributes.BOLD} fg={colors.textBright}>
            {ticker.metadata.ticker}
          </text>
          {ticker.metadata.name && ticker.metadata.name !== ticker.metadata.ticker && (
          <text fg={colors.textDim}>
            {" "}- {ticker.metadata.name || q?.name || ""}
          </text>
          )}
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
            {(q.marketState === "PRE" || q.marketState === "PREPRE") && q.preMarketPrice != null && (
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
            {(q.marketState === "POST" || q.marketState === "POSTPOST") && q.postMarketPrice != null && (
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
          <FieldRow
            label="Market Cap"
            value={q?.marketCap ? formatCompactCurrency(toBase(q.marketCap, quoteCurrency), baseCurrency) : "—"}
          />
          <FieldRow label="P/E (TTM)" value={f?.trailingPE ? formatNumber(f.trailingPE, 1) : "—"} />
          <FieldRow label="Forward P/E" value={f?.forwardPE ? formatNumber(f.forwardPE, 1) : "—"} />
          <FieldRow label="PEG Ratio" value={f?.pegRatio ? formatNumber(f.pegRatio, 2) : "—"} />
          <FieldRow label="EPS" value={f?.eps ? formatCurrency(f.eps, quoteCurrency) : "—"} />
          <FieldRow label="Div Yield" value={f?.dividendYield != null ? formatPercent(f.dividendYield) : "—"} />
          <FieldRow label="Revenue" value={f?.revenue ? formatCompact(f.revenue) : "—"} />
          <FieldRow label="Net Income" value={f?.netIncome ? formatCompact(f.netIncome) : "—"} />
          <FieldRow label="FCF" value={f?.freeCashFlow ? formatCompact(f.freeCashFlow) : "—"} />
          <FieldRow label="Op. Margin" value={f?.operatingMargin != null ? formatPercent(f.operatingMargin) : "—"} />
          <FieldRow label="Profit Margin" value={f?.profitMargin != null ? formatPercent(f.profitMargin) : "—"} />
          {(q?.bid != null || q?.ask != null) && (
            <>
              <FieldRow label="Bid" value={q?.bid != null ? formatCurrency(q.bid, q.currency) : "—"} />
              <FieldRow label="Ask" value={q?.ask != null ? formatCurrency(q.ask, q.currency) : "—"} />
              <FieldRow
                label="Spread"
                value={q?.bid != null && q?.ask != null ? formatCurrency(q.ask - q.bid, q.currency) : "—"}
              />
            </>
          )}
          <FieldRow
            label="52W Range"
            value={q?.low52w && q?.high52w ? `${formatCurrency(q.low52w, quoteCurrency)} - ${formatCurrency(q.high52w, quoteCurrency)}` : "—"}
          />
          <FieldRow
            label="1Y Return"
            value={f?.return1Y != null ? formatPercent(f.return1Y) : "—"}
            valueColor={f?.return1Y != null ? priceColor(f.return1Y) : undefined}
          />
          <FieldRow
            label="3Y Return"
            value={f?.return3Y != null ? formatPercent(f.return3Y) : "—"}
            valueColor={f?.return3Y != null ? priceColor(f.return3Y) : undefined}
          />
        </box>

        {/* Company description */}
        {description && (
          <box flexDirection="column" paddingTop={1}>
            <box height={1}>
              <text attributes={TextAttributes.BOLD} fg={colors.textBright}>Description</text>
            </box>
            <text fg={colors.text}>{description}</text>
          </box>
        )}

        {/* Sector / classification */}
        {(sector || industry || ticker.metadata.assetCategory || ticker.metadata.isin) && (
          <box flexDirection="column">
            {ticker.metadata.assetCategory && (
              <FieldRow label="Type" value={ticker.metadata.assetCategory} />
            )}
            {sector && (
              <FieldRow label="Sector" value={sector} />
            )}
            {industry && (
              <FieldRow label="Industry" value={industry} />
            )}
            {ticker.metadata.isin && (
              <FieldRow label="ISIN" value={ticker.metadata.isin} />
            )}
          </box>
        )}

        {/* Positions */}
        {ticker.metadata.positions.length > 0 && (
          <box flexDirection="column">
            <box height={1}>
              <text attributes={TextAttributes.BOLD} fg={colors.textBright}>Positions</text>
            </box>
            {ticker.metadata.positions.map((pos, i) => {
              const costBasis = pos.shares * pos.avgCost * (pos.multiplier || 1);
              const positionCurrency = pos.currency || quoteCurrency;
              const costBasisBase = toBase(costBasis, positionCurrency);
              const marketValueBase = pos.marketValue != null
                ? toBase(pos.marketValue, positionCurrency)
                : pos.markPrice != null
                  ? toBase(Math.abs(pos.shares) * pos.markPrice * (pos.multiplier || 1), positionCurrency)
                  : q
                    ? toBase(Math.abs(pos.shares) * q.price * (pos.multiplier || 1), quoteCurrency)
                    : null;
              const pnlValue = pos.unrealizedPnl != null
                ? toBase(pos.unrealizedPnl, positionCurrency)
                : marketValueBase != null
                  ? marketValueBase - costBasisBase
                  : null;
              const pnlText = pnlValue != null
                ? `  P&L: ${pnlValue >= 0 ? "+" : ""}${formatCurrency(pnlValue, baseCurrency)}`
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
                      {pos.shares} {pos.multiplier && pos.multiplier > 1 ? "contracts" : "shares"} @ {formatCurrency(pos.avgCost, positionCurrency)}
                      {" = "}{formatCurrency(costBasisBase, baseCurrency)}
                    </text>
                    {pnlText && (
                      <text fg={priceColor(pnlValue ?? 0)}>{pnlText}</text>
                    )}
                  </box>
                  {pos.markPrice != null && (
                    <box flexDirection="row" height={1}>
                      <text fg={colors.textDim}>Mark: {formatCurrency(pos.markPrice, positionCurrency)}</text>
                      {marketValueBase != null && (
                        <text fg={colors.textDim}>{" "}Mkt Value: {formatCurrency(marketValueBase, baseCurrency)}</text>
                      )}
                    </box>
                  )}
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

const FINANCIAL_COL_W = 18;
const FINANCIAL_LABEL_W = 20;
const FINANCIAL_GROWTH_W = 7;
const FINANCIAL_VALUE_W = FINANCIAL_COL_W - FINANCIAL_GROWTH_W;

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

function formatFinancialCell(value: string, growth: number | undefined): { valueText: string; growthText: string } {
  const growthText = growth != null ? formatGrowthShort(growth) : "";
  return {
    valueText: padTo(value, FINANCIAL_VALUE_W, "right"),
    growthText: padTo(growthText ? ` ${growthText}` : "", FINANCIAL_GROWTH_W, "right"),
  };
}

function formatFinancialHeader(date: string): string {
  const label = date === "TTM" ? "TTM" : date.slice(0, 7);
  return padTo(label, FINANCIAL_COL_W, "center");
}

export function FinancialsTab({
  focused,
  headerScrollId,
  bodyScrollId,
}: {
  focused: boolean;
  headerScrollId?: string;
  bodyScrollId?: string;
}) {
  const { financials } = usePaneTicker();
  const hasAnnualStatements = (financials?.annualStatements.length ?? 0) > 0;
  const hasQuarterlyStatements = (financials?.quarterlyStatements.length ?? 0) > 0;
  const [period, setPeriod] = useState<"annual" | "quarterly">(
    hasAnnualStatements ? "annual" : "quarterly",
  );
  const [subTabIdx, setSubTabIdx] = useState(0);
  const bodyScrollRef = useRef<ScrollBoxRenderable>(null);
  const headerScrollRef = useRef<ScrollBoxRenderable>(null);

  const syncHeaderScroll = useCallback(() => {
    const body = bodyScrollRef.current;
    const header = headerScrollRef.current;
    if (body && header && header.scrollLeft !== body.scrollLeft) {
      header.scrollLeft = body.scrollLeft;
    }
  }, []);

  useKeyboard((event) => {
    if (!focused) return;
    if (event.name === "a" && hasAnnualStatements) setPeriod("annual");
    else if (event.name === "q" && hasQuarterlyStatements) setPeriod("quarterly");
    else if (event.name === "1") setSubTabIdx(0);
    else if (event.name === "2") setSubTabIdx(1);
    else if (event.name === "3") setSubTabIdx(2);
  });

  useEffect(() => {
    if (period === "annual" && !hasAnnualStatements && hasQuarterlyStatements) {
      setPeriod("quarterly");
    } else if (period === "quarterly" && !hasQuarterlyStatements && hasAnnualStatements) {
      setPeriod("annual");
    }
  }, [hasAnnualStatements, hasQuarterlyStatements, period]);

  if (!financials || (!hasAnnualStatements && !hasQuarterlyStatements)) {
    return <text fg={colors.textDim}>No financial data available.</text>;
  }

  const subTab = FINANCIAL_SUB_TABS[subTabIdx]!;
  const resolvedPeriod = period === "annual"
    ? (hasAnnualStatements || !hasQuarterlyStatements ? "annual" : "quarterly")
    : (hasQuarterlyStatements || !hasAnnualStatements ? "quarterly" : "annual");
  const isAnnual = resolvedPeriod === "annual";
  const rawStmts = isAnnual
    ? financials.annualStatements.slice(-5).reverse()
    : financials.quarterlyStatements.slice(-6).reverse();

  const ttm = isAnnual ? computeTTM(financials.quarterlyStatements) : null;
  const displayStmts = ttm ? [ttm, ...rawStmts] : rawStmts;
  const tableWidth = FINANCIAL_LABEL_W + (displayStmts.length * FINANCIAL_COL_W);

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

  useEffect(() => {
    if (headerScrollRef.current) {
      headerScrollRef.current.horizontalScrollBar.visible = false;
    }
    syncHeaderScroll();
  }, [displayStmts.length, isAnnual, subTabIdx, syncHeaderScroll]);

  useEffect(() => {
    const body = bodyScrollRef.current;
    if (!body) return;
    const hasVerticalOverflow = body.scrollHeight > body.viewport.height;
    body.verticalScrollBar.visible = hasVerticalOverflow;
    if (!hasVerticalOverflow && body.scrollTop !== 0) {
      body.scrollTo({ x: body.scrollLeft, y: 0 });
    }
  }, [displayStmts.length, isAnnual, subTabIdx, subTab.metrics.length]);

  return (
    <box flexDirection="column" flexGrow={1} paddingX={2} paddingBottom={1}>
      <box flexDirection="column">
        {/* Sub-tab selector + period toggle */}
        <box flexDirection="row" height={1}>
          {FINANCIAL_SUB_TABS.map((tab, i) => (
            <box key={tab.key} flexDirection="row" onMouseDown={() => setSubTabIdx(i)}>
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
          <box onMouseDown={() => setPeriod("annual")}>
            <text fg={isAnnual ? colors.textBright : colors.textDim} attributes={isAnnual ? TextAttributes.BOLD : 0}>a</text>
          </box>
          <text fg={colors.textMuted}>/</text>
          <box onMouseDown={() => setPeriod("quarterly")}>
            <text fg={!isAnnual ? colors.textBright : colors.textDim} attributes={!isAnnual ? TextAttributes.BOLD : 0}>q</text>
          </box>
        </box>
      </box>
      <box height={1} />

      <scrollbox
        id={headerScrollId}
        ref={headerScrollRef}
        height={1}
        scrollX
        focusable={false}
      >
        <box flexDirection="row" width={tableWidth} height={1}>
          <box width={FINANCIAL_LABEL_W}>
            <text attributes={TextAttributes.BOLD} fg={colors.textDim}>
              {isAnnual ? "Annual" : "Quarterly"}
            </text>
          </box>
          {displayStmts.map((s) => (
            <box key={s.date} width={FINANCIAL_COL_W}>
              <text attributes={TextAttributes.BOLD} fg={s.date === "TTM" ? colors.textBright : colors.textDim}>
                {formatFinancialHeader(s.date)}
              </text>
            </box>
          ))}
        </box>
      </scrollbox>
      <box height={1} />

      <scrollbox
        id={bodyScrollId}
        ref={bodyScrollRef}
        flexGrow={1}
        scrollX
        scrollY
        focusable={false}
        onMouseDown={() => queueMicrotask(syncHeaderScroll)}
        onMouseUp={() => queueMicrotask(syncHeaderScroll)}
        onMouseDrag={() => queueMicrotask(syncHeaderScroll)}
        onMouseScroll={() => queueMicrotask(syncHeaderScroll)}
      >
        <box flexDirection="column" width={tableWidth} paddingBottom={1}>
          {/* Metric rows */}
          {subTab.metrics.map(({ label, key, format }, idx) => {
            const isEps = format === "eps";
            const allVals = displayStmts.map((s) => s[key] as number | undefined);
            const { suffix, divisor } = isEps ? { suffix: "", divisor: 1 } : pickUnit(allVals);
            const unitLabel = suffix ? `${label} (${suffix})` : label;

            return (
              <box key={key} flexDirection="column" width={tableWidth}>
                {idx > 0 && idx % 4 === 0 && <box height={1} width={tableWidth} />}
                <box flexDirection="row" width={tableWidth} height={1}>
                  <box width={FINANCIAL_LABEL_W}><text fg={colors.textDim}>{unitLabel}</text></box>
                  {displayStmts.map((s) => {
                    const val = s[key] as number | undefined;
                    const prev = prevMap.get(s.date);
                    const prevVal = prev ? (prev[key] as number | undefined) : undefined;
                    const growth = computeGrowth(val, prevVal);
                    const formatted = val != null
                      ? isEps ? formatNumber(val, 2) : formatWithDivisor(val, divisor)
                      : "—";
                    const cell = formatFinancialCell(formatted, growth);
                    return (
                      <box key={s.date} width={FINANCIAL_COL_W} flexDirection="row">
                        <text fg={colors.text}>{cell.valueText}</text>
                        <text fg={growth != null ? priceColor(growth) : colors.text}>{cell.growthText}</text>
                      </box>
                    );
                  })}
                </box>
              </box>
            );
          })}
        </box>
      </scrollbox>
    </box>
  );
}

function ChartTab({
  width,
  height,
  focused,
  interactive,
  axisMode,
  onActivate,
}: {
  width?: number;
  height?: number;
  focused: boolean;
  interactive: boolean;
  axisMode: ChartAxisMode;
  onActivate?: () => void;
}) {
  const { width: termWidth, height: termHeight } = useTerminalDimensions();

  const chartWidth = Math.max((width || Math.floor(termWidth * 0.55)) - 2, 30);
  const chartHeight = Math.max((height || termHeight - 8) - 2, 10);

  return (
    <box flexDirection="column" paddingX={1} flexGrow={1} onMouseDown={() => { if (!interactive && onActivate) onActivate(); }}>
      <StockChart width={chartWidth} height={chartHeight} focused={focused} interactive={interactive} axisMode={axisMode} />
    </box>
  );
}


function TickerDetailPane({ focused, width, height }: PaneProps) {
  const { state, dispatch } = useAppState();
  const paneInstance = usePaneInstance();
  const { ticker, financials } = usePaneTicker();
  const streamingTarget = quoteSubscriptionTargetFromTicker(ticker, ticker?.metadata.ticker, "provider");
  useQuoteStreaming(streamingTarget ? [streamingTarget] : []);
  const { collectionId } = usePaneCollection();
  const [activeTabId, setActiveTabId] = usePaneStateValue<string>("activeTabId", "overview");
  const [chartInteractive, setChartInteractive] = useState(false);
  const [pluginCaptured, setPluginCaptured] = useState(false);
  const paneSettings = getTickerDetailPaneSettings(paneInstance?.settings);
  const hasOptionsChain = useOptionsAvailability(ticker);
  const collectionTickers = getCollectionTickers(state, collectionId);
  const collectionName = getCollectionName(state, collectionId);

  // Build dynamic tab list: core tabs + enabled plugin tabs
  const disabledPlugins = state.config.disabledPlugins || [];
  const registry = getSharedRegistry();
  const pluginTabs: DetailTabDef[] = registry
    ? [...registry.detailTabs.values()].filter((t) => !disabledPlugins.includes(t.id))
    : [];
  const hasIbkrGatewayTrading = getConfiguredIbkrGatewayInstances(state.config).length > 0;

  const allTabs = buildVisibleDetailTabs(pluginTabs, ticker, financials, {
    hasIbkrGatewayTrading,
    hasOptionsChain,
  });
  const resolvedTabId = paneSettings.hideTabs
    ? resolveLockedTabId(paneSettings, allTabs)
    : (allTabs.some((tab) => tab.id === activeTabId) ? activeTabId : (allTabs[0]?.id ?? "overview"));
  const visiblePluginTabs = pluginTabs.filter((tab) => allTabs.some((visibleTab) => visibleTab.id === tab.id));

  const tabIdx = Math.max(0, allTabs.findIndex((tab) => tab.id === resolvedTabId));
  const isPluginTab = visiblePluginTabs.some((tab) => tab.id === resolvedTabId);
  const activePluginTab = isPluginTab ? visiblePluginTabs.find((tab) => tab.id === resolvedTabId) : null;

  // Refs to avoid stale closures in useKeyboard
  const allTabsRef = useRef(allTabs);
  allTabsRef.current = allTabs;
  const stateRef = useRef({
    focused,
    chartInteractive,
    pluginCaptured,
    activeTabId: resolvedTabId,
    tabIdx,
    allTabCount: allTabs.length,
    hideTabs: paneSettings.hideTabs,
  });
  stateRef.current = {
    focused,
    chartInteractive,
    pluginCaptured,
    activeTabId: resolvedTabId,
    tabIdx,
    allTabCount: allTabs.length,
    hideTabs: paneSettings.hideTabs,
  };

  const setChartInteractiveEager = useCallback((val: boolean) => {
    stateRef.current = { ...stateRef.current, chartInteractive: val };
    setChartInteractive(val);
  }, []);

  const handlePluginCapture = useCallback((capturing: boolean) => {
    stateRef.current = { ...stateRef.current, pluginCaptured: capturing };
    setPluginCaptured(capturing);
    dispatch({ type: "SET_INPUT_CAPTURED", captured: capturing });
  }, [dispatch]);

  // Exit chart interactive mode when switching away from chart tab
  useEffect(() => {
    if (resolvedTabId !== "chart") {
      setChartInteractive(false);
    }
    // Reset plugin capture when switching tabs
    setPluginCaptured(false);
    dispatch({ type: "SET_INPUT_CAPTURED", captured: false });
  }, [resolvedTabId, dispatch]);

  useEffect(() => {
    if (resolvedTabId !== activeTabId) {
      setActiveTabId(resolvedTabId);
    }
  }, [activeTabId, resolvedTabId, setActiveTabId]);

  const handleKeyboard = useCallback((event: { name?: string }) => {
    const s = stateRef.current;
    if (!s.focused) return;

    // If a plugin tab is capturing keyboard, don't handle tab switching
    if (s.pluginCaptured) return;

    // Handle chart interactive mode
    if (s.activeTabId === "chart") {
      const isEnter = event.name === "enter" || event.name === "return";
      if (event.name === "escape" && s.chartInteractive) {
        setChartInteractiveEager(false);
        return;
      }
      if (isEnter && !s.chartInteractive) {
        setChartInteractiveEager(true);
        return;
      }
      if (s.chartInteractive) return;
    }

    // Tab switching
    const tabs = allTabsRef.current;
    if (s.hideTabs) return;

    if (event.name === "h" || event.name === "left") {
      const newIdx = Math.max(s.tabIdx - 1, 0);
      setActiveTabId(tabs[newIdx]!.id);
    } else if (event.name === "l" || event.name === "right") {
      const newIdx = Math.min(s.tabIdx + 1, s.allTabCount - 1);
      setActiveTabId(tabs[newIdx]!.id);
    }
  }, [setActiveTabId, setChartInteractiveEager]);

  useKeyboard(handleKeyboard);


  if (!ticker) {
    const isEmptyFollowCollection = paneInstance?.binding?.kind === "follow" && !!collectionId && collectionTickers.length === 0;
    const message = isEmptyFollowCollection
      ? `No tickers in ${collectionName || "this collection"}.`
      : "No ticker selected.";

    return (
      <box flexDirection="column" flexGrow={1} paddingX={1}>
        <EmptyState title={message} />
      </box>
    );
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      {!paneSettings.hideTabs && (
        <TabBar
          tabs={allTabs.map((tab) => ({ label: tab.name, value: tab.id }))}
          activeValue={resolvedTabId}
          onSelect={setActiveTabId}
        />
      )}

      {resolvedTabId === "overview" && <OverviewTab width={width} />}
      {resolvedTabId === "financials" && <FinancialsTab focused={focused} />}
      {resolvedTabId === "chart" && (
        <ChartTab
          width={width}
          height={height}
          focused={focused}
          interactive={chartInteractive}
          axisMode={paneSettings.chartAxisMode}
          onActivate={() => setChartInteractiveEager(true)}
        />
      )}

      {/* Dynamic plugin tabs */}
      {activePluginTab && (
        <activePluginTab.component
          width={width}
          height={height}
          focused={focused}
          onCapture={handlePluginCapture}
        />
      )}
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
      defaultMode: "floating",
      settings: (context) => buildTickerDetailSettingsDef(getTickerDetailPaneSettings(context.settings)),
    },
    {
      id: "quote-monitor",
      name: "Quote Monitor",
      icon: "Q",
      component: QuoteMonitorPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 64, height: 8 },
      settings: buildQuoteMonitorSettingsDef(),
    },
  ],
  paneTemplates: [
    {
      id: "new-ticker-detail-pane",
      paneId: "ticker-detail",
      label: "New Ticker Detail Pane",
      description: "Open another detail pane for the selected ticker or current collection",
      keywords: ["new", "ticker", "detail", "pane", "inspector"],
      canCreate: (context) => context.activeTicker !== null || context.activeCollectionId !== null,
      createInstance: (context) => (
        context.activeTicker
          ? {
            title: context.activeTicker,
            binding: { kind: "fixed", symbol: context.activeTicker },
          }
          : {}
      ),
    },
    {
      id: "quote-monitor-pane",
      paneId: "quote-monitor",
      label: "Quote Monitor",
      description: "Open a compact quote monitor for the selected ticker",
      keywords: ["quote", "monitor", "price", "ticker", "pane"],
      shortcut: { prefix: "QQ", argPlaceholder: "ticker" },
      canCreate: (context, options) => (options?.symbol ?? normalizeTickerInput(context.activeTicker, options?.arg)) !== null,
      createInstance: (context, options) => {
        const ticker = options?.symbol ?? normalizeTickerInput(context.activeTicker, options?.arg);
        return ticker
          ? {
            title: ticker,
            binding: { kind: "fixed", symbol: ticker },
            settings: { symbol: ticker },
            placement: "floating",
          }
          : null;
      },
    },
  ],
};
