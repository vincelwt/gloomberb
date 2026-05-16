import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, TextAttributes } from "../../../ui";
import {
  DataTableView,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
} from "../../../components";
import { useShortcut } from "../../../react/input";
import { StaticBarChartSurface } from "../../../components/chart/static-bar-chart-surface";
import { StaticMultiLineChartSurface } from "../../../components/chart/static-multi-line-chart-surface";
import { StaticScatterChartSurface } from "../../../components/chart/static-scatter-chart-surface";
import type { TimeRange } from "../../../components/chart/chart-types";
import type { ProjectedChartPoint } from "../../../components/chart/chart-data";
import { resolveChartPalette } from "../../../components/chart/chart-renderer";
import type { BarChartSeries } from "../../../components/chart/bar-chart-renderer";
import type { MultiLineChartSeries } from "../../../components/chart/multi-line-chart-renderer";
import type { ScatterChartPoint } from "../../../components/chart/scatter-chart-renderer";
import type { GloomPlugin, PaneProps, PaneTemplateCreateOptions, PaneTemplateDef } from "../../../types/plugin";
import type {
  AnalystEstimateRecord,
  AnalystResearchData,
  FinancialStatement,
  PricePoint,
  TickerFinancials,
} from "../../../types/financials";
import type { InstrumentSearchResult } from "../../../types/instrument";
import { useAppSelector, usePaneInstance, usePaneTicker } from "../../../state/app-context";
import { colors, priceColor } from "../../../theme/colors";
import { formatCompact, formatNumber, formatPercent } from "../../../utils/format";
import { formatTickerListInput, parseTickerListInput } from "../../../utils/ticker-list";
import { useAssetData, usePluginPaneState, usePluginTickerActions } from "../../plugin-runtime";
import { createTickerSurfacePaneTemplate } from "../ticker-surface";

type LoadState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

type HistoryColumnId = "date" | "open" | "high" | "low" | "close" | "change" | "changePercent" | "volume";
type HistoryColumn = DataTableColumn & { id: HistoryColumnId };

export type HistoricalPriceRow = {
  key: string;
  point: PricePoint;
  date: string;
  change: number | null;
  changePercent: number | null;
};

type FundamentalMetricKey =
  | "totalRevenue"
  | "grossProfit"
  | "operatingIncome"
  | "netIncome"
  | "operatingCashFlow"
  | "freeCashFlow"
  | "totalAssets"
  | "totalDebt"
  | "totalEquity"
  | "eps";

type ValuationMetricKey =
  | "trailingPE"
  | "forwardPE"
  | "pegRatio"
  | "priceSales"
  | "evSales"
  | "evEbitda"
  | "priceFcf";

type GraphKind = "fundamental" | "valuation";
type GraphMetricKey = FundamentalMetricKey | ValuationMetricKey;
type FundamentalPeriod = "annual" | "quarterly";
type FundamentalColumnId = "symbol" | "date" | "value" | "growth";
type FundamentalColumn = DataTableColumn & { id: FundamentalColumnId };
type RelationshipRange = Extract<TimeRange, "1M" | "3M" | "6M" | "1Y" | "5Y" | "ALL">;

export type FundamentalGraphRow = {
  key: string;
  symbol: string;
  date: string;
  category: string;
  value: number;
  growth: number | null;
  barWidth: number;
};

type EstimateColumnId = "type" | "date" | "period" | "analysts" | "average" | "low" | "high" | "yearAgo" | "growth";
type EstimateColumn = DataTableColumn & { id: EstimateColumnId };

export type EstimateRow = {
  key: string;
  type: "EPS" | "Revenue";
  estimate: AnalystEstimateRecord;
};

const HISTORY_RANGES: TimeRange[] = ["1D", "1W", "1M", "3M", "6M", "1Y", "5Y", "ALL"];
const RELATIONSHIP_RANGES: RelationshipRange[] = ["1M", "3M", "6M", "1Y", "5Y", "ALL"];
const DEFAULT_RELATIONSHIP_SECOND_SYMBOL = "SPY";
const RELATIONSHIP_CORRELATION_WINDOWS = [30, 60, 120, 252] as const;
const DEFAULT_RELATIONSHIP_CORRELATION_WINDOW = 120;

const FUNDAMENTAL_METRICS: Array<{
  key: FundamentalMetricKey;
  label: string;
  format: (value: number) => string;
}> = [
  { key: "totalRevenue", label: "Revenue", format: formatCompact },
  { key: "grossProfit", label: "Gross Profit", format: formatCompact },
  { key: "operatingIncome", label: "Operating Income", format: formatCompact },
  { key: "netIncome", label: "Net Income", format: formatCompact },
  { key: "operatingCashFlow", label: "Operating Cash Flow", format: formatCompact },
  { key: "freeCashFlow", label: "Free Cash Flow", format: formatCompact },
  { key: "totalAssets", label: "Total Assets", format: formatCompact },
  { key: "totalDebt", label: "Total Debt", format: formatCompact },
  { key: "totalEquity", label: "Equity", format: formatCompact },
  { key: "eps", label: "EPS", format: (value) => formatNumber(value, 2) },
];

const VALUATION_METRICS: Array<{
  key: ValuationMetricKey;
  label: string;
  format: (value: number) => string;
}> = [
  { key: "trailingPE", label: "Trailing P/E", format: (value) => `${formatNumber(value, 1)}x` },
  { key: "forwardPE", label: "Forward P/E", format: (value) => `${formatNumber(value, 1)}x` },
  { key: "pegRatio", label: "PEG", format: (value) => `${formatNumber(value, 2)}x` },
  { key: "priceSales", label: "Price/Sales", format: (value) => `${formatNumber(value, 1)}x` },
  { key: "evSales", label: "EV/Sales", format: (value) => `${formatNumber(value, 1)}x` },
  { key: "evEbitda", label: "EV/EBITDA", format: (value) => `${formatNumber(value, 1)}x` },
  { key: "priceFcf", label: "Price/FCF", format: (value) => `${formatNumber(value, 1)}x` },
];

const GRAPH_SERIES_COLORS = [
  colors.positive,
  "#4dabf7",
  "#f6c85f",
  "#b197fc",
  colors.negative,
  "#63e6be",
  "#ffa94d",
  "#74c0fc",
];

function useBoundTicker() {
  const { symbol, ticker } = usePaneTicker();
  return {
    symbol,
    exchange: ticker?.metadata.exchange ?? "",
  };
}

