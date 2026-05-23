import type { FinancialStatement, TickerFinancials } from "../../../types/financials";
import {
  formatGrowthShort,
  formatNumber,
  formatWithDivisor,
  padTo,
  pickUnit,
} from "../../../utils/format";
import {
  buildPreviousStatementMap,
  computeTTM,
  type FinancialPeriod,
} from "./financials-aggregation";
import { FINANCIAL_SUB_TABS } from "./financials-schema";

export { buildPreviousStatementMap, computeTTM } from "./financials-aggregation";
export { FINANCIAL_SUB_TABS, FINANCIAL_SUB_TABS_WIDTH } from "./financials-schema";
export type { FinancialPeriod } from "./financials-aggregation";

type FinancialMetricFormat = "compact" | "eps" | "percent";

export type MetricDef = {
  label: string;
  key?: keyof FinancialStatement;
  id?: string;
  compute?: (statement: FinancialStatement) => number | undefined;
  format: FinancialMetricFormat;
  showGrowth?: boolean;
};

export type FinancialRowDef = MetricDef | FinancialGroupDef;

type FinancialGroupDef = {
  kind: "group";
  id: string;
  label: string;
  summaryKey?: keyof FinancialStatement;
  format?: FinancialMetricFormat;
  defaultExpanded?: boolean;
  children: FinancialRowDef[];
};

export type FinancialSubTab = {
  name: string;
  key: string;
  rows: FinancialRowDef[];
};

export type FinancialTableRow =
  | {
    kind: "metric";
    id: string;
    key?: keyof FinancialStatement;
    compute?: (statement: FinancialStatement) => number | undefined;
    unitLabel: string;
    divisor: number;
    format: FinancialMetricFormat;
    showGrowth: boolean;
    depth: number;
  }
  | {
    kind: "group";
    id: string;
    label: string;
    unitLabel: string;
    summaryKey?: keyof FinancialStatement;
    divisor: number;
    format: FinancialMetricFormat;
    depth: number;
    expanded: boolean;
    toggleable: boolean;
  };

export function statementMetricValue(
  def: Pick<MetricDef, "key" | "compute">,
  statement: FinancialStatement,
): number | undefined {
  if (def.key) return statement[def.key] as number | undefined;
  return def.compute?.(statement);
}

export const FINANCIAL_PERIOD_TABS_WIDTH = "Annual".length + "Quarterly".length + 4;

export const FINANCIAL_COL_W = 18;
export const FINANCIAL_LABEL_W = 28;
const FINANCIAL_GROWTH_W = 7;
const FINANCIAL_VALUE_W = FINANCIAL_COL_W - FINANCIAL_GROWTH_W;

export function computeGrowth(current: number | undefined, previous: number | undefined): number | undefined {
  if (current == null || previous == null || previous === 0) return undefined;
  return (current - previous) / Math.abs(previous);
}

export function formatFinancialCell(value: string, growth: number | undefined) {
  const growthText = growth != null ? formatGrowthShort(growth) : "";
  return {
    valueText: padTo(value, FINANCIAL_VALUE_W, "right"),
    growthText: padTo(growthText ? ` ${growthText}` : "", FINANCIAL_GROWTH_W, "right"),
  };
}

export function formatFinancialValue(
  value: number | undefined,
  row: Pick<FinancialTableRow, "format" | "divisor">,
): string {
  if (value == null) return "—";
  if (row.format === "eps") return formatNumber(value, 2);
  if (row.format === "percent") return `${formatNumber(value * 100, 1)}%`;
  return formatWithDivisor(value, row.divisor);
}

export function formatFinancialHeader(date: string): string {
  return date === "TTM" ? "TTM" : date.slice(0, 7);
}

export function resolveFinancialPeriod(
  requestedPeriod: FinancialPeriod,
  hasAnnualStatements: boolean,
  hasQuarterlyStatements: boolean,
): FinancialPeriod {
  if (requestedPeriod === "annual") {
    return hasAnnualStatements || !hasQuarterlyStatements ? "annual" : "quarterly";
  }
  return hasQuarterlyStatements || !hasAnnualStatements ? "quarterly" : "annual";
}

