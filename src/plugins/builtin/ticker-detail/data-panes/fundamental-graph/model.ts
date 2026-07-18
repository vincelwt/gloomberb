import type { BarChartSeries } from "../../../../../components/chart/bar-chart-renderer";
import { colors } from "../../../../../theme/colors";
import type { FinancialStatement, PricePoint, TickerFinancials } from "../../../../../types/financials";
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

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function financialRatio(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
): number | null {
  return finiteNumber(numerator) && finiteNumber(denominator) && denominator !== 0
    ? numerator / denominator
    : null;
}

function freeCashFlowValue(statement: FinancialStatement): number | null {
  if (finiteNumber(statement.freeCashFlow)) return statement.freeCashFlow;
  if (finiteNumber(statement.operatingCashFlow) && finiteNumber(statement.capitalExpenditure)) {
    return statement.operatingCashFlow + statement.capitalExpenditure;
  }
  return null;
}

function formatMargin(value: number): string {
  return `${formatNumber(value * 100, 1)}%`;
}

const FUNDAMENTAL_METRICS: ReadonlyArray<MetricDefinition<FundamentalMetricKey>> = [
  { key: "totalRevenue", label: "Revenue", format: formatCompact },
  { key: "grossProfit", label: "Gross Profit", format: formatCompact },
  {
    key: "grossMargin",
    label: "Gross Margin",
    format: formatMargin,
    value: (statement) => financialRatio(statement.grossProfit, statement.totalRevenue),
  },
  { key: "operatingIncome", label: "Operating Income", format: formatCompact },
  {
    key: "operatingMargin",
    label: "Operating Margin",
    format: formatMargin,
    value: (statement) => financialRatio(statement.operatingIncome, statement.totalRevenue),
  },
  { key: "netIncome", label: "Net Income", format: formatCompact },
  {
    key: "netMargin",
    label: "Net Margin",
    format: formatMargin,
    value: (statement) => financialRatio(statement.netIncome, statement.totalRevenue),
  },
  { key: "operatingCashFlow", label: "Operating Cash Flow", format: formatCompact },
  { key: "freeCashFlow", label: "Free Cash Flow", format: formatCompact, value: freeCashFlowValue },
  {
    key: "freeCashFlowMargin",
    label: "FCF Margin",
    format: formatMargin,
    value: (statement) => financialRatio(freeCashFlowValue(statement), statement.totalRevenue),
  },
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
  if (period === "annual") return financials?.annualStatements ?? [];
  return deriveQuarterlyStatements(financials?.quarterlyStatements ?? [], financials?.annualStatements ?? []);
}