function useTickerRequest<T>(
  loader: (symbol: string, exchange: string, forceRefresh: boolean) => Promise<T>,
  symbol: string | null,
  exchange: string,
) {
  const [state, setState] = useState<LoadState<T>>({
    data: null,
    loading: false,
    error: null,
  });
  const fetchGenRef = useRef(0);

  const load = useCallback((forceRefresh = false) => {
    if (!symbol) {
      setState({ data: null, loading: false, error: "No ticker selected" });
      return;
    }

    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setState((current) => ({ ...current, loading: true, error: null }));

    Promise.resolve()
      .then(() => loader(symbol, exchange, forceRefresh))
      .then((data) => {
        if (fetchGenRef.current !== gen) return;
        setState({ data, loading: false, error: null });
      })
      .catch((error) => {
        if (fetchGenRef.current !== gen) return;
        setState({
          data: null,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, [exchange, loader, symbol]);

  useEffect(() => {
    load(false);
  }, [load]);

  return { ...state, reload: () => load(true) };
}

function formatDateTime(date: Date): string {
  const iso = date.toISOString();
  const hasTime = date.getUTCHours() !== 0 || date.getUTCMinutes() !== 0 || date.getUTCSeconds() !== 0;
  return hasTime ? iso.slice(0, 16).replace("T", " ") : iso.slice(0, 10);
}

function formatMaybePrice(value: number | undefined): string {
  return value == null ? "-" : formatNumber(value, 2);
}

function formatMaybePercent(value: number | null): string {
  return value == null ? "-" : formatPercent(value);
}

function formatMaybeCompact(value: number | undefined): string {
  return value == null ? "-" : formatCompact(value);
}

export function buildHistoricalPriceRows(points: PricePoint[]): HistoricalPriceRow[] {
  const sorted = [...points].sort((left, right) => left.date.getTime() - right.date.getTime());
  return sorted.map((point, index) => {
    const previous = sorted[index - 1];
    const change = previous ? point.close - previous.close : null;
    return {
      key: `${point.date.toISOString()}:${index}`,
      point,
      date: formatDateTime(point.date),
      change,
      changePercent: previous?.close ? change! / previous.close : null,
    };
  }).reverse();
}

function buildHistoryColumns(width: number): HistoryColumn[] {
  const dateWidth = 16;
  const priceWidth = 10;
  const changeWidth = 10;
  const percentWidth = 9;
  const volumeWidth = Math.max(9, width - 2 - dateWidth - priceWidth * 4 - changeWidth - percentWidth - 7);
  return [
    { id: "date", label: "DATE/TIME", width: dateWidth, align: "left" },
    { id: "open", label: "OPEN", width: priceWidth, align: "right" },
    { id: "high", label: "HIGH", width: priceWidth, align: "right" },
    { id: "low", label: "LOW", width: priceWidth, align: "right" },
    { id: "close", label: "CLOSE", width: priceWidth, align: "right" },
    { id: "change", label: "CHG", width: changeWidth, align: "right" },
    { id: "changePercent", label: "CHG %", width: percentWidth, align: "right" },
    { id: "volume", label: "VOLUME", width: volumeWidth, align: "right" },
  ];
}

function nextHistoryRange(current: TimeRange): TimeRange {
  const index = HISTORY_RANGES.indexOf(current);
  return HISTORY_RANGES[(index + 1) % HISTORY_RANGES.length] ?? "1Y";
}

function HistoricalPricesPane({ focused, width, height }: PaneProps) {
  const dataProvider = useAssetData();
  const { symbol, exchange } = useBoundTicker();
  const [range, setRange] = usePluginPaneState<TimeRange>("range", "ALL");
  const [selectedIdx, setSelectedIdx] = usePluginPaneState<number>("selectedIdx", 0);
  const loader = useCallback((nextSymbol: string, nextExchange: string, forceRefresh: boolean) => {
    if (!dataProvider) throw new Error("Market data unavailable");
    return dataProvider.getPriceHistory(
      nextSymbol,
      nextExchange,
      range,
      forceRefresh ? { cacheMode: "refresh" } : undefined,
    );
  }, [dataProvider, range]);
  const { data, loading, error, reload } = useTickerRequest<PricePoint[]>(loader, symbol, exchange);
  const rows = useMemo(() => buildHistoricalPriceRows(data ?? []), [data]);
  const columns = useMemo(() => buildHistoryColumns(width), [width]);
  const boundedSelectedIdx = rows.length > 0 ? Math.min(selectedIdx, rows.length - 1) : -1;
  const cycleRange = useCallback(() => setRange((current) => nextHistoryRange(current)), [setRange]);

  useEffect(() => {
    if (rows.length > 0 && selectedIdx >= rows.length) setSelectedIdx(rows.length - 1);
  }, [rows.length, selectedIdx, setSelectedIdx]);

  const handleKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name === "r") {
      event.preventDefault?.();
      reload();
      return true;
    }
    if (event.name === "t") {
      event.preventDefault?.();
      cycleRange();
      return true;
    }
    return false;
  }, [cycleRange, reload]);

  const renderCell = useCallback((
    row: HistoricalPriceRow,
    column: HistoryColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "date":
        return { text: row.date, color: selectedColor ?? colors.textDim };
      case "open":
        return { text: formatMaybePrice(row.point.open), color: selectedColor ?? colors.text };
      case "high":
        return { text: formatMaybePrice(row.point.high), color: selectedColor ?? colors.text };
      case "low":
        return { text: formatMaybePrice(row.point.low), color: selectedColor ?? colors.text };
      case "close":
        return { text: formatNumber(row.point.close, 2), color: selectedColor ?? colors.textBright, attributes: TextAttributes.BOLD };
      case "change":
        return { text: row.change == null ? "-" : formatNumber(row.change, 2), color: selectedColor ?? priceColor(row.change ?? 0) };
      case "changePercent":
        return { text: formatMaybePercent(row.changePercent), color: selectedColor ?? priceColor(row.changePercent ?? 0) };
      case "volume":
        return { text: formatMaybeCompact(row.point.volume), color: selectedColor ?? colors.textDim };
    }
  }, []);

  usePaneFooter("historical-prices", () => ({
    info: [
      { id: "range", parts: [{ text: range, tone: "muted" as const }] },
      ...(loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : []),
    ],
    hints: [
      { id: "range", key: "t", label: "oggle range", onPress: cycleRange },
      { id: "refresh", key: "r", label: "efresh", onPress: reload },
    ],
  }), [cycleRange, error, loading, range, reload]);

  return (
    <DataTableView<HistoricalPriceRow, HistoryColumn>
      focused={focused}
      selectedIndex={boundedSelectedIdx}
      onSelectIndex={(index) => setSelectedIdx(index)}
      onRootKeyDown={handleKeyDown}
      rootWidth={width}
      rootHeight={height}
      columns={columns}
      items={rows}
      sortColumnId={null}
      sortDirection="desc"
      onHeaderClick={() => {}}
      getItemKey={(row) => row.key}
      isSelected={(_row, index) => index === boundedSelectedIdx}
      onSelect={(_row, index) => setSelectedIdx(index)}
      renderCell={renderCell}
      emptyStateTitle={loading ? "Loading historical prices..." : "No historical prices"}
    />
  );
}

function selectedStatements(financials: TickerFinancials | null, period: FundamentalPeriod): FinancialStatement[] {
  return period === "annual"
    ? financials?.annualStatements ?? []
    : financials?.quarterlyStatements ?? [];
}

function periodCategory(date: string, period: FundamentalPeriod): string {
  const year = date.slice(0, 4);
  if (period === "annual") return `FY${year}`;
  const month = Number(date.slice(5, 7));
  const quarter = Number.isFinite(month) && month > 0 ? Math.ceil(month / 3) : 0;
  return quarter > 0 ? `${year} Q${quarter}` : date;
}

export function buildFundamentalGraphRows(
  statements: FinancialStatement[],
  metric: FundamentalMetricKey,
  symbol = "",
  period: FundamentalPeriod = "annual",
): FundamentalGraphRow[] {
  const sorted = [...statements]
    .filter((statement) => typeof statement[metric] === "number")
    .sort((left, right) => left.date.localeCompare(right.date));
  const maxAbs = Math.max(1, ...sorted.map((statement) => Math.abs(statement[metric] as number)));
  return sorted.map((statement, index) => {
    const value = statement[metric] as number;
    const previous = sorted[index - 1]?.[metric];
    return {
      key: [symbol, statement.date, metric].filter(Boolean).join(":"),
      symbol,
      date: statement.date,
      category: periodCategory(statement.date, period),
      value,
      growth: typeof previous === "number" && previous !== 0 ? (value - previous) / Math.abs(previous) : null,
      barWidth: Math.max(1, Math.round((Math.abs(value) / maxAbs) * 24)),
    };
  });
}

function resolveMarketCap(financials: TickerFinancials | null): number | null {
  const quoted = financials?.quote?.marketCap;
  if (typeof quoted === "number" && Number.isFinite(quoted) && quoted > 0) return quoted;
  const price = financials?.quote?.price;
  const shares = financials?.fundamentals?.sharesOutstanding;
  return typeof price === "number" && Number.isFinite(price) && price > 0
    && typeof shares === "number" && Number.isFinite(shares) && shares > 0
    ? price * shares
    : null;
}

function valuationMetricValue(
  financials: TickerFinancials | null,
  metric: ValuationMetricKey,
  statement: FinancialStatement | null,
): number | null {
  const fundamentals = financials?.fundamentals;
  if (metric === "trailingPE") return fundamentals?.trailingPE ?? null;
  if (metric === "forwardPE") return fundamentals?.forwardPE ?? null;
  if (metric === "pegRatio") return fundamentals?.pegRatio ?? null;

  const marketCap = resolveMarketCap(financials);
  const enterpriseValue = fundamentals?.enterpriseValue ?? null;
  const revenue = statement?.totalRevenue;
  const ebitda = statement?.ebitda;
  const freeCashFlow = statement?.freeCashFlow;

  if (metric === "priceSales" && marketCap && revenue) return marketCap / revenue;
  if (metric === "evSales" && enterpriseValue && revenue) return enterpriseValue / revenue;
  if (metric === "evEbitda" && enterpriseValue && ebitda) return enterpriseValue / ebitda;
  if (metric === "priceFcf" && marketCap && freeCashFlow) return marketCap / freeCashFlow;
  return null;
}

export function buildValuationGraphRows(
  financials: TickerFinancials | null,
  metric: ValuationMetricKey,
  symbol = "",
  period: FundamentalPeriod = "annual",
): FundamentalGraphRow[] {
  const statementMetrics = new Set<ValuationMetricKey>(["priceSales", "evSales", "evEbitda", "priceFcf"]);
  const sourceStatements = statementMetrics.has(metric)
    ? selectedStatements(financials, period)
    : [{ date: "Current" } as FinancialStatement];
  const sorted = sourceStatements
    .map((statement) => ({
      statement,
      value: valuationMetricValue(financials, metric, statement.date === "Current" ? null : statement),
    }))
    .filter((entry): entry is { statement: FinancialStatement; value: number } => (
      typeof entry.value === "number" && Number.isFinite(entry.value)
    ))
    .sort((left, right) => left.statement.date.localeCompare(right.statement.date));
  const maxAbs = Math.max(1, ...sorted.map((entry) => Math.abs(entry.value)));

  return sorted.map((entry, index) => {
    const previous = sorted[index - 1]?.value;
    return {
      key: [symbol, entry.statement.date, metric].filter(Boolean).join(":"),
      symbol,
      date: entry.statement.date,
      category: entry.statement.date === "Current" ? "Current" : periodCategory(entry.statement.date, period),
      value: entry.value,
      growth: typeof previous === "number" && previous !== 0 ? (entry.value - previous) / Math.abs(previous) : null,
      barWidth: Math.max(1, Math.round((Math.abs(entry.value) / maxAbs) * 24)),
    };
  });
}

function metricDefs(kind: GraphKind) {
  return kind === "valuation" ? VALUATION_METRICS : FUNDAMENTAL_METRICS;
}

function defaultMetric(kind: GraphKind): GraphMetricKey {
  return kind === "valuation" ? "priceSales" : "totalRevenue";
}

function isMetricForKind(kind: GraphKind, metric: GraphMetricKey): boolean {
  return metricDefs(kind).some((definition) => definition.key === metric);
}

function nextMetric(kind: GraphKind, current: GraphMetricKey): GraphMetricKey {
  const definitions = metricDefs(kind);
  const index = definitions.findIndex((metric) => metric.key === current);
  return definitions[(index + 1) % definitions.length]?.key ?? defaultMetric(kind);
}

function metricDef(kind: GraphKind, key: GraphMetricKey) {
  return metricDefs(kind).find((metric) => metric.key === key) ?? metricDefs(kind)[0]!;
}

function graphRowsForFinancials(
  financials: TickerFinancials | null,
  kind: GraphKind,
  metric: GraphMetricKey,
  period: FundamentalPeriod,
  symbol: string,
): FundamentalGraphRow[] {
  if (kind === "valuation") {
    return buildValuationGraphRows(financials, metric as ValuationMetricKey, symbol, period);
  }
  return buildFundamentalGraphRows(selectedStatements(financials, period), metric as FundamentalMetricKey, symbol, period);
}

function buildFundamentalColumns(width: number, multiSymbol: boolean): FundamentalColumn[] {
  const symbolWidth = multiSymbol ? 8 : 0;
  const dateWidth = 12;
  const valueWidth = 14;
  const growthWidth = 10;
  return [
    ...(multiSymbol ? [{ id: "symbol" as const, label: "TICKER", width: symbolWidth, align: "left" as const }] : []),
    { id: "date", label: "DATE", width: dateWidth, align: "left" },
    { id: "value", label: "VALUE", width: valueWidth, align: "right" },
    { id: "growth", label: "CHG", width: Math.max(growthWidth, width - 2 - symbolWidth - dateWidth - valueWidth - 3), align: "right" },
  ];
}

function buildGraphBarSeries(rows: FundamentalGraphRow[]): BarChartSeries[] {
  const symbols = [...new Set(rows.map((row) => row.symbol || ""))];
  const categories = [...new Set(rows.map((row) => row.category))];
  return symbols.map((symbol, index) => ({
    id: symbol || "value",
    label: symbol || "Value",
    color: GRAPH_SERIES_COLORS[index % GRAPH_SERIES_COLORS.length]!,
    points: categories.map((category) => ({
      category,
      value: rows.find((row) => (row.symbol || "") === symbol && row.category === category)?.value ?? null,
    })),
  }));
}

export interface RelationshipAlignedPoint {
  date: Date;
  dateKey: string;
  leftClose: number;
  rightClose: number;
  ratio: number;
}

export interface RelationshipReturnPoint {
  date: Date;
  dateKey: string;
  leftReturn: number;
  rightReturn: number;
}

export interface RelationshipRegressionStats {
  beta: number;
  alpha: number;
  r: number;
  rSquared: number;
  stdError: number | null;
  sampleSize: number;
}

export interface RelationshipAnalysis {
  aligned: RelationshipAlignedPoint[];
  returns: RelationshipReturnPoint[];
  ratioPoints: ProjectedChartPoint[];
  correlationPoints: ProjectedChartPoint[];
  scatterPoints: ScatterChartPoint[];
  stats: RelationshipRegressionStats | null;
  latestRatio: number | null;
  latestCorrelation: number | null;
}

function pricePointTime(point: PricePoint): number {
  const value = point.date as Date | string | number;
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function pricePointDateKey(point: PricePoint): string | null {
  const timestamp = pricePointTime(point);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function syntheticChartPoint(date: Date, value: number): ProjectedChartPoint {
  return {
    date,
    open: value,
    high: value,
    low: value,
    close: value,
    volume: 0,
  };
}

function alignRelationshipPrices(leftPoints: PricePoint[], rightPoints: PricePoint[]): RelationshipAlignedPoint[] {
  const rightByDate = new Map<string, PricePoint>();
  for (const point of rightPoints) {
    const dateKey = pricePointDateKey(point);
    if (!dateKey || !Number.isFinite(point.close) || point.close <= 0) continue;
    rightByDate.set(dateKey, point);
  }

  return [...leftPoints]
    .sort((left, right) => pricePointTime(left) - pricePointTime(right))
    .flatMap((leftPoint): RelationshipAlignedPoint[] => {
      const dateKey = pricePointDateKey(leftPoint);
      if (!dateKey || !Number.isFinite(leftPoint.close) || leftPoint.close <= 0) return [];
      const rightPoint = rightByDate.get(dateKey);
      if (!rightPoint || !Number.isFinite(rightPoint.close) || rightPoint.close <= 0) return [];
      const timestamp = pricePointTime(leftPoint);
      return [{
        date: new Date(timestamp),
        dateKey,
        leftClose: leftPoint.close,
        rightClose: rightPoint.close,
        ratio: leftPoint.close / rightPoint.close,
      }];
    });
}

function buildRelationshipReturns(aligned: RelationshipAlignedPoint[]): RelationshipReturnPoint[] {
  const returns: RelationshipReturnPoint[] = [];
  for (let index = 1; index < aligned.length; index++) {
    const previous = aligned[index - 1]!;
    const current = aligned[index]!;
    if (previous.leftClose <= 0 || previous.rightClose <= 0) continue;
    const leftReturn = (current.leftClose - previous.leftClose) / previous.leftClose;
    const rightReturn = (current.rightClose - previous.rightClose) / previous.rightClose;
    if (!Number.isFinite(leftReturn) || !Number.isFinite(rightReturn)) continue;
    returns.push({
      date: current.date,
      dateKey: current.dateKey,
      leftReturn,
      rightReturn,
    });
  }
  return returns;
}

function pearson(x: number[], y: number[], minObservations = 5): number | null {
  const n = Math.min(x.length, y.length);
  if (n < minObservations) return null;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  let sumY2 = 0;
  for (let i = 0; i < n; i++) {
    const xValue = x[i]!;
    const yValue = y[i]!;
    sumX += xValue;
    sumY += yValue;
    sumXY += xValue * yValue;
    sumX2 += xValue * xValue;
    sumY2 += yValue * yValue;
  }

  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  return denominator === 0 ? null : (n * sumXY - sumX * sumY) / denominator;
}

function buildRollingCorrelationPoints(
  returns: RelationshipReturnPoint[],
  windowSize: number,
): ProjectedChartPoint[] {
  const points: ProjectedChartPoint[] = [];
  for (let index = 0; index < returns.length; index++) {
    const window = returns.slice(Math.max(0, index - windowSize + 1), index + 1);
    const correlation = pearson(
      window.map((entry) => entry.rightReturn),
      window.map((entry) => entry.leftReturn),
      5,
    );
    if (correlation === null) continue;
    points.push(syntheticChartPoint(returns[index]!.date, correlation));
  }
  return points;
}

function computeRelationshipRegression(returns: RelationshipReturnPoint[]): RelationshipRegressionStats | null {
  const x = returns.map((entry) => entry.rightReturn * 100);
  const y = returns.map((entry) => entry.leftReturn * 100);
  const n = Math.min(x.length, y.length);
  if (n < 5) return null;

  const meanX = x.reduce((sum, value) => sum + value, 0) / n;
  const meanY = y.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < n; index++) {
    const dx = x[index]! - meanX;
    numerator += dx * (y[index]! - meanY);
    denominator += dx * dx;
  }
  if (denominator === 0) return null;

  const beta = numerator / denominator;
  const alpha = meanY - beta * meanX;
  const r = pearson(x, y, 5);
  if (r === null) return null;

  let residualSumSquares = 0;
  for (let index = 0; index < n; index++) {
    const fitted = alpha + beta * x[index]!;
    const residual = y[index]! - fitted;
    residualSumSquares += residual * residual;
  }

  return {
    beta,
    alpha,
    r,
    rSquared: r * r,
    stdError: n > 2 ? Math.sqrt(residualSumSquares / (n - 2)) : null,
    sampleSize: n,
  };
}

export function buildRelationshipAnalysis(
  leftPoints: PricePoint[],
  rightPoints: PricePoint[],
  correlationWindow = DEFAULT_RELATIONSHIP_CORRELATION_WINDOW,
): RelationshipAnalysis {
  const aligned = alignRelationshipPrices(leftPoints, rightPoints);
  const returns = buildRelationshipReturns(aligned);
  const correlationPoints = buildRollingCorrelationPoints(returns, correlationWindow);
  const scatterPoints = returns.map((entry, index) => ({
    x: entry.rightReturn * 100,
    y: entry.leftReturn * 100,
    highlight: index === returns.length - 1,
  }));
  const stats = computeRelationshipRegression(returns);

  return {
    aligned,
    returns,
    ratioPoints: aligned.map((entry) => syntheticChartPoint(entry.date, entry.ratio)),
    correlationPoints,
    scatterPoints,
    stats,
    latestRatio: aligned.at(-1)?.ratio ?? null,
    latestCorrelation: correlationPoints.at(-1)?.close ?? null,
  };
}

function symbolsFromPaneSettings(settings: Record<string, unknown> | undefined, fallbackSymbol: string | null): string[] {
  const symbols = settings?.symbols;
  if (Array.isArray(symbols)) {
    return symbols
      .filter((symbol): symbol is string => typeof symbol === "string" && symbol.trim().length > 0)
      .map((symbol) => symbol.trim().toUpperCase());
  }
  const symbolsText = settings?.symbolsText;
  if (typeof symbolsText === "string" && symbolsText.trim()) {
    try {
      return parseTickerListInput(symbolsText);
    } catch {
      return fallbackSymbol ? [fallbackSymbol] : [];
    }
  }
  return fallbackSymbol ? [fallbackSymbol] : [];
}

function graphKindFromSettings(settings: Record<string, unknown> | undefined, fallback: GraphKind): GraphKind {
  return settings?.chartKind === "valuation" ? "valuation" : fallback;
}

function normalizeRelationshipSymbols(symbols: string[]): [string, string] | null {
  const normalized = symbols
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
  if (normalized.length === 0) return null;
  return [
    normalized[0]!,
    normalized[1] ?? DEFAULT_RELATIONSHIP_SECOND_SYMBOL,
  ];
}

function relationshipSymbolsFromPaneSettings(
  settings: Record<string, unknown> | undefined,
  fallbackSymbol: string | null,
): [string, string] | null {
  const symbols = settings?.symbols;
  if (Array.isArray(symbols)) {
    const pair = normalizeRelationshipSymbols(symbols.filter((symbol): symbol is string => typeof symbol === "string"));
    if (pair) return pair;
  }

  const symbolsText = settings?.symbolsText;
  if (typeof symbolsText === "string" && symbolsText.trim()) {
    try {
      return normalizeRelationshipSymbols(parseTickerListInput(symbolsText));
    } catch {
      return fallbackSymbol ? [fallbackSymbol, DEFAULT_RELATIONSHIP_SECOND_SYMBOL] : null;
    }
  }

  return fallbackSymbol ? [fallbackSymbol, DEFAULT_RELATIONSHIP_SECOND_SYMBOL] : null;
}

type SymbolFinancials = {
  symbol: string;
  financials: TickerFinancials | null;
  error: string | null;
};

function useSymbolFinancials(symbols: string[], forceExchange: string) {
  const dataProvider = useAssetData();
  const tickers = useAppSelector((state) => state.tickers);
  const [state, setState] = useState<LoadState<SymbolFinancials[]>>({
    data: null,
    loading: false,
    error: null,
  });
  const fetchGenRef = useRef(0);

  const load = useCallback((forceRefresh = false) => {
    if (symbols.length === 0) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    if (!dataProvider) {
      setState({ data: null, loading: false, error: "Market data unavailable" });
      return;
    }

    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setState((current) => ({ ...current, loading: true, error: null }));

    Promise.all(symbols.map(async (symbol) => {
      const exchange = tickers.get(symbol)?.metadata.exchange ?? forceExchange;
      try {
        return {
          symbol,
          financials: await dataProvider.getTickerFinancials(
            symbol,
            exchange,
            forceRefresh ? { cacheMode: "refresh" } : undefined,
          ),
          error: null,
        };
      } catch (error) {
        return {
          symbol,
          financials: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })).then((data) => {
      if (fetchGenRef.current !== gen) return;
      const firstError = data.find((entry) => entry.error)?.error ?? null;
      setState({ data, loading: false, error: firstError });
    });
  }, [dataProvider, forceExchange, symbols, tickers]);

  useEffect(() => {
    load(false);
  }, [load]);

  return { ...state, reload: () => load(true) };
}

type RelationshipHistoryEntry = {
  symbol: string;
  points: PricePoint[];
  error: string | null;
};

function useRelationshipHistories(pair: [string, string] | null, range: RelationshipRange, forceExchange: string) {
  const dataProvider = useAssetData();
  const tickers = useAppSelector((state) => state.tickers);
  const [state, setState] = useState<LoadState<RelationshipHistoryEntry[]>>({
    data: null,
    loading: false,
    error: null,
  });
  const fetchGenRef = useRef(0);
  const leftSymbol = pair?.[0] ?? null;
  const rightSymbol = pair?.[1] ?? null;

  const load = useCallback((forceRefresh = false) => {
    if (!leftSymbol || !rightSymbol) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    if (!dataProvider) {
      setState({ data: null, loading: false, error: "Market data unavailable" });
      return;
    }

    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setState((current) => ({ ...current, loading: true, error: null }));

    Promise.all([leftSymbol, rightSymbol].map(async (symbol) => {
      const exchange = tickers.get(symbol)?.metadata.exchange ?? (symbol === leftSymbol ? forceExchange : "");
      try {
        return {
          symbol,
          points: await dataProvider.getPriceHistory(
            symbol,
            exchange,
            range,
            forceRefresh ? { cacheMode: "refresh" } : undefined,
          ),
          error: null,
        };
      } catch (error) {
        return {
          symbol,
          points: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })).then((data) => {
      if (fetchGenRef.current !== gen) return;
      const firstError = data.find((entry) => entry.error)?.error ?? null;
      setState({ data, loading: false, error: firstError });
    });
  }, [dataProvider, forceExchange, leftSymbol, range, rightSymbol, tickers]);

  useEffect(() => {
    load(false);
  }, [load]);

  return { ...state, reload: () => load(true) };
}

function FundamentalGraphContent({
  focused,
  width,
  height,
  rows,
  loading,
  error,
  reload,
  period,
  setPeriod,
  metric,
  setMetric,
  chartKind,
  setChartKind,
}: {
  focused: boolean;
  width: number;
  height: number;
  rows: FundamentalGraphRow[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  period: FundamentalPeriod;
  setPeriod: (updater: (current: FundamentalPeriod) => FundamentalPeriod) => void;
  metric: GraphMetricKey;
  setMetric: (updater: (current: GraphMetricKey) => GraphMetricKey) => void;
  chartKind: GraphKind;
  setChartKind: (updater: (current: GraphKind) => GraphKind) => void;
}) {
  const [selectedIdx, setSelectedIdx] = usePluginPaneState<number>("selectedIdx", 0);
  const definition = metricDef(chartKind, metric);
  const multiSymbol = new Set(rows.map((row) => row.symbol)).size > 1;
  const columns = useMemo(() => buildFundamentalColumns(width, multiSymbol), [multiSymbol, width]);
  const boundedSelectedIdx = rows.length > 0 ? Math.min(selectedIdx, rows.length - 1) : -1;
  const chartHeight = height >= 14 ? Math.min(12, Math.max(7, Math.floor(height * 0.52))) : Math.max(4, Math.floor(height / 2));
  const tableHeight = Math.max(4, height - chartHeight);
  const chartSeries = useMemo(() => buildGraphBarSeries(rows), [rows]);
  const cycleMetric = useCallback(() => setMetric((current) => nextMetric(chartKind, current)), [chartKind, setMetric]);
  const togglePeriod = useCallback(() => setPeriod((current) => current === "annual" ? "quarterly" : "annual"), [setPeriod]);
  const toggleGraphKind = useCallback(() => {
    const nextKind = chartKind === "fundamental" ? "valuation" : "fundamental";
    setChartKind(() => nextKind);
    setMetric((current) => isMetricForKind(nextKind, current) ? current : defaultMetric(nextKind));
  }, [chartKind, setChartKind, setMetric]);

  useEffect(() => {
    if (rows.length > 0 && selectedIdx >= rows.length) setSelectedIdx(rows.length - 1);
  }, [rows.length, selectedIdx, setSelectedIdx]);

  const handleKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name === "r") {
      event.preventDefault?.();
      reload();
      return true;
    }
    if (event.name === "m") {
      event.preventDefault?.();
      cycleMetric();
      return true;
    }
    if (event.name === "g") {
      event.preventDefault?.();
      toggleGraphKind();
      return true;
    }
    if (event.name === "p") {
      event.preventDefault?.();
      togglePeriod();
      return true;
    }
    return false;
  }, [cycleMetric, reload, toggleGraphKind, togglePeriod]);

  const renderCell = useCallback((
    row: FundamentalGraphRow,
    column: FundamentalColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "symbol":
        return { text: row.symbol, color: selectedColor ?? colors.textBright, attributes: TextAttributes.BOLD };
      case "date":
        return { text: row.date, color: selectedColor ?? colors.textDim };
      case "value":
        return { text: definition.format(row.value), color: selectedColor ?? colors.textBright, attributes: TextAttributes.BOLD };
      case "growth":
        return { text: formatMaybePercent(row.growth), color: selectedColor ?? priceColor(row.growth ?? 0) };
    }
  }, [definition]);

  usePaneFooter("fundamental-graph", () => ({
    info: [
      { id: "metric", parts: [{ text: definition.label, tone: "muted" as const }] },
      { id: "kind", parts: [{ text: chartKind === "valuation" ? "valuation" : "fundamental", tone: "muted" as const }] },
      { id: "period", parts: [{ text: period, tone: "muted" as const }] },
      ...(loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : []),
    ],
    hints: [
      { id: "metric", key: "m", label: "etric", onPress: cycleMetric },
      { id: "kind", key: "g", label: "raph", onPress: toggleGraphKind },
      { id: "period", key: "p", label: "eriod", onPress: togglePeriod },
      { id: "refresh", key: "r", label: "efresh", onPress: reload },
    ],
  }), [chartKind, cycleMetric, definition.label, error, loading, period, reload, toggleGraphKind, togglePeriod]);

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      <StaticBarChartSurface width={width} height={chartHeight} series={chartSeries} />
      <DataTableView<FundamentalGraphRow, FundamentalColumn>
        focused={focused}
        selectedIndex={boundedSelectedIdx}
        onSelectIndex={(index) => setSelectedIdx(index)}
        onRootKeyDown={handleKeyDown}
        rootWidth={width}
        rootHeight={tableHeight}
        columns={columns}
        items={rows}
        sortColumnId={null}
        sortDirection="asc"
        onHeaderClick={() => {}}
        getItemKey={(row) => row.key}
        isSelected={(_row, index) => index === boundedSelectedIdx}
        onSelect={(_row, index) => setSelectedIdx(index)}
        renderCell={renderCell}
        emptyStateTitle={loading ? "Loading fundamentals..." : "No graph data"}
      />
    </Box>
  );
}

function FundamentalGraphPane({ focused, width, height }: PaneProps) {
  const pane = usePaneInstance();
  const { symbol, exchange } = useBoundTicker();
  const symbols = useMemo(() => symbolsFromPaneSettings(pane?.settings, symbol), [pane?.settings, symbol]);
  const configuredKind = graphKindFromSettings(pane?.settings, "fundamental");
  const [period, setPeriod] = usePluginPaneState<FundamentalPeriod>("period", "annual");
  const [chartKind, setChartKind] = usePluginPaneState<GraphKind>("chartKind", configuredKind);
  const [metric, setMetric] = usePluginPaneState<GraphMetricKey>("metric", defaultMetric(configuredKind));
  const resolvedMetric = isMetricForKind(chartKind, metric) ? metric : defaultMetric(chartKind);
  const { data, loading, error, reload } = useSymbolFinancials(symbols, exchange);
  const rows = useMemo(() => (data ?? []).flatMap((entry) => (
    graphRowsForFinancials(entry.financials, chartKind, resolvedMetric, period, entry.symbol)
  )), [chartKind, data, period, resolvedMetric]);

  return (
    <FundamentalGraphContent
      focused={focused}
      width={width}
      height={height}
      rows={rows}
      loading={loading}
      error={error}
      reload={reload}
      period={period}
      setPeriod={setPeriod}
      metric={resolvedMetric}
      setMetric={setMetric}
      chartKind={chartKind}
      setChartKind={setChartKind}
    />
  );
}

function FundamentalGraphsDetailTab({ focused, width, height }: { focused: boolean; width: number; height: number }) {
  const { symbol, financials } = usePaneTicker();
  const [period, setPeriod] = usePluginPaneState<FundamentalPeriod>("detailPeriod", "annual");
  const [chartKind, setChartKind] = usePluginPaneState<GraphKind>("detailChartKind", "fundamental");
  const [metric, setMetric] = usePluginPaneState<GraphMetricKey>("detailMetric", "totalRevenue");
  const resolvedMetric = isMetricForKind(chartKind, metric) ? metric : defaultMetric(chartKind);
  const rows = useMemo(() => (
    graphRowsForFinancials(financials, chartKind, resolvedMetric, period, symbol ?? "")
  ), [chartKind, financials, period, resolvedMetric, symbol]);

  return (
    <FundamentalGraphContent
      focused={focused}
      width={width}
      height={height}
      rows={rows}
      loading={false}
      error={null}
      reload={() => {}}
      period={period}
      setPeriod={setPeriod}
      metric={resolvedMetric}
      setMetric={setMetric}
      chartKind={chartKind}
      setChartKind={setChartKind}
    />
  );
}

function nextRelationshipRange(current: RelationshipRange): RelationshipRange {
  const index = RELATIONSHIP_RANGES.indexOf(current);
  return RELATIONSHIP_RANGES[(index + 1) % RELATIONSHIP_RANGES.length] ?? "1Y";
}

function nextRelationshipWindow(current: number): number {
  const index = RELATIONSHIP_CORRELATION_WINDOWS.findIndex((value) => value === current);
  return RELATIONSHIP_CORRELATION_WINDOWS[(index + 1) % RELATIONSHIP_CORRELATION_WINDOWS.length]
    ?? DEFAULT_RELATIONSHIP_CORRELATION_WINDOW;
}

function formatNullableNumber(value: number | null | undefined, decimals: number): string {
  return typeof value === "number" && Number.isFinite(value) ? formatNumber(value, decimals) : "-";
}

function buildIndexedPriceSeries(
  aligned: RelationshipAlignedPoint[],
  leftSymbol: string,
  rightSymbol: string,
): MultiLineChartSeries[] {
  const first = aligned[0];
  if (!first) return [];
  return [
    {
      id: "left",
      label: leftSymbol,
      color: colors.positive,
      points: aligned.map((entry) => ({
        date: entry.date,
        value: (entry.leftClose / first.leftClose) * 100,
      })),
    },
    {
      id: "right",
      label: rightSymbol,
      color: "#4dabf7",
      points: aligned.map((entry) => ({
        date: entry.date,
        value: (entry.rightClose / first.rightClose) * 100,
      })),
    },
  ];
}

function buildRelationshipRatioSeries(
  aligned: RelationshipAlignedPoint[],
  leftSymbol: string,
  rightSymbol: string,
  color: string,
): MultiLineChartSeries[] {
  return [{
    id: "ratio",
    label: `${leftSymbol}/${rightSymbol}`,
    color,
    points: aligned.map((entry) => ({ date: entry.date, value: entry.ratio })),
  }];
}

function buildRelationshipCorrelationSeries(
  aligned: RelationshipAlignedPoint[],
  correlationPoints: ProjectedChartPoint[],
): MultiLineChartSeries[] {
  const correlationByTime = new Map(correlationPoints.map((point) => [point.date.getTime(), point.close] as const));
  return [{
    id: "correlation",
    label: "Rolling Corr",
    color: "#f6c85f",
    points: aligned.map((entry) => ({
      date: entry.date,
      value: correlationByTime.get(entry.date.getTime()) ?? null,
    })),
  }];
}

function buildRelationshipScatterPointsForDate(
  returns: RelationshipReturnPoint[],
  cursorDate: Date | null,
): ScatterChartPoint[] {
  const cursorTime = cursorDate?.getTime() ?? null;
  return returns.map((entry, index) => ({
    x: entry.rightReturn * 100,
    y: entry.leftReturn * 100,
    highlight: cursorTime === null
      ? index === returns.length - 1
      : entry.date.getTime() === cursorTime,
  }));
}

function findRelationshipAlignedPoint(
  aligned: RelationshipAlignedPoint[],
  cursorDate: Date | null,
): RelationshipAlignedPoint | null {
  if (aligned.length === 0) return null;
  if (!cursorDate) return aligned.at(-1) ?? null;
  return aligned.find((entry) => entry.date.getTime() === cursorDate.getTime()) ?? aligned.at(-1) ?? null;
}

function findRelationshipCorrelationAtDate(
  points: ProjectedChartPoint[],
  cursorDate: Date | null,
): number | null {
  if (!cursorDate) return points.at(-1)?.close ?? null;
  return points.find((point) => point.date.getTime() === cursorDate.getTime())?.close ?? null;
}

function buildRelationshipMetricsRows(
  stats: RelationshipRegressionStats | null,
  analysis: RelationshipAnalysis,
): Array<{ label: string; value: string }> {
  return [
    { label: "Beta", value: formatNullableNumber(stats?.beta, 3) },
    { label: "Alpha", value: `${formatNullableNumber(stats?.alpha, 3)}%` },
    { label: "R", value: formatNullableNumber(stats?.r, 3) },
    { label: "R2", value: formatNullableNumber(stats?.rSquared, 3) },
    { label: "Std Err", value: formatNullableNumber(stats?.stdError, 3) },
    { label: "Obs", value: String(stats?.sampleSize ?? analysis.returns.length) },
    { label: "Aligned", value: String(analysis.aligned.length) },
  ];
}

function RelationshipMetricsTable({
  rows,
  width,
  height,
}: {
  rows: Array<{ label: string; value: string }>;
  width: number;
  height: number;
}) {
  const labelWidth = Math.min(8, Math.max(5, Math.floor(width * 0.45)));
  const valueWidth = Math.max(4, width - labelWidth - 1);
  return (
    <Box width={width} height={height} flexDirection="column" overflow="hidden">
      <Box height={1} flexDirection="row">
        <Text fg={colors.textDim}>{"Metric".padEnd(labelWidth)}</Text>
        <Text fg={colors.textDim}>{"Value".padStart(valueWidth + 1)}</Text>
      </Box>
      {rows.slice(0, Math.max(0, height - 1)).map((row) => (
        <Box key={row.label} height={1} flexDirection="row">
          <Text fg={colors.text}>{row.label.padEnd(labelWidth)}</Text>
          <Text fg={colors.textBright}>{row.value.padStart(valueWidth + 1)}</Text>
        </Box>
      ))}
    </Box>
  );
}

function RelationshipToggle({
  checked,
  label,
  onPress,
}: {
  checked: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Box
      width={label.length + 5}
      height={1}
      onMouseDown={(event: { preventDefault?: () => void; stopPropagation?: () => void }) => {
        event.preventDefault?.();
        event.stopPropagation?.();
        onPress();
      }}
    >
      <Text fg={checked ? colors.text : colors.textDim}>{checked ? "[x]" : "[ ]"} {label}</Text>
    </Box>
  );
}

function RelationshipGraphPane({ focused, width, height }: PaneProps) {
  const pane = usePaneInstance();
  const { symbol, exchange } = useBoundTicker();
  const pair = useMemo(() => relationshipSymbolsFromPaneSettings(pane?.settings, symbol), [pane?.settings, symbol]);
  const [range, setRange] = usePluginPaneState<RelationshipRange>("range", "1Y");
  const [correlationWindow, setCorrelationWindow] = usePluginPaneState<number>(
    "correlationWindow",
    DEFAULT_RELATIONSHIP_CORRELATION_WINDOW,
  );
  const [showCorrelation, setShowCorrelation] = usePluginPaneState<boolean>("showCorrelation", true);
  const [showRegression, setShowRegression] = usePluginPaneState<boolean>("showRegression", true);
  const [cursorDateMs, setCursorDateMs] = useState<number | null>(null);
  const { data, loading, error } = useRelationshipHistories(pair, range, exchange);
  const left = data?.[0] ?? null;
  const right = data?.[1] ?? null;
  const analysis = useMemo(() => (
    left && right ? buildRelationshipAnalysis(left.points, right.points, correlationWindow) : null
  ), [correlationWindow, left, right]);
  const cycleRange = useCallback(() => setRange((current) => nextRelationshipRange(current)), [setRange]);
  const cycleWindow = useCallback(() => setCorrelationWindow((current) => nextRelationshipWindow(current)), [setCorrelationWindow]);
  const toggleCorrelation = useCallback(() => setShowCorrelation((current) => !current), [setShowCorrelation]);
  const toggleRegression = useCallback(() => setShowRegression((current) => !current), [setShowRegression]);
  const leftSymbol = pair?.[0] ?? left?.symbol ?? "";
  const rightSymbol = pair?.[1] ?? right?.symbol ?? "";
  const ratioTrend = (analysis?.ratioPoints.at(-1)?.close ?? 0) >= (analysis?.ratioPoints[0]?.close ?? 0)
    ? "positive"
    : "negative";
  const ratioPalette = useMemo(() => resolveChartPalette(colors, ratioTrend), [ratioTrend]);
  const chartWidth = Math.max(20, width - 2);
  const headerRows = 1;
  const availableChartRows = Math.max(8, height - headerRows);
  const showScatter = showRegression && availableChartRows >= 17;
  const priceHeight = Math.max(5, Math.floor(availableChartRows * (showScatter ? 0.26 : 0.34)));
  const ratioHeight = Math.max(4, Math.floor(availableChartRows * (showScatter ? 0.22 : 0.33)));
  const correlationHeight = showCorrelation
    ? Math.max(4, Math.floor(availableChartRows * (showScatter ? 0.22 : 0.33)))
    : 0;
  const statsRailWidth = showScatter && chartWidth >= 68 ? Math.min(34, Math.floor(chartWidth * 0.3)) : 0;
  const statsBelowRows = showScatter && statsRailWidth === 0 ? 1 : 0;
  const scatterHeight = showScatter
    ? Math.max(5, availableChartRows - priceHeight - ratioHeight - correlationHeight - statsBelowRows)
    : 0;
  const scatterWidth = statsRailWidth > 0 ? Math.max(20, chartWidth - statsRailWidth - 1) : chartWidth;
  const stats = analysis?.stats ?? null;
  const alignedDates = useMemo(() => analysis?.aligned.map((entry) => entry.date) ?? [], [analysis]);
  const cursorDate = useMemo(() => {
    if (alignedDates.length === 0) return null;
    if (cursorDateMs !== null && alignedDates.some((date) => date.getTime() === cursorDateMs)) {
      return new Date(cursorDateMs);
    }
    return alignedDates.at(-1) ?? null;
  }, [alignedDates, cursorDateMs]);
  const selectedAligned = useMemo(
    () => analysis ? findRelationshipAlignedPoint(analysis.aligned, cursorDate) : null,
    [analysis, cursorDate],
  );
  const selectedCorrelation = useMemo(
    () => analysis ? findRelationshipCorrelationAtDate(analysis.correlationPoints, cursorDate) : null,
    [analysis, cursorDate],
  );
  const priceSeries = useMemo(
    () => analysis ? buildIndexedPriceSeries(analysis.aligned, leftSymbol, rightSymbol) : [],
    [analysis, leftSymbol, rightSymbol],
  );
  const ratioSeries = useMemo(
    () => analysis ? buildRelationshipRatioSeries(analysis.aligned, leftSymbol, rightSymbol, ratioPalette.lineColor) : [],
    [analysis, leftSymbol, ratioPalette.lineColor, rightSymbol],
  );
  const correlationSeries = useMemo(
    () => analysis ? buildRelationshipCorrelationSeries(analysis.aligned, analysis.correlationPoints) : [],
    [analysis],
  );
  const scatterPoints = useMemo(
    () => analysis ? buildRelationshipScatterPointsForDate(analysis.returns, cursorDate) : [],
    [analysis, cursorDate],
  );
  const selectedPriceBase = analysis?.aligned[0] ?? null;
  const selectedLeftIndex = selectedAligned && selectedPriceBase
    ? (selectedAligned.leftClose / selectedPriceBase.leftClose) * 100
    : null;
  const selectedRightIndex = selectedAligned && selectedPriceBase
    ? (selectedAligned.rightClose / selectedPriceBase.rightClose) * 100
    : null;
  const selectedRatio = selectedAligned?.ratio ?? analysis?.latestRatio ?? null;
  const selectCursorDate = useCallback((date: Date) => setCursorDateMs(date.getTime()), []);
  const metricsRows = useMemo(
    () => analysis ? buildRelationshipMetricsRows(stats, analysis) : [],
    [analysis, stats],
  );
  const footerSummary = useMemo(() => {
    const parts = [
      cursorDate ? formatDateTime(cursorDate).slice(0, 10) : "latest",
      `ratio ${formatNullableNumber(selectedRatio, 3)}`,
      `corr ${formatNullableNumber(selectedCorrelation, 3)}`,
      ...(leftSymbol ? [`${leftSymbol} ${formatNullableNumber(selectedLeftIndex, 1)}`] : []),
      ...(rightSymbol ? [`${rightSymbol} ${formatNullableNumber(selectedRightIndex, 1)}`] : []),
    ];
    return parts.join("  ");
  }, [
    cursorDate,
    leftSymbol,
    rightSymbol,
    selectedCorrelation,
    selectedLeftIndex,
    selectedRatio,
    selectedRightIndex,
  ]);

  useEffect(() => {
    if (!analysis?.aligned.length) return;
    setCursorDateMs((current) => {
      if (current !== null && analysis.aligned.some((entry) => entry.date.getTime() === current)) return current;
      return analysis.aligned.at(-1)?.date.getTime() ?? null;
    });
  }, [analysis]);

  useShortcut((event) => {
    if (!focused) return;
    switch (event.name) {
      case "t":
        event.preventDefault();
        event.stopPropagation();
        cycleRange();
        return;
      case "w":
        event.preventDefault();
        event.stopPropagation();
        cycleWindow();
        return;
      case "c":
        event.preventDefault();
        event.stopPropagation();
        toggleCorrelation();
        return;
      case "g":
        event.preventDefault();
        event.stopPropagation();
        toggleRegression();
        return;
    }
  });

  usePaneFooter("relationship-graph", () => ({
    info: [
      { id: "summary", parts: [{ text: footerSummary, tone: "muted" as const }] },
      ...(loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : []),
    ],
    hints: [
      { id: "range", key: "t", label: "range", onPress: cycleRange },
      { id: "window", key: "w", label: "win", onPress: cycleWindow },
      { id: "correlation", key: "c", label: "corr", onPress: toggleCorrelation },
      { id: "regression", key: "g", label: "reg", onPress: toggleRegression },
    ],
  }), [
    cycleRange,
    cycleWindow,
    error,
    footerSummary,
    loading,
    toggleCorrelation,
    toggleRegression,
  ]);

  if (!pair) {
    return (
      <Box padding={1}>
        <Text fg={colors.textDim}>No relationship tickers configured.</Text>
      </Box>
    );
  }

  if (!analysis || analysis.aligned.length < 2) {
    return (
      <Box padding={1} flexDirection="column" gap={1}>
        <Text fg={error ? colors.warning : colors.textDim}>
          {loading ? "Loading relationship history..." : error ?? "No overlapping price history."}
        </Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      overflow="hidden"
      paddingX={1}
    >
      <Box height={1} flexDirection="row" gap={2}>
        <RelationshipToggle checked={showCorrelation} label="Correlation" onPress={toggleCorrelation} />
        <RelationshipToggle checked={showRegression} label="Regression" onPress={toggleRegression} />
        <Text fg={colors.textDim}>Range {range}  Window {correlationWindow}d</Text>
      </Box>
      <StaticMultiLineChartSurface
        series={priceSeries}
        width={chartWidth}
        height={priceHeight}
        dates={alignedDates}
        cursorDate={cursorDate}
        showTimeAxis
        timeAxisColor={colors.textDim}
        yAxisLabel={`Indexed price (${leftSymbol}, ${rightSymbol})`}
        yAxisColor={colors.textDim}
        formatYAxisValue={(value) => formatNumber(value, 0)}
        onCursorDateChange={selectCursorDate}
      />
      <StaticMultiLineChartSurface
        series={ratioSeries}
        width={chartWidth}
        height={ratioHeight}
        dates={alignedDates}
        cursorDate={cursorDate}
        showTimeAxis
        timeAxisColor={colors.textDim}
        yAxisLabel={`${leftSymbol}/${rightSymbol} ratio`}
        yAxisColor={colors.textDim}
        formatYAxisValue={(value) => formatNumber(value, Math.abs(value) >= 10 ? 1 : 3)}
        onCursorDateChange={selectCursorDate}
      />
      {showCorrelation ? (
        <StaticMultiLineChartSurface
          series={correlationSeries}
          width={chartWidth}
          height={correlationHeight}
          dates={alignedDates}
          cursorDate={cursorDate}
          showTimeAxis
          timeAxisColor={colors.textDim}
          yAxisLabel={`Rolling corr (${correlationWindow}d)`}
          yAxisColor={colors.textDim}
          formatYAxisValue={(value) => formatNumber(value, 2)}
          onCursorDateChange={selectCursorDate}
        />
      ) : null}
      {showScatter ? (
        <Box flexDirection="row" width={chartWidth} height={scatterHeight}>
          <StaticScatterChartSurface
            points={scatterPoints}
            width={scatterWidth}
            height={scatterHeight}
            regression={showRegression && stats ? { slope: stats.beta, intercept: stats.alpha, color: "#ffd43b" } : null}
            xLabel={`${rightSymbol} returns (%)`}
            yLabel={`${leftSymbol} returns (%)`}
          />
          {statsRailWidth > 0 ? (
            <>
              <Box width={1} />
              <Box width={statsRailWidth} height={scatterHeight} flexDirection="column">
                <RelationshipMetricsTable rows={metricsRows} width={statsRailWidth} height={scatterHeight} />
              </Box>
            </>
          ) : null}
        </Box>
      ) : null}
      {showRegression && (!showScatter || statsRailWidth === 0) ? (
        <Text fg={colors.textDim}>
          {metricsRows.map((row) => `${row.label} ${row.value}`).join("  ")}
        </Text>
      ) : null}
    </Box>
  );
}

export function buildEstimateRows(data: AnalystResearchData | null): EstimateRow[] {
  const epsRows = (data?.earningsEstimates ?? []).map((estimate, index) => ({
    key: `eps:${estimate.date}:${estimate.period}:${index}`,
    type: "EPS" as const,
    estimate,
  }));
  const revenueRows = (data?.revenueEstimates ?? []).map((estimate, index) => ({
    key: `revenue:${estimate.date}:${estimate.period}:${index}`,
    type: "Revenue" as const,
    estimate,
  }));
  return [...epsRows, ...revenueRows].sort((left, right) =>
    left.estimate.date.localeCompare(right.estimate.date) ||
    left.type.localeCompare(right.type),
  );
}

function buildEstimateColumns(width: number): EstimateColumn[] {
  const typeWidth = 8;
  const dateWidth = 11;
  const analystsWidth = 5;
  const valueWidth = 11;
  const growthWidth = 9;
  const periodWidth = Math.max(12, width - 2 - typeWidth - dateWidth - analystsWidth - valueWidth * 4 - growthWidth - 8);
  return [
    { id: "type", label: "TYPE", width: typeWidth, align: "left" },
    { id: "date", label: "DATE", width: dateWidth, align: "left" },
    { id: "period", label: "PERIOD", width: periodWidth, align: "left" },
    { id: "analysts", label: "ANL", width: analystsWidth, align: "right" },
    { id: "average", label: "AVG", width: valueWidth, align: "right" },
    { id: "low", label: "LOW", width: valueWidth, align: "right" },
    { id: "high", label: "HIGH", width: valueWidth, align: "right" },
    { id: "yearAgo", label: "YR AGO", width: valueWidth, align: "right" },
    { id: "growth", label: "GROWTH", width: growthWidth, align: "right" },
  ];
}

function formatEstimateValue(row: EstimateRow, value: number | undefined): string {
  if (value == null) return "-";
  return row.type === "Revenue" ? formatCompact(value) : formatNumber(value, 2);
}

function EarningsEstimatesPane({ focused, width, height }: PaneProps) {
  const dataProvider = useAssetData();
  const { symbol, exchange } = useBoundTicker();
  const [selectedIdx, setSelectedIdx] = usePluginPaneState<number>("selectedIdx", 0);
  const loader = useCallback((nextSymbol: string, nextExchange: string, forceRefresh: boolean) => {
    if (!dataProvider?.getAnalystResearch) throw new Error("Analyst estimates unavailable");
    return dataProvider.getAnalystResearch(
      nextSymbol,
      nextExchange,
      forceRefresh ? { cacheMode: "refresh" } : undefined,
    );
  }, [dataProvider]);
  const { data, loading, error, reload } = useTickerRequest<AnalystResearchData>(loader, symbol, exchange);
  const rows = useMemo(() => buildEstimateRows(data), [data]);
  const columns = useMemo(() => buildEstimateColumns(width), [width]);
  const boundedSelectedIdx = rows.length > 0 ? Math.min(selectedIdx, rows.length - 1) : -1;

  useEffect(() => {
    if (rows.length > 0 && selectedIdx >= rows.length) setSelectedIdx(rows.length - 1);
  }, [rows.length, selectedIdx, setSelectedIdx]);

  const handleKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name !== "r") return false;
    event.preventDefault?.();
    reload();
    return true;
  }, [reload]);

  const renderCell = useCallback((
    row: EstimateRow,
    column: EstimateColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "type":
        return { text: row.type, color: selectedColor ?? colors.textBright, attributes: TextAttributes.BOLD };
      case "date":
        return { text: row.estimate.date || "-", color: selectedColor ?? colors.textDim };
      case "period":
        return { text: row.estimate.period.replace(/_/g, " ") || "-", color: selectedColor ?? colors.text };
      case "analysts":
        return { text: row.estimate.analysts == null ? "-" : String(row.estimate.analysts), color: selectedColor ?? colors.textDim };
      case "average":
        return { text: formatEstimateValue(row, row.estimate.average), color: selectedColor ?? colors.textBright };
      case "low":
        return { text: formatEstimateValue(row, row.estimate.low), color: selectedColor ?? colors.textDim };
      case "high":
        return { text: formatEstimateValue(row, row.estimate.high), color: selectedColor ?? colors.textDim };
      case "yearAgo":
        return { text: formatEstimateValue(row, row.estimate.yearAgo), color: selectedColor ?? colors.textDim };
      case "growth":
        return { text: formatMaybePercent(row.estimate.growth ?? null), color: selectedColor ?? priceColor(row.estimate.growth ?? 0) };
    }
  }, []);

  usePaneFooter("earnings-estimates", () => ({
    info: [
      ...(loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : []),
    ],
    hints: [{ id: "refresh", key: "r", label: "efresh", onPress: reload }],
  }), [error, loading, reload]);

  return (
    <DataTableView<EstimateRow, EstimateColumn>
      focused={focused}
      selectedIndex={boundedSelectedIdx}
      onSelectIndex={(index) => setSelectedIdx(index)}
      onRootKeyDown={handleKeyDown}
      rootWidth={width}
      rootHeight={height}
      columns={columns}
      items={rows}
      sortColumnId={null}
      sortDirection="asc"
      onHeaderClick={() => {}}
      getItemKey={(row) => row.key}
      isSelected={(_row, index) => index === boundedSelectedIdx}
      onSelect={(_row, index) => setSelectedIdx(index)}
      renderCell={renderCell}
      emptyStateTitle={loading ? "Loading earnings estimates..." : "No earnings estimates"}
    />
  );
}