function isFinancialGroup(row: FinancialRowDef): row is FinancialGroupDef {
  return "kind" in row && row.kind === "group";
}

export function collectGroupIds(rows: FinancialRowDef[]): string[] {
  return rows.flatMap((row) => {
    if (!isFinancialGroup(row)) return [];
    return [row.id, ...collectGroupIds(row.children)];
  });
}

export function collectDefaultCollapsedGroupIds(rows: FinancialRowDef[]): string[] {
  return rows.flatMap((row) => {
    if (!isFinancialGroup(row)) return [];
    return [
      ...(row.defaultExpanded === true ? [] : [row.id]),
      ...collectDefaultCollapsedGroupIds(row.children),
    ];
  });
}

function hasStatementValue(
  statements: FinancialStatement[],
  key: keyof FinancialStatement,
): boolean {
  return statements.some((statement) => typeof statement[key] === "number");
}

function hasFinancialRowValue(
  row: FinancialRowDef,
  statements: FinancialStatement[],
): boolean {
  if (!isFinancialGroup(row)) {
    return statements.some((statement) => typeof statementMetricValue(row, statement) === "number");
  }
  return (
    (row.summaryKey ? hasStatementValue(statements, row.summaryKey) : false)
    || row.children.some((child) => hasFinancialRowValue(child, statements))
  );
}

function resolveMetricUnit(
  statements: FinancialStatement[],
  def: Pick<MetricDef, "key" | "compute" | "format">,
  label: string,
) {
  const format = def.format ?? "compact";
  const isEps = format === "eps";
  const isPercent = format === "percent";
  const allValues = statements.map((statement) => statementMetricValue(def, statement));
  const { suffix, divisor } = isEps || isPercent ? { suffix: "", divisor: 1 } : pickUnit(allValues);
  return {
    unitLabel: suffix ? `${label} (${suffix})` : label,
    divisor,
    format,
  };
}

export function buildFinancialRows(
  defs: FinancialRowDef[],
  statements: FinancialStatement[],
  collapsedGroups: Set<string>,
  depth = 0,
): FinancialTableRow[] {
  const rows: FinancialTableRow[] = [];

  for (const def of defs) {
    if (!hasFinancialRowValue(def, statements)) continue;

    if (!isFinancialGroup(def)) {
      const { unitLabel, divisor, format } = resolveMetricUnit(statements, def, def.label);
      rows.push({
        kind: "metric",
        id: `${def.id ?? String(def.key)}:${depth}`,
        key: def.key,
        compute: def.compute,
        unitLabel,
        divisor,
        format,
        showGrowth: def.showGrowth ?? format !== "percent",
        depth,
      });
      continue;
    }

    const toggleable = def.children.some((child) => hasFinancialRowValue(child, statements));
    const expanded = toggleable && !collapsedGroups.has(def.id);
    const metricUnit = def.summaryKey
      ? resolveMetricUnit(statements, { key: def.summaryKey, format: def.format ?? "compact" }, def.label)
      : { unitLabel: def.label, divisor: 1, format: def.format ?? "compact" };

    rows.push({
      kind: "group",
      id: def.id,
      label: def.label,
      unitLabel: metricUnit.unitLabel,
      summaryKey: def.summaryKey,
      divisor: metricUnit.divisor,
      format: metricUnit.format,
      depth,
      expanded,
      toggleable,
    });

    if (expanded) {
      rows.push(...buildFinancialRows(def.children, statements, collapsedGroups, depth + 1));
    }
  }

  return rows;
}

export function resolveFinancialSubTabKey(value: string | undefined): string {
  const normalized = (value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!normalized) return FINANCIAL_SUB_TABS[0]!.key;
  if (normalized === "cf" || normalized === "cashflows") return "cashflow";
  if (normalized === "bs" || normalized === "balancesheet") return "balance";
  return FINANCIAL_SUB_TABS.find((tab) => (
    tab.key.toLowerCase() === normalized
    || tab.name.toLowerCase().replace(/[\s_-]+/g, "") === normalized
  ))?.key ?? FINANCIAL_SUB_TABS[0]!.key;
}

