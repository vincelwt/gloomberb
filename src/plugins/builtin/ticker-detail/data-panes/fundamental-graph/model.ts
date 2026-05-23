import type { BarChartSeries } from "../../../../../components/chart/bar-chart-renderer";
import { colors } from "../../../../../theme/colors";
import type { FinancialStatement, TickerFinancials } from "../../../../../types/financials";
import { formatCompact, formatNumber, formatPercent } from "../../../../../utils/format";
import type {
  FundamentalColumn,
  FundamentalGraphRow,
  FundamentalMetricKey,
  FundamentalPeriod,
  GraphKind,
  GraphMetricKey,
  MetricDefinition,
  ValuationMetricKey,
} from "./types";

const FUNDAMENTAL_METRICS: ReadonlyArray<MetricDefinition<FundamentalMetricKey>> = [
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

const VALUATION_METRICS: ReadonlyArray<MetricDefinition<ValuationMetricKey>> = [
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

export function formatMaybePercent(value: number | null): string {
  return value == null ? "-" : formatPercent(value);
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

function metricDefs(kind: GraphKind): ReadonlyArray<MetricDefinition> {
  return kind === "valuation" ? VALUATION_METRICS : FUNDAMENTAL_METRICS;
}

export function defaultMetric(kind: GraphKind): GraphMetricKey {
  return kind === "valuation" ? "priceSales" : "totalRevenue";
}

export function isMetricForKind(kind: GraphKind, metric: GraphMetricKey): boolean {
  return metricDefs(kind).some((definition) => definition.key === metric);
}

export function nextMetric(kind: GraphKind, current: GraphMetricKey): GraphMetricKey {
  const definitions = metricDefs(kind);
  const index = definitions.findIndex((metric) => metric.key === current);
  return definitions[(index + 1) % definitions.length]?.key ?? defaultMetric(kind);
}

export function metricDef(kind: GraphKind, key: GraphMetricKey): MetricDefinition {
  return metricDefs(kind).find((metric) => metric.key === key) ?? metricDefs(kind)[0]!;
}

export function graphRowsForFinancials(
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

export function buildFundamentalColumns(width: number, multiSymbol: boolean): FundamentalColumn[] {
  const symbolWidth = multiSymbol ? 8 : 0;
  const dateWidth = 12;
  const valueWidth = 14;
  const growthWidth = 10;
  const columns: FundamentalColumn[] = [];

  if (multiSymbol) {
    columns.push({ id: "symbol", label: "TICKER", width: symbolWidth, align: "left" });
  }

  columns.push(
    { id: "date", label: "DATE", width: dateWidth, align: "left" },
    { id: "value", label: "VALUE", width: valueWidth, align: "right" },
    {
      id: "growth",
      label: "CHG",
      width: Math.max(growthWidth, width - 2 - symbolWidth - dateWidth - valueWidth - 3),
      align: "right",
    },
  );

  return columns;
}

export function buildGraphBarSeries(rows: FundamentalGraphRow[]): BarChartSeries[] {
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