function resultSymbol(result: InstrumentSearchResult): string {
  return result.symbol.trim().toUpperCase();
}

function useSearchQuerySetting(): string {
  const pane = usePaneInstance();
  const raw = pane?.settings?.query;
  return typeof raw === "string" ? raw.trim() : "";
}

function buildSearchColumns(width: number): Array<DataTableColumn & { id: "symbol" | "name" | "exchange" | "type" }> {
  const symbolWidth = 12;
  const exchangeWidth = 14;
  const typeWidth = 10;
  const nameWidth = Math.max(18, width - 2 - symbolWidth - exchangeWidth - typeWidth - 4);
  return [
    { id: "symbol", label: "TICKER", width: symbolWidth, align: "left" },
    { id: "name", label: "NAME", width: nameWidth, align: "left" },
    { id: "exchange", label: "EXCHANGE", width: exchangeWidth, align: "left" },
    { id: "type", label: "TYPE", width: typeWidth, align: "left" },
  ];
}

function SearchResultsPane({ focused, width, height }: PaneProps) {
  const dataProvider = useAssetData();
  const query = useSearchQuerySetting();
  const { pinTicker } = usePluginTickerActions();
  const [selectedIdx, setSelectedIdx] = usePluginPaneState<number>("selectedIdx", 0);
  const [state, setState] = useState<LoadState<InstrumentSearchResult[]>>({
    data: null,
    loading: false,
    error: null,
  });
  const fetchGenRef = useRef(0);

  const load = useCallback((forceRefresh = false) => {
    if (!query) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    if (!dataProvider) {
      setState({ data: null, loading: false, error: "Search unavailable" });
      return;
    }
    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    dataProvider.search(query, forceRefresh ? { preferBroker: false } : undefined)
      .then((results) => {
        if (fetchGenRef.current !== gen) return;
        setState({ data: results, loading: false, error: null });
      })
      .catch((error) => {
        if (fetchGenRef.current !== gen) return;
        setState({ data: null, loading: false, error: error instanceof Error ? error.message : String(error) });
      });
  }, [dataProvider, query]);

  useEffect(() => {
    load(false);
  }, [load]);

  const rows = state.data ?? [];
  const columns = useMemo(() => buildSearchColumns(width), [width]);
  const boundedSelectedIdx = rows.length > 0 ? Math.min(selectedIdx, rows.length - 1) : -1;
  const openResult = useCallback((row: InstrumentSearchResult) => {
    pinTicker(resultSymbol(row), { floating: true, paneType: "ticker-detail" });
  }, [pinTicker]);

  useEffect(() => {
    if (rows.length > 0 && selectedIdx >= rows.length) setSelectedIdx(rows.length - 1);
  }, [rows.length, selectedIdx, setSelectedIdx]);

  const handleKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name !== "r") return false;
    event.preventDefault?.();
    load(true);
    return true;
  }, [load]);

  const renderCell = useCallback((
    row: InstrumentSearchResult,
    column: DataTableColumn & { id: "symbol" | "name" | "exchange" | "type" },
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "symbol":
        return { text: resultSymbol(row), color: selectedColor ?? colors.textBright, attributes: TextAttributes.BOLD };
      case "name":
        return { text: row.name || "-", color: selectedColor ?? colors.text };
      case "exchange":
        return { text: row.exchange || row.primaryExchange || "-", color: selectedColor ?? colors.textDim };
      case "type":
        return { text: row.type || "-", color: selectedColor ?? colors.textDim };
    }
  }, []);

  usePaneFooter("provider-search", () => ({
    info: [
      ...(query ? [{ id: "query", parts: [{ text: query, tone: "muted" as const }] }] : []),
      ...(state.loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(state.error ? [{ id: "error", parts: [{ text: state.error, tone: "warning" as const }] }] : []),
    ],
    hints: [{ id: "refresh", key: "r", label: "efresh", onPress: () => load(true) }],
  }), [load, query, state.error, state.loading]);

  return (
    <DataTableView<InstrumentSearchResult, DataTableColumn & { id: "symbol" | "name" | "exchange" | "type" }>
      focused={focused}
      selectedIndex={boundedSelectedIdx}
      onSelectIndex={(index) => setSelectedIdx(index)}
      onActivateIndex={(_index, row) => openResult(row)}
      onRootKeyDown={handleKeyDown}
      rootWidth={width}
      rootHeight={height}
      columns={columns}
      items={rows}
      sortColumnId={null}
      sortDirection="asc"
      onHeaderClick={() => {}}
      getItemKey={(row, index) => `${row.providerId}:${row.symbol}:${row.exchange}:${row.type}:${index}`}
      isSelected={(_row, index) => index === boundedSelectedIdx}
      onSelect={(_row, index) => setSelectedIdx(index)}
      renderCell={renderCell}
      emptyStateTitle={state.loading ? "Searching..." : query ? "No search results" : "No search query"}
    />
  );
}