export function resolveFinancialPeriodOption(value: string | undefined): FinancialPeriod | undefined {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return undefined;
  if (["a", "ann", "annual", "year", "yearly", "fy"].includes(normalized)) return "annual";
  if (["q", "qtr", "quarter", "quarterly"].includes(normalized)) return "quarterly";
  return undefined;
}

interface FinancialTableCellModel {
  valueText: string;
  growthText: string;
  value: number | undefined;
  growth: number | undefined;
}

interface FinancialTableModelRow {
  kind: FinancialTableRow["kind"];
  id: string;
  key?: keyof FinancialStatement;
  summaryKey?: keyof FinancialStatement;
  unitLabel: string;
  depth: number;
  cells: FinancialTableCellModel[];
}

export interface FinancialTableModel {
  period: FinancialPeriod;
  subTab: FinancialSubTab;
  statements: FinancialStatement[];
  rows: FinancialTableModelRow[];
}

export function buildFinancialTableModel(
  financials: Pick<TickerFinancials, "annualStatements" | "quarterlyStatements"> | null | undefined,
  options: {
    period?: FinancialPeriod;
    statement?: string;
    annualLimit?: number;
    quarterlyLimit?: number;
    collapsedGroupIds?: Iterable<string>;
    expandAll?: boolean;
  } = {},
): FinancialTableModel | null {
  const annualStatements = financials?.annualStatements ?? [];
  const quarterlyStatements = financials?.quarterlyStatements ?? [];
  const hasAnnualStatements = annualStatements.length > 0;
  const hasQuarterlyStatements = quarterlyStatements.length > 0;
  if (!hasAnnualStatements && !hasQuarterlyStatements) return null;

  const requestedPeriod = options.period ?? (hasAnnualStatements ? "annual" : "quarterly");
  const period = resolveFinancialPeriod(requestedPeriod, hasAnnualStatements, hasQuarterlyStatements);
  const isAnnual = period === "annual";
  const rawStatements = isAnnual
    ? annualStatements.slice(-(options.annualLimit ?? 5)).reverse()
    : quarterlyStatements.slice(-(options.quarterlyLimit ?? 6)).reverse();
  const ttm = isAnnual ? computeTTM(quarterlyStatements) : null;
  const statements = ttm ? [ttm, ...rawStatements] : rawStatements;
  const previousStatementMap = buildPreviousStatementMap(period, annualStatements, quarterlyStatements, ttm);
  const subTabKey = resolveFinancialSubTabKey(options.statement);
  const subTab = FINANCIAL_SUB_TABS.find((tab) => tab.key === subTabKey) ?? FINANCIAL_SUB_TABS[0]!;
  const collapsedGroups = options.expandAll
    ? new Set<string>()
    : new Set(options.collapsedGroupIds ?? collectDefaultCollapsedGroupIds(subTab.rows));
  const rows = buildFinancialRows(subTab.rows, statements, collapsedGroups).map((row): FinancialTableModelRow => {
    const cells = statements.map((statement) => {
      const previous = previousStatementMap.get(statement.date);
      const value = row.kind === "group"
        ? row.summaryKey ? statement[row.summaryKey] as number | undefined : undefined
        : statementMetricValue(row, statement);
      const previousValue = previous
        ? row.kind === "group"
          ? row.summaryKey ? previous[row.summaryKey] as number | undefined : undefined
          : statementMetricValue(row, previous)
        : undefined;
      const growth = row.kind === "metric" && !row.showGrowth ? undefined : computeGrowth(value, previousValue);
      return {
        ...formatFinancialCell(formatFinancialValue(value, row), growth),
        value,
        growth,
      };
    });
    return {
      kind: row.kind,
      id: row.id,
      key: row.kind === "metric" ? row.key : undefined,
      summaryKey: row.kind === "group" ? row.summaryKey : undefined,
      unitLabel: row.unitLabel,
      depth: row.depth,
      cells,
    };
  });

  return { period, subTab, statements, rows };
}
