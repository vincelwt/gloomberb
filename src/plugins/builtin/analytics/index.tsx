import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { DataTable, TabBar, type DataTableColumn } from "../../../components";
import type { GloomPlugin, PaneProps } from "../../../types/plugin";
import type { ColumnConfig } from "../../../types/config";
import type { TickerFinancials } from "../../../types/financials";
import type { Portfolio, TickerRecord } from "../../../types/ticker";
import { colors, priceColor } from "../../../theme/colors";
import { formatCompact, formatNumber, formatPercentRaw } from "../../../utils/format";
import {
  getFocusedCollectionId,
  useAppSelector,
  usePaneInstance,
  usePaneStateValue,
} from "../../../state/app-context";
import { getCollectionTickers } from "../../../state/selectors";
import { useChartQueries, useFxRatesMap, useTickerFinancialsMap } from "../../../market-data/hooks";
import { instrumentFromTicker, type ChartRequest } from "../../../market-data/request-types";
import { buildChartKey } from "../../../market-data/selectors";
import { selectEffectiveExchangeRates } from "../../../utils/exchange-rate-map";
import { usePortfolioAccountState } from "../portfolio-list/header";
import { calculatePortfolioSummaryTotals, getSortValue, type ColumnContext } from "../portfolio-list/metrics";
import {
  computeDatedBeta,
  computeDatedReturns,
  computeSharpeRatio,
  computeWeightedPortfolioReturns,
  hasPortfolioPosition,
  type WeightedReturnSeries,
} from "./metrics";

type SectorColumnId = "sector" | "weight" | "value" | "pnl" | "return" | "bar";

interface SectorTableColumn extends DataTableColumn {
  id: SectorColumnId;
}

interface SectorTableRow {
  id: string;
  sector: string;
  weight: number;
  value: number;
  pnl: number;
  returnPct: number | null;
  costBasis: number;
}

interface AnalyticsMetricRow {
  id: string;
  label: string;
  value: string;
  detail?: string;
  color?: string;
}

interface SectorSortPreference {
  columnId: SectorColumnId | null;
  direction: "asc" | "desc";
}

interface PortfolioChartTarget {
  ticker: TickerRecord;
  request: ChartRequest;
}

const DEFAULT_SECTOR_SORT: SectorSortPreference = {
  columnId: "weight",
  direction: "desc",
};

const PORTFOLIO_VALUE_COLUMN: ColumnConfig = { id: "mkt_value", label: "VALUE", width: 10, align: "right" };
const PORTFOLIO_PNL_COLUMN: ColumnConfig = { id: "pnl", label: "P&L", width: 10, align: "right" };
const PORTFOLIO_COST_COLUMN: ColumnConfig = { id: "cost_basis", label: "COST", width: 10, align: "right" };

function sharpeColor(sharpe: number): string {
  if (sharpe > 1) return colors.positive;
  if (sharpe < 0) return colors.negative;
  return colors.textDim;
}

function sharpeLabel(sharpe: number): string {
  if (sharpe > 1) return "good";
  if (sharpe >= 0) return "okay";
  return "poor";
}

function betaLabel(beta: number): string {
  if (beta > 1.2) return "high vol";
  if (beta >= 0.8) return "market";
  return "defensive";
}

function betaColor(beta: number): string {
  if (beta > 1.2) return colors.negative;
  if (beta >= 0.8) return colors.textMuted ?? colors.text;
  return colors.positive;
}

function renderBar(weight: number, maxWidth: number): string {
  const filled = Math.round(weight * maxWidth);
  return "█".repeat(Math.min(filled, maxWidth));
}

function resolvePortfolioId(portfolios: Portfolio[], portfolioId: string | null | undefined): string | null {
  if (!portfolioId) return null;
  return portfolios.some((portfolio) => portfolio.id === portfolioId) ? portfolioId : null;
}