function graphTemplateSymbols(
  activeTicker: string | null,
  options: Pick<PaneTemplateCreateOptions, "arg" | "values" | "symbols"> | undefined,
): string[] {
  if (options?.symbols?.length) return options.symbols;
  const raw = options?.arg ?? options?.values?.tickers ?? activeTicker ?? "";
  try {
    return parseTickerListInput(raw);
  } catch {
    return [];
  }
}

function relationshipTemplateSymbols(
  activeTicker: string | null,
  options: Pick<PaneTemplateCreateOptions, "arg" | "values" | "symbols"> | undefined,
): [string, string] | null {
  if (options?.symbols?.length) return normalizeRelationshipSymbols(options.symbols);
  const raw = options?.arg ?? options?.values?.tickers ?? activeTicker ?? "";
  try {
    return normalizeRelationshipSymbols(parseTickerListInput(raw));
  } catch {
    return null;
  }
}

function createGraphPaneTemplate({
  id,
  label,
  description,
  shortcut,
  chartKind,
}: {
  id: string;
  label: string;
  description: string;
  shortcut: "GF" | "GE";
  chartKind: GraphKind;
}): PaneTemplateDef {
  return {
    id,
    paneId: "fundamental-graph",
    label,
    description,
    keywords: chartKind === "valuation"
      ? ["valuation", "graph", "ge", "multiples", "pe", "sales"]
      : ["fundamental", "graph", "gf", "financials", "statements"],
    shortcut: { prefix: shortcut, argPlaceholder: "tickers", argKind: "ticker-list" as const },
    wizard: [
      {
        key: "tickers",
        label: "Tickers",
        placeholder: "AMD, NVDA",
        body: ["Enter one or more ticker symbols separated by commas."],
        type: "text" as const,
      },
    ],
    canCreate: (context, options) => graphTemplateSymbols(context.activeTicker, options).length > 0,
    createInstance: (context, options) => {
      const symbols = graphTemplateSymbols(context.activeTicker, options);
      const primarySymbol = symbols[0];
      return primarySymbol
        ? {
          title: `${shortcut} ${formatTickerListInput(symbols)}`,
          binding: { kind: "fixed" as const, symbol: primarySymbol },
          placement: "floating" as const,
          settings: {
            chartKind,
            symbols,
            symbolsText: formatTickerListInput(symbols),
          },
        }
        : null;
    },
  };
}