function periodCategory(date: string, period: FundamentalPeriod): string {
  const parsedYear = Number(date.slice(0, 4));
  let year = Number.isFinite(parsedYear) ? parsedYear : 0;
  if (period === "annual") return year > 0 ? `FY${year}` : date;
  let month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  if (Number.isFinite(month) && Number.isFinite(day) && day <= 7 && (month - 1) % 3 === 0) {
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  const quarter = Number.isFinite(month) && month > 0 ? Math.ceil(month / 3) : 0;
  return quarter > 0 && year > 0 ? `${year} Q${quarter}` : date;
}

type NumericStatementField = Exclude<keyof FinancialStatement, "date">;

const QUARTERLY_FLOW_FIELDS: NumericStatementField[] = [
  "totalRevenue",
  "grossProfit",
  "operatingIncome",
  "netIncome",
  "ebitda",
  "operatingCashFlow",
  "capitalExpenditure",
  "freeCashFlow",
  "eps",
];

const QUARTERLY_SNAPSHOT_FIELDS: NumericStatementField[] = [
  "totalAssets",
  "cashAndCashEquivalents",
  "cashCashEquivalentsAndShortTermInvestments",
  "totalDebt",
  "totalEquity",
  "basicShares",
  "dilutedShares",
  "shareIssued",
  "ordinarySharesNumber",
];

function statementNumber(statement: FinancialStatement, field: NumericStatementField): number | null {
  const value = statement[field];
  return finiteNumber(value) ? value : null;
}

function setStatementNumber(statement: FinancialStatement, field: NumericStatementField, value: number): void {
  (statement as Record<NumericStatementField, number | undefined>)[field] = value;
}

function statementTime(statement: FinancialStatement): number {
  const time = Date.parse(statement.date);
  return Number.isFinite(time) ? time : Number.NaN;
}

function precedingQuarterValues(
  quarterlyStatements: FinancialStatement[],
  annualStatement: FinancialStatement,
  field: NumericStatementField,
): number[] {
  const annualTime = statementTime(annualStatement);
  if (!Number.isFinite(annualTime)) return [];

  const annualCategory = periodCategory(annualStatement.date, "quarterly");
  const byCategory = new Map<string, { date: string; time: number; value: number }>();
  for (const statement of quarterlyStatements) {
    const time = statementTime(statement);
    if (!Number.isFinite(time) || time >= annualTime || annualTime - time > 370 * 24 * 60 * 60 * 1000) {
      continue;
    }
    const category = periodCategory(statement.date, "quarterly");
    if (category === annualCategory) continue;
    const value = statementNumber(statement, field);
    if (value === null) continue;
    const previous = byCategory.get(category);
    if (!previous || statement.date.localeCompare(previous.date) > 0) {
      byCategory.set(category, { date: statement.date, time, value });
    }
  }

  return [...byCategory.values()]
    .sort((left, right) => right.time - left.time)
    .slice(0, 3)
    .sort((left, right) => left.time - right.time)
    .map((entry) => entry.value);
}

function mergeStatementsByDate(statements: FinancialStatement[]): FinancialStatement[] {
  const byDate = new Map<string, FinancialStatement>();
  for (const statement of statements) {
    const existing = byDate.get(statement.date);
    if (!existing) {
      byDate.set(statement.date, { ...statement });
      continue;
    }
    for (const [key, value] of Object.entries(statement) as Array<[keyof FinancialStatement, unknown]>) {
      if (key === "date") continue;
      if (value !== undefined && existing[key] === undefined) {
        (existing as unknown as Record<string, unknown>)[key] = value;
      }
    }
  }
  return [...byDate.values()];
}

function deriveQuarterlyStatements(
  quarterlyStatements: FinancialStatement[],
  annualStatements: FinancialStatement[],
): FinancialStatement[] {
  const mergedQuarterly = mergeStatementsByDate(quarterlyStatements);
  const byDate = new Map(mergedQuarterly.map((statement) => [statement.date, { ...statement }]));

  for (const annualStatement of annualStatements) {
    let target = byDate.get(annualStatement.date);
    let changed = false;
    if (!target) {
      target = { date: annualStatement.date };
    }

    for (const field of QUARTERLY_FLOW_FIELDS) {
      if (statementNumber(target, field) !== null) continue;
      const annualValue = statementNumber(annualStatement, field);
      if (annualValue === null) continue;
      const previousValues = precedingQuarterValues(mergedQuarterly, annualStatement, field);
      if (previousValues.length !== 3) continue;
      const derived = annualValue - previousValues.reduce((sum, value) => sum + value, 0);
      if (!Number.isFinite(derived)) continue;
      setStatementNumber(target, field, derived);
      changed = true;
    }

    for (const field of QUARTERLY_SNAPSHOT_FIELDS) {
      if (statementNumber(target, field) !== null) continue;
      const annualValue = statementNumber(annualStatement, field);
      if (annualValue === null) continue;
      setStatementNumber(target, field, annualValue);
      changed = true;
    }

    if (changed) byDate.set(target.date, target);
  }

  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function fundamentalMetricDef(metric: FundamentalMetricKey): MetricDefinition<FundamentalMetricKey> {
  return FUNDAMENTAL_METRICS.find((definition) => definition.key === metric) ?? FUNDAMENTAL_METRICS[0]!;
}

function fundamentalMetricValue(statement: FinancialStatement, metric: FundamentalMetricKey): number | null {
  const definition = fundamentalMetricDef(metric);
  const value = definition.value
    ? definition.value(statement)
    : statement[metric as keyof FinancialStatement];
  return finiteNumber(value) ? value : null;
}

interface GraphRowEntry {
  date: string;
  category: string;
  value: number;
}

function buildRowsFromEntries(
  entries: GraphRowEntry[],
  metric: GraphMetricKey,
  symbol: string,
): FundamentalGraphRow[] {
  const byCategory = new Map<string, GraphRowEntry>();
  for (const entry of [...entries].sort((left, right) => left.date.localeCompare(right.date))) {
    const previous = byCategory.get(entry.category);
    if (!previous || entry.date.localeCompare(previous.date) >= 0) {
      byCategory.set(entry.category, entry);
    }
  }
  const sorted = [...byCategory.values()].sort((left, right) => left.date.localeCompare(right.date));
  const maxAbs = Math.max(1, ...sorted.map((entry) => Math.abs(entry.value)));

  return sorted.map((entry, index) => {
    const previous = sorted[index - 1]?.value;
    return {
      key: [symbol, entry.date, metric].filter(Boolean).join(":"),
      symbol,
      date: entry.date,
      category: entry.category,
      value: entry.value,
      growth: typeof previous === "number" && previous !== 0
        ? (entry.value - previous) / Math.abs(previous)
        : null,
      barWidth: Math.max(1, Math.round((Math.abs(entry.value) / maxAbs) * 24)),
    };
  });
}

export function buildFundamentalGraphRows(
  statements: FinancialStatement[],
  metric: FundamentalMetricKey,
  symbol = "",
  period: FundamentalPeriod = "annual",
): FundamentalGraphRow[] {
  const entries = statements
    .map((statement) => ({ statement, value: fundamentalMetricValue(statement, metric) }))
    .filter((entry): entry is { statement: FinancialStatement; value: number } => entry.value !== null)
    .map(({ statement, value }) => ({
      date: statement.date,
      category: periodCategory(statement.date, period),
      value,
    }));
  return buildRowsFromEntries(entries, metric, symbol);
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

function timeFromDate(value: Date | string): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

function priceAtOrBefore(priceHistory: PricePoint[], date: string): number | null {
  const target = Date.parse(date);
  if (!Number.isFinite(target)) return null;

  let closest: { time: number; close: number } | null = null;
  for (const point of priceHistory) {
    if (!finiteNumber(point.close) || point.close <= 0) continue;
    const time = timeFromDate(point.date);
    if (!Number.isFinite(time) || time > target) continue;
    if (!closest || time > closest.time) {
      closest = { time, close: point.close };
    }
  }
  return closest?.close ?? null;
}

function statementShares(statement: FinancialStatement): number | null {
  const shares = statement.dilutedShares
    ?? statement.basicShares
    ?? statement.ordinarySharesNumber
    ?? statement.shareIssued;
  return finiteNumber(shares) && shares > 0 ? shares : null;
}

function statementEpsValue(statement: FinancialStatement): number | null {
  if (finiteNumber(statement.eps) && statement.eps !== 0) return statement.eps;
  const shares = statementShares(statement);
  return finiteNumber(statement.netIncome) && shares ? statement.netIncome / shares : null;
}

function aggregateEps(statements: FinancialStatement[]): number | null {
  if (statements.length === 0) return null;
  const epsValues = statements.map(statementEpsValue);
  if (epsValues.every((value): value is number => finiteNumber(value))) {
    return epsValues.reduce((sum, value) => sum + value, 0);
  }

  const latestShares = statementShares(statements.at(-1)!);
  const incomeValues = statements.map((statement) => statement.netIncome);
  if (!latestShares || !incomeValues.every((value): value is number => finiteNumber(value))) {
    return null;
  }
  return incomeValues.reduce((sum, value) => sum + value, 0) / latestShares;
}

function trailingEpsValue(
  statements: FinancialStatement[],
  index: number,
  period: FundamentalPeriod,
): number | null {
  if (period === "annual") return statementEpsValue(statements[index]!);
  if (index < 3) return null;
  return aggregateEps(statements.slice(index - 3, index + 1));
}

function forwardEpsValue(
  statements: FinancialStatement[],
  index: number,
  period: FundamentalPeriod,
): number | null {
  if (period === "annual") {
    const nextStatement = statements[index + 1];
    return nextStatement ? statementEpsValue(nextStatement) : null;
  }
  if (index + 4 >= statements.length) return null;
  return aggregateEps(statements.slice(index + 1, index + 5));
}

function historicalMarketCap(
  financials: TickerFinancials | null,
  statement: FinancialStatement,
): number | null {
  const price = financials ? priceAtOrBefore(financials.priceHistory, statement.date) : null;
  const shares = statementShares(statement);
  if (price && shares) return price * shares;
  return resolveMarketCap(financials);
}

function historicalEnterpriseValue(
  financials: TickerFinancials | null,
  statement: FinancialStatement,
): number | null {
  const marketCap = historicalMarketCap(financials, statement);
  if (!marketCap) return financials?.fundamentals?.enterpriseValue ?? null;
  const debt = finiteNumber(statement.totalDebt) ? statement.totalDebt : 0;
  const cash = statement.cashCashEquivalentsAndShortTermInvestments
    ?? statement.cashAndCashEquivalents
    ?? 0;
  return marketCap + debt - (finiteNumber(cash) ? cash : 0);
}

function currentValuationMetricValue(
  financials: TickerFinancials | null,
  metric: ValuationMetricKey,
): number | null {
  const fundamentals = financials?.fundamentals;
  if (metric === "trailingPE") return fundamentals?.trailingPE ?? null;
  if (metric === "forwardPE") return fundamentals?.forwardPE ?? null;
  if (metric === "pegRatio") return fundamentals?.pegRatio ?? null;
  return null;
}

function valuationMetricValue(
  financials: TickerFinancials | null,
  metric: ValuationMetricKey,
  statement: FinancialStatement | null,
  context?: {
    statements: FinancialStatement[];
    statementIndex: number;
    period: FundamentalPeriod;
  },
): number | null {
  if (metric === "pegRatio" || statement === null) {
    return currentValuationMetricValue(financials, metric);
  }

  if (metric === "trailingPE" || metric === "forwardPE") {
    const price = financials ? priceAtOrBefore(financials.priceHistory, statement.date) : null;
    const eps = context
      ? metric === "trailingPE"
        ? trailingEpsValue(context.statements, context.statementIndex, context.period)
        : forwardEpsValue(context.statements, context.statementIndex, context.period)
      : statementEpsValue(statement);
    return price && eps && eps > 0 ? price / eps : null;
  }

  const marketCap = historicalMarketCap(financials, statement);
  const enterpriseValue = historicalEnterpriseValue(financials, statement);
  const revenue = statement?.totalRevenue;
  const ebitda = statement?.ebitda;
  const freeCashFlow = statement ? freeCashFlowValue(statement) : null;

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
  const sourceStatements = metric === "pegRatio"
    ? [{ date: "Current" } as FinancialStatement]
    : selectedStatements(financials, period);
  const entries = [...sourceStatements]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((statement, statementIndex, statements) => ({
      date: statement.date,
      category: statement.date === "Current" ? "Current" : periodCategory(statement.date, period),
      value: valuationMetricValue(
        financials,
        metric,
        statement.date === "Current" ? null : statement,
        { statements, statementIndex, period },
      ),
    }))
    .filter((entry): entry is GraphRowEntry => finiteNumber(entry.value));
  const currentValue = currentValuationMetricValue(financials, metric);
  if (finiteNumber(currentValue) && !entries.some((entry) => entry.date === "Current") && (
    metric === "pegRatio"
    || metric === "forwardPE"
    || (metric === "trailingPE" && entries.length === 0)
  )) {
    entries.push({ date: "Current", category: "Current", value: currentValue });
  }

  return buildRowsFromEntries(entries, metric, symbol);
}

export function metricDefs(kind: GraphKind): ReadonlyArray<MetricDefinition> {
  return kind === "valuation" ? VALUATION_METRICS : FUNDAMENTAL_METRICS;
}

export function allMetricDefs(): ReadonlyArray<{ kind: GraphKind; definition: MetricDefinition }> {
  return [
    ...FUNDAMENTAL_METRICS.map((definition) => ({ kind: "fundamental" as const, definition })),
    ...VALUATION_METRICS.map((definition) => ({ kind: "valuation" as const, definition })),
  ];
}

export function metricKind(metric: GraphMetricKey): GraphKind | null {
  if (FUNDAMENTAL_METRICS.some((definition) => definition.key === metric)) return "fundamental";
  if (VALUATION_METRICS.some((definition) => definition.key === metric)) return "valuation";
  return null;
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

export function limitGraphRowsBySymbol(
  rows: FundamentalGraphRow[],
  periodCount: number | null | undefined,
): FundamentalGraphRow[] {
  if (!Number.isInteger(periodCount) || periodCount == null || periodCount <= 0) return rows;
  const keysToKeep = new Set<string>();
  const symbols = [...new Set(rows.map((row) => row.symbol))];
  for (const symbol of symbols) {
    const symbolRows = rows
      .filter((row) => row.symbol === symbol)
      .sort((left, right) => left.date.localeCompare(right.date));
    for (const row of symbolRows.slice(-periodCount)) keysToKeep.add(row.key);
  }
  return rows.filter((row) => keysToKeep.has(row.key));
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

function categorySortKey(row: FundamentalGraphRow): string {
  return row.date === "Current" ? "9999-12-31" : row.date;
}

export function buildGraphBarSeries(rows: FundamentalGraphRow[]): BarChartSeries[] {
  const symbols = [...new Set(rows.map((row) => row.symbol || ""))];
  const categoryOrder = new Map<string, string>();
  for (const row of rows) {
    const sortKey = categorySortKey(row);
    const previous = categoryOrder.get(row.category);
    if (!previous || sortKey.localeCompare(previous) < 0) {
      categoryOrder.set(row.category, sortKey);
    }
  }
  const categories = [...categoryOrder.entries()]
    .sort((left, right) => left[1].localeCompare(right[1]) || left[0].localeCompare(right[0]))
    .map(([category]) => category);
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