function resolveTemplatePortfolioId(portfolios: Portfolio[], activeCollectionId: string | null): string | null {
  return resolvePortfolioId(portfolios, activeCollectionId) ?? portfolios[0]?.id ?? null;
}

function formatSignedCompact(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatCompact(value)}`;
}

function formatWeight(weight: number): string {
  return `${(weight * 100).toFixed(1)}%`;
}

function buildSectorColumns(width: number): SectorTableColumn[] {
  const sectorWidth = Math.max(12, Math.min(22, Math.floor(width * 0.28)));
  const weightWidth = 8;
  const valueWidth = 10;
  const pnlWidth = 10;
  const returnWidth = 8;
  const barWidth = Math.max(8, width - sectorWidth - weightWidth - valueWidth - pnlWidth - returnWidth - 10);

  return [
    { id: "sector", label: "SECTOR", width: sectorWidth, align: "left" },
    { id: "weight", label: "WEIGHT", width: weightWidth, align: "right" },
    { id: "value", label: "VALUE", width: valueWidth, align: "right" },
    { id: "pnl", label: "P&L", width: pnlWidth, align: "right" },
    { id: "return", label: "RETURN", width: returnWidth, align: "right" },
    { id: "bar", label: "ALLOCATION", width: barWidth, align: "left" },
  ];
}

function getSectorSortValue(row: SectorTableRow, columnId: SectorColumnId): string | number {
  switch (columnId) {
    case "sector":
      return row.sector;
    case "value":
      return row.value;
    case "pnl":
      return row.pnl;
    case "return":
      return row.returnPct ?? Number.NEGATIVE_INFINITY;
    case "bar":
    case "weight":
      return row.weight;
  }
}

function buildTrackedCurrencies(
  tickers: TickerRecord[],
  financialsMap: Map<string, TickerFinancials>,
  baseCurrency: string,
): string[] {
  const currencies = new Set<string>([baseCurrency]);

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

  return [...currencies];
}

function buildSectorRowsFromPortfolioColumns(
  tickers: TickerRecord[],
  financialsMap: Map<string, TickerFinancials>,
  columnContext: ColumnContext,
): SectorTableRow[] {
  const sectorMap = new Map<string, {
    sector: string;
    value: number;
    pnl: number;
    costBasis: number;
  }>();

  for (const ticker of tickers) {
    const financials = financialsMap.get(ticker.metadata.ticker);
    const value = getSortValue(PORTFOLIO_VALUE_COLUMN, ticker, financials, columnContext);
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;

    const pnl = getSortValue(PORTFOLIO_PNL_COLUMN, ticker, financials, columnContext);
    const costBasis = getSortValue(PORTFOLIO_COST_COLUMN, ticker, financials, columnContext);
    const sector = ticker.metadata.sector || financials?.profile?.sector || "Unknown";
    const current = sectorMap.get(sector) ?? {
      sector,
      value: 0,
      pnl: 0,
      costBasis: 0,
    };

    current.value += value;
    current.pnl += typeof pnl === "number" && Number.isFinite(pnl) ? pnl : 0;
    current.costBasis += typeof costBasis === "number" && Number.isFinite(costBasis) ? costBasis : 0;
    sectorMap.set(sector, current);
  }

  const totalValue = [...sectorMap.values()].reduce((sum, row) => sum + row.value, 0);
  if (totalValue === 0) return [];

  return [...sectorMap.values()]
    .map((row) => ({
      ...row,
      id: row.sector,
      weight: row.value / totalValue,
      returnPct: row.costBasis !== 0 ? (row.pnl / row.costBasis) * 100 : null,
    }))
    .sort((left, right) => right.weight - left.weight || left.sector.localeCompare(right.sector));
}

function sortSectorRows(rows: SectorTableRow[], sort: SectorSortPreference): SectorTableRow[] {
  const columnId = sort.columnId;
  if (!columnId) return rows;

  return [...rows].sort((left, right) => {
    const leftValue = getSectorSortValue(left, columnId);
    const rightValue = getSectorSortValue(right, columnId);
    const comparison = typeof leftValue === "string" && typeof rightValue === "string"
      ? leftValue.localeCompare(rightValue)
      : (leftValue as number) - (rightValue as number);
    return sort.direction === "asc" ? comparison : -comparison;
  });
}

function nextSectorSortPreference(current: SectorSortPreference, columnId: string): SectorSortPreference {
  const nextColumnId = columnId as SectorColumnId;
  if (current.columnId !== nextColumnId) {
    return { columnId: nextColumnId, direction: "asc" };
  }
  if (current.direction === "asc") {
    return { columnId: nextColumnId, direction: "desc" };
  }
  return { columnId: null, direction: "asc" };
}

export function PortfolioAnalyticsPane({ focused, width, height }: PaneProps) {
  const state = useAppSelector((s) => s);
  const paneInstance = usePaneInstance();
  const focusedCollectionId = getFocusedCollectionId(state);
  const portfolios = state.config.portfolios;
  const requestedPortfolioId = paneInstance?.params?.portfolioId ?? paneInstance?.params?.collectionId;
  const fallbackPortfolioId = useMemo(
    () => (
      resolvePortfolioId(portfolios, requestedPortfolioId)
      ?? resolveTemplatePortfolioId(portfolios, focusedCollectionId)
      ?? ""
    ),
    [focusedCollectionId, portfolios, requestedPortfolioId],
  );

  const [currentPortfolioId, setCurrentPortfolioId] = usePaneStateValue<string>("portfolioId", fallbackPortfolioId);
  const [selectedSectorId, setSelectedSectorId] = useState<string | null>(null);
  const [hoveredSectorIdx, setHoveredSectorIdx] = useState<number | null>(null);
  const [sectorSort, setSectorSort] = useState<SectorSortPreference>(DEFAULT_SECTOR_SORT);

  const sectorScrollRef = useRef<ScrollBoxRenderable>(null);
  const sectorHeaderScrollRef = useRef<ScrollBoxRenderable>(null);

  const activePortfolioId = resolvePortfolioId(portfolios, currentPortfolioId) ?? fallbackPortfolioId;
  const activePortfolio = useMemo(
    () => portfolios.find((portfolio) => portfolio.id === activePortfolioId) ?? null,
    [activePortfolioId, portfolios],
  );
  const activePortfolioIndex = portfolios.findIndex((portfolio) => portfolio.id === activePortfolioId);
  const portfolioTabs = useMemo(
    () => portfolios.map((portfolio) => ({ label: portfolio.name, value: portfolio.id })),
    [portfolios],
  );

  const handlePortfolioSelect = useCallback((portfolioId: string) => {
    setCurrentPortfolioId(portfolioId);
    setSelectedSectorId(null);
    setHoveredSectorIdx(null);
    sectorScrollRef.current?.scrollTo(0);
  }, [setCurrentPortfolioId]);

  const portfolioTickers = useMemo(() => {
    if (!activePortfolioId) return [];
    return getCollectionTickers(state, activePortfolioId)
      .filter((ticker) => hasPortfolioPosition(ticker, activePortfolioId));
  }, [activePortfolioId, state]);

  const chartTargets = useMemo<PortfolioChartTarget[]>(
    () => portfolioTickers.flatMap((ticker) => {
      const instrument = instrumentFromTicker(ticker, ticker.metadata.ticker);
      if (!instrument) return [];
      return [{
        ticker,
        request: {
          instrument,
          bufferRange: "1Y" as const,
          granularity: "range" as const,
        },
      }];
    }),
    [portfolioTickers],
  );
  const chartRequests = useMemo(
    () => chartTargets.map((target) => target.request),
    [chartTargets],
  );
  const chartEntries = useChartQueries(chartRequests);

  const spyRequest = useMemo(
    () => ({
      instrument: { symbol: "SPY", exchange: "" },
      bufferRange: "1Y" as const,
      granularity: "range" as const,
    }),
    [],
  );
  const spyChartRequests = useMemo(() => [spyRequest], [spyRequest]);
  const spyChartEntries = useChartQueries(spyChartRequests);

  const marketFinancials = useTickerFinancialsMap(portfolioTickers);
  const financials = useMemo(() => {
    const merged = new Map(state.financials);
    for (const [symbol, data] of marketFinancials) {
      merged.set(symbol, data);
    }
    return merged;
  }, [marketFinancials, state.financials]);
  const accountState = usePortfolioAccountState(activePortfolio, state);
  const trackedCurrencies = useMemo(
    () => buildTrackedCurrencies(portfolioTickers, financials, state.config.baseCurrency),
    [financials, portfolioTickers, state.config.baseCurrency],
  );
  const fetchedExchangeRates = useFxRatesMap(trackedCurrencies);
  const effectiveExchangeRates = selectEffectiveExchangeRates(fetchedExchangeRates, state.exchangeRates);
  const columnContext = useMemo<ColumnContext>(() => ({
    activeTab: activePortfolioId || undefined,
    baseCurrency: state.config.baseCurrency,
    exchangeRates: effectiveExchangeRates,
    now: Date.now(),
  }), [activePortfolioId, effectiveExchangeRates, state.config.baseCurrency]);

  const portfolioStats = useMemo(
    () => calculatePortfolioSummaryTotals(
      portfolioTickers,
      financials,
      state.config.baseCurrency,
      effectiveExchangeRates,
      true,
      activePortfolioId || null,
    ),
    [activePortfolioId, effectiveExchangeRates, financials, portfolioTickers, state.config.baseCurrency],
  );

  const portfolioReturnSeries = useMemo(() => {
    const weightedSeries: WeightedReturnSeries[] = [];
    for (const { ticker, request } of chartTargets) {
      const key = buildChartKey(request);
      const entry = chartEntries.get(key);
      const history = entry?.data ?? entry?.lastGoodData ?? null;
      if (!history || history.length < 11) continue;

      const returns = computeDatedReturns(history);
      if (returns.length < 10) continue;

      const value = getSortValue(PORTFOLIO_VALUE_COLUMN, ticker, financials.get(ticker.metadata.ticker), columnContext);
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
      weightedSeries.push({ weight: value, returns });
    }
    const returns = computeWeightedPortfolioReturns(weightedSeries);
    return returns.length > 0 ? returns : null;
  }, [chartEntries, chartTargets, columnContext, financials]);

  const portfolioReturns = useMemo(
    () => portfolioReturnSeries?.map((point) => point.value) ?? null,
    [portfolioReturnSeries],
  );

  const spyReturnSeries = useMemo(() => {
    const spyKey = buildChartKey(spyRequest);
    const entry = spyChartEntries.get(spyKey);
    const history = entry?.data ?? entry?.lastGoodData ?? null;
    if (!history || history.length < 11) return null;
    const returns = computeDatedReturns(history);
    return returns.length > 0 ? returns : null;
  }, [spyChartEntries, spyRequest]);

  const sharpe = useMemo(
    () => (portfolioReturns ? computeSharpeRatio(portfolioReturns) : null),
    [portfolioReturns],
  );

  const beta = useMemo(
    () => (portfolioReturnSeries && spyReturnSeries ? computeDatedBeta(portfolioReturnSeries, spyReturnSeries) : null),
    [portfolioReturnSeries, spyReturnSeries],
  );

  const sectorRows = useMemo<SectorTableRow[]>(
    () => buildSectorRowsFromPortfolioColumns(portfolioTickers, financials, columnContext),
    [columnContext, financials, portfolioTickers],
  );
  const sortedSectorRows = useMemo(
    () => sortSectorRows(sectorRows, sectorSort),
    [sectorRows, sectorSort],
  );
  const effectiveSelectedSectorId = selectedSectorId && sortedSectorRows.some((row) => row.id === selectedSectorId)
    ? selectedSectorId
    : sortedSectorRows[0]?.id ?? null;
  const selectedSectorIdx = sortedSectorRows.findIndex((row) => row.id === effectiveSelectedSectorId);
  const safeSelectedSectorIdx = selectedSectorIdx >= 0 ? selectedSectorIdx : 0;
  const sectorColumns = useMemo(() => buildSectorColumns(width), [width]);
  const hasPositions = portfolioTickers.length > 0;

  const summaryRows = useMemo<AnalyticsMetricRow[]>(() => {
    const rows: AnalyticsMetricRow[] = [];
    const account = accountState?.account;

    if (account?.netLiquidation != null) {
      rows.push({
        id: "net-liquidation",
        label: "Net Liq",
        value: formatCompact(account.netLiquidation),
        color: colors.text,
      });
    }

    rows.push({
      id: "total-value",
      label: "Val",
      value: formatCompact(portfolioStats.totalMktValue),
      color: colors.text,
    });

    if (account?.totalCashValue != null) {
      rows.push({
        id: "cash",
        label: "Cash",
        value: formatCompact(account.totalCashValue),
        color: colors.text,
      });
    }

    rows.push({
      id: "day-pnl",
      label: "Day",
      value: formatSignedCompact(portfolioStats.dailyPnl),
      detail: `(${formatPercentRaw(portfolioStats.dailyPnlPct)})`,
      color: priceColor(portfolioStats.dailyPnl),
    });
    rows.push({
      id: "pnl",
      label: "P&L",
      value: formatSignedCompact(portfolioStats.unrealizedPnl),
      detail: `(${formatPercentRaw(portfolioStats.unrealizedPnlPct)})`,
      color: priceColor(portfolioStats.unrealizedPnl),
    });

    if (account?.settledCash != null) {
      rows.push({
        id: "settled-cash",
        label: "Settled",
        value: formatCompact(account.settledCash),
        color: colors.text,
      });
    }
    if (account?.availableFunds != null) {
      rows.push({
        id: "available-funds",
        label: "Avail",
        value: formatCompact(account.availableFunds),
        color: colors.text,
      });
    }
    if (account?.excessLiquidity != null) {
      rows.push({
        id: "excess-liquidity",
        label: "Excess",
        value: formatCompact(account.excessLiquidity),
        color: colors.text,
      });
    }
    if (account?.buyingPower != null) {
      rows.push({
        id: "buying-power",
        label: "BP",
        value: formatCompact(account.buyingPower),
        color: colors.text,
      });
    }
    if (accountState) {
      rows.push({
        id: "account-source",
        label: "Source",
        value: accountState.sourceLabel,
        color: colors.textDim,
      });
    }

    return rows;
  }, [
    accountState,
    portfolioStats.dailyPnl,
    portfolioStats.dailyPnlPct,
    portfolioStats.totalMktValue,
    portfolioStats.unrealizedPnl,
    portfolioStats.unrealizedPnlPct,
  ]);

  const riskRows = useMemo<AnalyticsMetricRow[]>(() => [
    sharpe !== null
      ? {
        id: "sharpe",
        label: "Sharpe Ratio",
        value: formatNumber(sharpe, 2),
        detail: sharpeLabel(sharpe),
        color: sharpeColor(sharpe),
      }
      : {
        id: "sharpe",
        label: "Sharpe Ratio",
        value: "—",
        detail: "insufficient data",
        color: colors.textMuted,
      },
    beta !== null
      ? {
        id: "beta",
        label: "Beta (SPY)",
        value: formatNumber(beta, 2),
        detail: betaLabel(beta),
        color: betaColor(beta),
      }
      : {
        id: "beta",
        label: "Beta (SPY)",
        value: "—",
        detail: "insufficient data",
        color: colors.textMuted,
      },
  ], [beta, sharpe]);
  const metricsHeight = summaryRows.length + riskRows.length + 5;

  const syncSectorHeaderScroll = useCallback(() => {
    const bodyScrollBox = sectorScrollRef.current;
    const headerScrollBox = sectorHeaderScrollRef.current;
    if (bodyScrollBox && headerScrollBox && headerScrollBox.scrollLeft !== bodyScrollBox.scrollLeft) {
      headerScrollBox.scrollLeft = bodyScrollBox.scrollLeft;
    }
  }, []);

  const handleSectorBodyScrollActivity = useCallback(() => {
    syncSectorHeaderScroll();
  }, [syncSectorHeaderScroll]);

  const handleSectorHeaderClick = useCallback((columnId: string) => {
    setSectorSort((current) => nextSectorSortPreference(current, columnId));
  }, []);

  useKeyboard((event) => {
    if (!focused) return;

    const key = event.name;
    if ((key === "h" || key === "left") && activePortfolioIndex > 0) {
      const previousPortfolio = portfolios[activePortfolioIndex - 1];
      if (previousPortfolio) handlePortfolioSelect(previousPortfolio.id);
      return;
    }
    if ((key === "l" || key === "right") && activePortfolioIndex >= 0 && activePortfolioIndex < portfolios.length - 1) {
      const nextPortfolio = portfolios[activePortfolioIndex + 1];
      if (nextPortfolio) handlePortfolioSelect(nextPortfolio.id);
      return;
    }
    if (key === "j" || key === "down") {
      const nextRow = sortedSectorRows[Math.min(safeSelectedSectorIdx + 1, sortedSectorRows.length - 1)];
      if (nextRow) setSelectedSectorId(nextRow.id);
      return;
    }
    if (key === "k" || key === "up") {
      const nextRow = sortedSectorRows[Math.max(safeSelectedSectorIdx - 1, 0)];
      if (nextRow) setSelectedSectorId(nextRow.id);
    }
  });

  useEffect(() => {
    if (activePortfolioId !== currentPortfolioId) {
      setCurrentPortfolioId(activePortfolioId);
    }
  }, [activePortfolioId, currentPortfolioId, setCurrentPortfolioId]);

  useEffect(() => {
    if (sectorHeaderScrollRef.current) {
      sectorHeaderScrollRef.current.horizontalScrollBar.visible = false;
    }
    syncSectorHeaderScroll();
  }, [syncSectorHeaderScroll]);

  useEffect(() => {
    const scrollBox = sectorScrollRef.current;
    if (!scrollBox || selectedSectorIdx < 0) return;

    const viewportHeight = scrollBox.viewport.height;
    if (selectedSectorIdx < scrollBox.scrollTop) {
      scrollBox.scrollTo(selectedSectorIdx);
    } else if (selectedSectorIdx >= scrollBox.scrollTop + viewportHeight) {
      scrollBox.scrollTo(selectedSectorIdx - viewportHeight + 1);
    }
  }, [selectedSectorIdx]);

  return (
    <box flexDirection="column" width={width} height={height}>
      {portfolioTabs.length === 0 ? (
        <box paddingX={1} paddingY={1}>
          <text fg={colors.textMuted}>No portfolios found</text>
        </box>
      ) : (
        <>
          <box flexDirection="row" height={1}>
            <box flexShrink={1} overflow="hidden">
              <TabBar
                tabs={portfolioTabs}
                activeValue={activePortfolioId}
                onSelect={handlePortfolioSelect}
                compact
              />
            </box>
          </box>

          {!hasPositions ? (
            <box paddingX={1} paddingY={1}>
              <text fg={colors.textMuted}>
                No positions found for {activePortfolio?.name ?? "this portfolio"}
              </text>
            </box>
          ) : (
            <>
              <box flexDirection="column" height={metricsHeight} paddingX={1} paddingTop={1}>
                <box height={1}>
                  <text fg={colors.textDim} attributes={TextAttributes.BOLD}>
                    Summary
                  </text>
                </box>
                {summaryRows.map((row) => (
                  <box key={row.id} flexDirection="row" height={1}>
                    <box width={14} flexShrink={0}>
                      <text fg={colors.textDim}>{row.label}</text>
                    </box>
                    <text fg={row.color ?? colors.text} attributes={TextAttributes.BOLD}>
                      {row.value}
                    </text>
                    {row.detail && <text fg={colors.textDim}>{`  ${row.detail}`}</text>}
                  </box>
                ))}

                <box height={1} />
                <box height={1}>
                  <text fg={colors.textDim} attributes={TextAttributes.BOLD}>
                    Risk / Return
                  </text>
                </box>
                {riskRows.map((row) => (
                  <box key={row.id} flexDirection="row" height={1}>
                    <box width={14} flexShrink={0}>
                      <text fg={colors.textDim}>{row.label}</text>
                    </box>
                    <text fg={row.color ?? colors.text} attributes={TextAttributes.BOLD}>
                      {row.value}
                    </text>
                    {row.detail && <text fg={colors.textDim}>{`  ${row.detail}`}</text>}
                  </box>
                ))}
                <box height={1} />
              </box>

              <box height={1} paddingX={1}>
                <text fg={colors.textDim} attributes={TextAttributes.BOLD}>
                  Sector Allocation
                </text>
              </box>

              <DataTable<SectorTableRow, SectorTableColumn>
                columns={sectorColumns}
                items={sortedSectorRows}
                sortColumnId={sectorSort.columnId}
                sortDirection={sectorSort.direction}
                onHeaderClick={handleSectorHeaderClick}
                headerScrollRef={sectorHeaderScrollRef}
                scrollRef={sectorScrollRef}
                syncHeaderScroll={syncSectorHeaderScroll}
                onBodyScrollActivity={handleSectorBodyScrollActivity}
                hoveredIdx={hoveredSectorIdx}
                setHoveredIdx={setHoveredSectorIdx}
                getItemKey={(row) => row.id}
                isSelected={(row) => effectiveSelectedSectorId === row.id}
                onSelect={(row) => setSelectedSectorId(row.id)}
                emptyStateTitle="No sector data available"
                emptyStateHint="Load profile data or add sectors to the portfolio positions."
                renderCell={(row, column) => {
                  switch (column.id) {
                    case "sector":
                      return { text: row.sector };
                    case "weight":
                      return { text: formatWeight(row.weight) };
                    case "value":
                      return { text: formatCompact(row.value) };
                    case "pnl":
                      return {
                        text: formatSignedCompact(row.pnl),
                        color: priceColor(row.pnl),
                      };
                    case "return":
                      return {
                        text: row.returnPct == null ? "—" : formatPercentRaw(row.returnPct),
                        color: row.returnPct == null ? colors.textMuted : priceColor(row.returnPct),
                      };
                    case "bar":
                      return {
                        text: renderBar(row.weight, column.width),
                        color: colors.textMuted,
                      };
                  }
                }}
              />
            </>
          )}
        </>
      )}
    </box>
  );
}

export const analyticsPlugin: GloomPlugin = {
  id: "analytics",
  name: "Portfolio Analytics",
  version: "1.0.0",
  description: "Sharpe ratio, beta, and sector allocation for the active portfolio",
  toggleable: true,

  panes: [
    {
      id: "analytics",
      name: "Portfolio Analytics",
      icon: "R",
      component: PortfolioAnalyticsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 80, height: 30 },
    },
  ],

  paneTemplates: [
    {
      id: "analytics-pane",
      paneId: "analytics",
      label: "Portfolio Analytics",
      description: "Sharpe ratio, beta vs S&P 500, and sector allocation for your portfolio.",
      keywords: ["risk", "analytics", "sharpe", "beta", "sector", "allocation", "portfolio"],
      shortcut: { prefix: "PORT" },
      canCreate: (context) => context.config.portfolios.length > 0,
      createInstance: (context) => {
        const portfolioId = resolveTemplatePortfolioId(context.config.portfolios, context.activeCollectionId);
        return portfolioId ? { params: { portfolioId } } : null;
      },
    },
  ],
};