export const bloombergFunctionsPlugin: GloomPlugin = {
  id: "bloomberg-functions",
  name: "Bloomberg Functions",
  version: "1.0.0",
  description: "Bloomberg-style data panes for historical prices, statement charts, estimates, and provider search.",

  setup(ctx) {
    ctx.registerDetailTab({
      id: "fundamental-graphs",
      name: "Graphs",
      order: 28,
      component: FundamentalGraphsDetailTab,
      isVisible: ({ ticker, financials }) => !!ticker && (
        (financials?.annualStatements.length ?? 0) > 0
        || (financials?.quarterlyStatements.length ?? 0) > 0
        || !!financials?.fundamentals
        || !!financials?.quote?.marketCap
      ),
    });
  },

  panes: [
    {
      id: "historical-prices",
      name: "Historical Prices",
      icon: "H",
      component: HistoricalPricesPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 92, height: 26 },
    },
    {
      id: "fundamental-graph",
      name: "Fundamental Graph",
      icon: "G",
      component: FundamentalGraphPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 82, height: 22 },
    },
    {
      id: "relationship-graph",
      name: "Relationship Graph",
      icon: "R",
      component: RelationshipGraphPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
    },
    {
      id: "earnings-estimates",
      name: "Earnings Estimates",
      icon: "E",
      component: EarningsEstimatesPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 96, height: 22 },
    },
    {
      id: "provider-search-results",
      name: "Provider Search",
      icon: "S",
      component: SearchResultsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 86, height: 24 },
    },
  ],

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "historical-prices-pane",
      paneId: "historical-prices",
      label: "Historical Prices",
      description: "Open a historical OHLCV table for a ticker.",
      keywords: ["historical", "prices", "hp", "ohlc", "volume"],
      shortcut: "HP",
    }),
    createGraphPaneTemplate({
      id: "fundamental-graph-pane",
      label: "Fundamental Graph",
      description: "Graph statement metrics for one or more tickers.",
      shortcut: "GF",
      chartKind: "fundamental",
    }),
    createGraphPaneTemplate({
      id: "valuation-graph-pane",
      label: "Valuation Graph",
      description: "Graph valuation multiples for one or more tickers.",
      shortcut: "GE",
      chartKind: "valuation",
    }),
    {
      id: "relationship-graph-pane",
      paneId: "relationship-graph",
      label: "Relationship Graph",
      description: "Graph ratio, rolling correlation, and regression between two tickers.",
      keywords: ["relationship", "ratio", "graph", "correlation", "regression", "gr"],
      shortcut: { prefix: "GR", argPlaceholder: "tickers", argKind: "ticker-list" },
      wizard: [
        {
          key: "tickers",
          label: "Relationship Tickers",
          placeholder: "AMD, NVDA",
          body: [`Enter one or two tickers. One ticker compares against ${DEFAULT_RELATIONSHIP_SECOND_SYMBOL}.`],
          type: "text",
        },
      ],
      canCreate: (context, options) => !!relationshipTemplateSymbols(context.activeTicker, options),
      createInstance: (context, options) => {
        const pair = relationshipTemplateSymbols(context.activeTicker, options);
        return pair
          ? {
            title: `GR ${pair[0]}/${pair[1]}`,
            binding: { kind: "fixed" as const, symbol: pair[0] },
            placement: "floating" as const,
            settings: {
              symbols: pair,
              symbolsText: formatTickerListInput(pair),
            },
          }
          : null;
      },
    },
    createTickerSurfacePaneTemplate({
      id: "earnings-estimates-pane",
      paneId: "earnings-estimates",
      label: "Earnings Estimates",
      description: "Open analyst earnings and revenue estimates for a ticker.",
      keywords: ["earnings", "estimates", "ee", "analyst", "eps"],
      shortcut: "EE",
    }),
    {
      id: "provider-search-pane",
      paneId: "provider-search-results",
      label: "Provider Search",
      description: "Search upstream provider instruments and open a selected ticker.",
      keywords: ["search", "srch", "provider", "symbol"],
      shortcut: { prefix: "SRCH", argPlaceholder: "query", argKind: "text" },
      wizard: [
        {
          key: "query",
          label: "Search Query",
          placeholder: "apple, sony, AAPL",
          type: "text",
        },
      ],
      canCreate: (_context, options) => !!(options?.arg ?? options?.values?.query)?.trim(),
      createInstance: (_context, options) => {
        const query = (options?.arg ?? options?.values?.query ?? "").trim();
        return query
          ? {
            title: `SRCH ${query}`,
            placement: "floating",
            settings: { query },
          }
          : null;
      },
    },
  ],
};
