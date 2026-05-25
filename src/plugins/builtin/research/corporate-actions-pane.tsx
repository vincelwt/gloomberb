import { useCallback, useMemo } from "react";
import { TextAttributes } from "../../../ui";
import {
  DataTableView,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
} from "../../../components";
import type {
  AnalystEstimateRecord,
  AnalystResearchData,
  CorporateActionsData,
  FinancialStatement,
  TickerFinancials,
} from "../../../types/financials";
import { blendHex, colors } from "../../../theme/colors";
import { formatCompact, formatCurrency, formatNumber, formatPercent, formatPercentRaw } from "../../../utils/format";
import { useAssetData } from "../../runtime";
import { handleRefreshKey, loadingErrorFooterInfo, refreshFooterHint } from "../shared/table-pane";
import { useBoundTicker as useSymbolBinding, useTickerRequest } from "../shared/ticker-request";

type EventStatus = "Earnings" | "Q Est" | "FY Est" | "TTM" | "Dividend" | "Split";

type EventRow = {
  id: string;
  date: string;
  status: EventStatus;
  period: string;
  detail: string;
  qEps?: number;
  qRevenue?: number;
  annualEps?: number;
  annualRevenue?: number;
  value: string;
  tone: "positive" | "negative" | "muted" | "text";
};

type EventColumnId = "date" | "status" | "period" | "qEps" | "qRevenue" | "annualEps" | "annualRevenue" | "value" | "detail";
type EventColumn = DataTableColumn & { id: EventColumnId };

type EstimatePair = {
  date: string;
  period: string;
  eps?: AnalystEstimateRecord;
  revenue?: AnalystEstimateRecord;
};

function todayDateKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatPeriod(period: string): string {
  const label = period.replace(/_/g, " ");
  return label
    .replace(/\bcurrent\b/g, "cur")
    .replace(/\bquarter\b/g, "qtr")
    .replace(/\byear\b/g, "yr")
    || "-";
}

function isFiscalEstimatePeriod(period: string): boolean {
  return /\byear\b|^current_year$|^next_year$|^next_5y$/i.test(period);
}

function sortedQuarterlyStatements(financials: Pick<TickerFinancials, "quarterlyStatements"> | null): FinancialStatement[] {
  return [...(financials?.quarterlyStatements ?? [])]
    .filter((statement) => statement.date)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function quarterLabel(statement: FinancialStatement | undefined): string {
  return statement?.date ? `Q${statement.date.slice(2)}` : "-";
}

function daysBetween(leftDate: string, rightDate: string): number {
  const left = new Date(`${leftDate}T00:00:00Z`).getTime();
  const right = new Date(`${rightDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Number.POSITIVE_INFINITY;
  return Math.abs(left - right) / 86_400_000;
}

function statementForEarningsDate(
  quarterlyStatements: readonly FinancialStatement[],
  earningsDate: string,
): FinancialStatement | undefined {
  let best: FinancialStatement | undefined;
  for (const statement of quarterlyStatements) {
    if (statement.date > earningsDate) continue;
    if (!best || statement.date > best.date) best = statement;
  }
  return best && daysBetween(best.date, earningsDate) <= 140 ? best : undefined;
}

function estimateKey(estimate: AnalystEstimateRecord): string {
  return `${estimate.date}|${estimate.period}`;
}

function hasEstimateValue(estimate: AnalystEstimateRecord | undefined): boolean {
  return estimate?.average != null
    || estimate?.low != null
    || estimate?.high != null
    || estimate?.yearAgo != null
    || estimate?.growth != null
    || estimate?.analysts != null;
}

function buildEstimatePairs(data: AnalystResearchData | null): EstimatePair[] {
  const pairs = new Map<string, EstimatePair>();
  const ensurePair = (estimate: AnalystEstimateRecord): EstimatePair => {
    const key = estimateKey(estimate);
    const existing = pairs.get(key);
    if (existing) return existing;
    const pair: EstimatePair = { date: estimate.date, period: estimate.period };
    pairs.set(key, pair);
    return pair;
  };

  for (const estimate of data?.earningsEstimates ?? []) {
    if (hasEstimateValue(estimate)) ensurePair(estimate).eps = estimate;
  }
  for (const estimate of data?.revenueEstimates ?? []) {
    if (hasEstimateValue(estimate)) ensurePair(estimate).revenue = estimate;
  }

  return [...pairs.values()];
}

function formatEstimateDetail(pair: EstimatePair): string {
  const analystCounts: string[] = [];
  if (pair.eps?.analysts != null) analystCounts.push(`${pair.eps.analysts}E`);
  if (pair.revenue?.analysts != null) analystCounts.push(`${pair.revenue.analysts}R`);
  if (analystCounts.length) return analystCounts.join("/");
  return "Consensus";
}

function estimateTone(pair: EstimatePair): EventRow["tone"] {
  const growth = pair.eps?.growth ?? pair.revenue?.growth;
  if (growth == null) return "muted";
  return growth >= 0 ? "positive" : "negative";
}

function estimateValue(pair: EstimatePair): string {
  const growth = pair.eps?.growth ?? pair.revenue?.growth;
  return growth == null ? "-" : formatPercent(growth);
}

function ttmRow(quarterlyStatements: readonly FinancialStatement[]): EventRow | null {
  const latestFour = quarterlyStatements.slice(-4);
  if (latestFour.length < 4) return null;
  const fiscalRevenue = latestFour.reduce<number | undefined>((total, statement) => {
    if (statement.totalRevenue == null) return total;
    return (total ?? 0) + statement.totalRevenue;
  }, undefined);
  const fiscalEps = latestFour.reduce<number | undefined>((total, statement) => {
    if (statement.eps == null) return total;
    return (total ?? 0) + statement.eps;
  }, undefined);
  if (fiscalRevenue == null && fiscalEps == null) return null;
  const latest = latestFour.at(-1);
  return {
    id: `ttm:${latest?.date ?? ""}`,
    date: latest?.date ?? "",
    status: "TTM",
    period: "4 qtrs",
    detail: "sum",
    annualEps: fiscalEps,
    annualRevenue: fiscalRevenue,
    value: "-",
    tone: "muted",
  };
}

function earningsDetail(earning: CorporateActionsData["earnings"][number]): string {
  if (earning.epsActual == null) return "Pending";
  if (earning.difference == null) return "Reported";
  return `diff ${formatNumber(earning.difference, 2)}`;
}

function eventSortRank(status: EventStatus): number {
  switch (status) {
    case "Q Est":
      return 0;
    case "FY Est":
      return 1;
    case "Earnings":
      return 2;
    case "TTM":
      return 3;
    case "Dividend":
      return 4;
    case "Split":
      return 5;
  }
}

export function buildEventRows(
  data: CorporateActionsData | null,
  estimates: AnalystResearchData | null,
  financials: Pick<TickerFinancials, "quarterlyStatements"> | null,
  currency: string,
): EventRow[] {
  const rows: EventRow[] = [];
  const quarterlyStatements = sortedQuarterlyStatements(financials);
  const ttm = ttmRow(quarterlyStatements);
  if (ttm) rows.push(ttm);

  for (const earning of data?.earnings ?? []) {
    const statement = statementForEarningsDate(quarterlyStatements, earning.date);
    rows.push({
      id: `earn:${earning.date}`,
      date: earning.date,
      status: "Earnings",
      period: statement ? quarterLabel(statement) : earning.time?.trim() || "-",
      detail: earningsDetail(earning),
      qEps: earning.epsActual ?? statement?.eps ?? earning.epsEstimate,
      qRevenue: statement?.totalRevenue,
      value: earning.surprisePercent != null ? formatPercentRaw(earning.surprisePercent) : "-",
      tone: earning.surprisePercent == null ? "muted" : earning.surprisePercent >= 0 ? "positive" : "negative",
    });
  }

  for (const pair of buildEstimatePairs(estimates)) {
    const isFiscal = isFiscalEstimatePeriod(pair.period);
    rows.push({
      id: `estimate:${pair.date}:${pair.period}`,
      date: pair.date,
      status: isFiscal ? "FY Est" : "Q Est",
      period: formatPeriod(pair.period),
      detail: formatEstimateDetail(pair),
      qEps: isFiscal ? undefined : pair.eps?.average,
      qRevenue: isFiscal ? undefined : pair.revenue?.average,
      annualEps: isFiscal ? pair.eps?.average : undefined,
      annualRevenue: isFiscal ? pair.revenue?.average : undefined,
      value: estimateValue(pair),
      tone: estimateTone(pair),
    });
  }

  for (const dividend of data?.dividends ?? []) {
    rows.push({
      id: `div:${dividend.exDate}`,
      date: dividend.exDate,
      status: "Dividend",
      period: "-",
      detail: "Ex-date",
      value: formatCurrency(dividend.amount, currency),
      tone: "positive",
    });
  }

  for (const split of data?.splits ?? []) {
    rows.push({
      id: `split:${split.date}:${split.description ?? ""}`,
      date: split.date,
      status: "Split",
      period: "-",
      detail: split.description ?? "Split",
      value: split.fromFactor && split.toFactor ? `${split.fromFactor}:${split.toFactor}` : formatNumber(split.ratio, 4),
      tone: "muted",
    });
  }

  return rows.sort((left, right) => (
    right.date.localeCompare(left.date)
    || eventSortRank(left.status) - eventSortRank(right.status)
    || left.period.localeCompare(right.period)
  ));
}

function buildEventColumns(): EventColumn[] {
  return [
    { id: "date", label: "DATE", width: 10, align: "left" },
    { id: "status", label: "EVENT", width: 8, align: "left" },
    { id: "period", label: "PERIOD", width: 9, align: "left" },
    { id: "qEps", label: "Q EPS", width: 6, align: "right" },
    { id: "qRevenue", label: "Q REV", width: 7, align: "right" },
    { id: "annualEps", label: "ANN EPS", width: 7, align: "right" },
    { id: "annualRevenue", label: "ANN REV", width: 7, align: "right" },
    { id: "value", label: "VALUE", width: 8, align: "right" },
    { id: "detail", label: "DETAIL", width: 9, align: "left", flexGrow: 1 },
  ];
}

function toneColor(tone: EventRow["tone"]): string {
  if (tone === "positive") return colors.positive;
  if (tone === "negative") return colors.negative;
  if (tone === "muted") return colors.textDim;
  return colors.text;
}

export function CorporateActionsView({
  focused,
  width,
  height,
  footerPaneId = "corporate-actions",
}: {
  focused: boolean;
  width: number;
  height: number;
  footerPaneId?: string;
}) {
  const dataProvider = useAssetData();
  const { symbol, exchange, currency } = useSymbolBinding();
  const actionsLoader = useCallback((nextSymbol: string, nextExchange: string, forceRefresh: boolean) => {
    if (!dataProvider?.getCorporateActions) throw new Error("Corporate actions source unavailable");
    return dataProvider.getCorporateActions(nextSymbol, nextExchange, forceRefresh ? { cacheMode: "refresh" } : undefined);
  }, [dataProvider]);
  const analystLoader = useCallback(async (nextSymbol: string, nextExchange: string, forceRefresh: boolean) => {
    if (!dataProvider?.getAnalystResearch) return null;
    return dataProvider.getAnalystResearch(nextSymbol, nextExchange, forceRefresh ? { cacheMode: "refresh" } : undefined);
  }, [dataProvider]);
  const financialsLoader = useCallback(async (nextSymbol: string, nextExchange: string, forceRefresh: boolean) => {
    if (!dataProvider) return null;
    return dataProvider.getTickerFinancials(nextSymbol, nextExchange, forceRefresh ? { cacheMode: "refresh" } : undefined);
  }, [dataProvider]);
  const {
    data: actionsData,
    loading: actionsLoading,
    error: actionsError,
    reload: reloadActions,
  } = useTickerRequest<CorporateActionsData>(actionsLoader, symbol, exchange);
  const {
    data: analystData,
    loading: analystLoading,
    error: analystError,
    reload: reloadAnalyst,
  } = useTickerRequest<AnalystResearchData | null>(analystLoader, symbol, exchange);
  const {
    data: financialsData,
    loading: financialsLoading,
    error: financialsError,
    reload: reloadFinancials,
  } = useTickerRequest<TickerFinancials | null>(financialsLoader, symbol, exchange);
  const displayCurrency = actionsData?.currency ?? analystData?.currency ?? currency;
  const rows = useMemo(() => (
    buildEventRows(actionsData, analystData, financialsData, displayCurrency)
  ), [actionsData, analystData, displayCurrency, financialsData]);
  const columns = useMemo(() => buildEventColumns(), []);
  const todayKey = todayDateKey();
  const futureRowBackground = blendHex(colors.bg, colors.positive, 0.16);
  const loading = actionsLoading || analystLoading || financialsLoading;
  const error = [actionsError, analystError, financialsError].filter(Boolean).join(" | ") || null;
  const reload = useCallback(() => {
    reloadActions();
    reloadAnalyst();
    reloadFinancials();
  }, [reloadActions, reloadAnalyst, reloadFinancials]);

  const renderCell = useCallback((
    row: EventRow,
    column: EventColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "date":
        return { text: row.date, color: selectedColor ?? colors.textDim };
      case "status":
        return { text: row.status, color: selectedColor ?? colors.textBright, attributes: TextAttributes.BOLD };
      case "period":
        return { text: row.period, color: selectedColor ?? colors.textDim };
      case "qEps":
        return { text: formatNumber(row.qEps, 2), color: selectedColor ?? colors.textDim };
      case "qRevenue":
        return { text: formatCompact(row.qRevenue), color: selectedColor ?? colors.textDim };
      case "annualEps":
        return { text: formatNumber(row.annualEps, 2), color: selectedColor ?? colors.textDim };
      case "annualRevenue":
        return { text: formatCompact(row.annualRevenue), color: selectedColor ?? colors.textDim };
      case "value":
        return { text: row.value, color: selectedColor ?? toneColor(row.tone) };
      case "detail":
        return { text: row.detail, color: selectedColor ?? colors.text };
    }
  }, []);

  const handleKeyDown = useCallback((event: DataTableKeyEvent) => {
    return handleRefreshKey(event, reload, { stopPropagation: true });
  }, [reload]);

  usePaneFooter(footerPaneId, () => ({
    info: loadingErrorFooterInfo(loading, error),
    hints: [refreshFooterHint(reload)],
  }), [error, footerPaneId, loading, reload]);

  return (
    <DataTableView<EventRow, EventColumn>
      focused={focused}
      rootWidth={width}
      rootHeight={height}
      onRootKeyDown={handleKeyDown}
      columns={columns}
      items={rows}
      sortColumnId={null}
      sortDirection="desc"
      onHeaderClick={() => {}}
      getItemKey={(row) => row.id}
      isSelected={() => false}
      onSelect={() => {}}
      renderCell={renderCell}
      getRowBackgroundColor={(row) => (
        row.date > todayKey ? futureRowBackground : undefined
      )}
      emptyStateTitle={loading ? "Loading events..." : error ?? "No events"}
    />
  );
}
