import { useCallback, useMemo, useState } from "react";
import { Box, Text, TextAttributes } from "../../../ui";
import {
  DataTableView,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
} from "../../../components";
import type { AnalystRatingRecord, AnalystResearchData } from "../../../types/financials";
import { blendHex, colors, priceColor } from "../../../theme/colors";
import { formatCurrency, formatNumber, formatPercent } from "../../../utils/format";
import { compareSortValues, type SortDirection } from "../../../utils/sort-values";
import { useAssetData } from "../../plugin-runtime";
import { useBoundTicker as useSymbolBinding, useTickerRequest } from "../shared/ticker-request";

function compactPeriod(period: string): string {
  return period
    .replace("current ", "")
    .replace("previous ", "prev ")
    .replace("next_", "next ")
    .replace(/_/g, " ");
}

function targetUpside(target: AnalystResearchData["priceTarget"]): number | undefined {
  if (!target?.average || !target.current) return undefined;
  return (target.average - target.current) / target.current;
}

function latestRecommendation(data: AnalystResearchData | null) {
  return data?.recommendations[0] ?? null;
}

function recommendationTotal(data: AnalystResearchData | null): number {
  const rec = latestRecommendation(data);
  if (!rec) return 0;
  return (rec.strongBuy ?? 0) + (rec.buy ?? 0) + (rec.hold ?? 0) + (rec.sell ?? 0) + (rec.strongSell ?? 0);
}

function formatRatingLabel(value: number | undefined): string {
  return value == null ? "-" : `${formatNumber(value, 1)}/10`;
}

function ratingActionColor(action: string | undefined): string {
  const normalized = action?.toLowerCase() ?? "";
  if (normalized.includes("upgrade")) return colors.positive;
  if (normalized.includes("downgrade")) return colors.negative;
  return colors.textDim;
}

function formatPriceTarget(value: number | undefined, currency: string): string {
  if (value == null) return "-";
  return formatCurrency(value, currency)
    .replace(/\.00\b/, "")
    .replace(/(\.\d)0\b/, "$1");
}

function formatRatingTarget(row: AnalystResearchData["ratings"][number], currency: string): string {
  const current = row.currentPriceTarget;
  const prior = row.priorPriceTarget;
  if (current == null && prior == null) return "-";
  if (current == null) return ` ${formatPriceTarget(prior, currency)}`;
  if (prior == null) return ` ${formatPriceTarget(current, currency)}`;
  return ` ${formatPriceTarget(prior, currency)} → ${formatPriceTarget(current, currency)}`;
}

function ratingTargetDelta(row: AnalystResearchData["ratings"][number]): number | null {
  if (row.currentPriceTarget == null || row.priorPriceTarget == null) return null;
  return row.currentPriceTarget - row.priorPriceTarget;
}

function ratingTargetBackground(delta: number | null): string | undefined {
  if (delta == null || delta === 0) return undefined;
  return blendHex(colors.bg, delta > 0 ? colors.positive : colors.negative, 0.42);
}

function AnalystSummary({ data, width }: { data: AnalystResearchData | null; width: number }) {
  const target = data?.priceTarget;
  const upside = targetUpside(target);
  const rec = latestRecommendation(data);
  const total = recommendationTotal(data);
  const currency = target?.currency ?? data?.currency ?? "USD";
  const summaryWidth = Math.max(1, width - 2);

  if (!data) {
    return (
      <Box flexDirection="column" paddingX={1} height={2}>
        <Text fg={colors.textDim}>Analyst data</Text>
        <Text fg={colors.textDim}>Waiting for asset data.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} height={4}>
      <Box height={1} flexDirection="row">
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
          {target?.average != null ? formatCurrency(target.average, currency) : "-"}
        </Text>
        <Text fg={colors.textDim}> avg target </Text>
        <Text fg={upside == null ? colors.textDim : priceColor(upside)}>
          {upside != null ? formatPercent(upside) : "-"}
        </Text>
        <Text fg={colors.textDim}> upside</Text>
        <Box flexGrow={1} />
        <Text fg={colors.textDim}>rating </Text>
        <Text fg={colors.text}>{formatRatingLabel(data?.recommendationRating)}</Text>
      </Box>
      <Box height={1} flexDirection="row">
        <Text fg={colors.textDim}>low </Text>
        <Text fg={colors.text}>{target?.low != null ? formatCurrency(target.low, currency) : "-"}</Text>
        <Text fg={colors.textDim}>  median </Text>
        <Text fg={colors.text}>{target?.median != null ? formatCurrency(target.median, currency) : "-"}</Text>
        <Text fg={colors.textDim}>  high </Text>
        <Text fg={colors.text}>{target?.high != null ? formatCurrency(target.high, currency) : "-"}</Text>
      </Box>
      <Box height={1} width={summaryWidth} flexDirection="row">
        <Text fg={colors.textDim}>{compactPeriod(rec?.period ?? "")}</Text>
        <Box flexGrow={1} />
        <Text fg={colors.positive}>SB {rec?.strongBuy ?? 0}</Text>
        <Text fg={colors.text}>  B {rec?.buy ?? 0}</Text>
        <Text fg={colors.textDim}>  H {rec?.hold ?? 0}</Text>
        <Text fg={colors.negative}>  S {(rec?.sell ?? 0) + (rec?.strongSell ?? 0)}</Text>
        <Text fg={colors.textDim}>  n={total}</Text>
      </Box>
      <Box height={1} flexDirection="row">
        <Text fg={colors.textDim}>
          {data?.ratings[0]
            ? `${data.ratings[0].firm} ${data.ratings[0].action ?? ""} ${data.ratings[0].current ?? ""}`.trim()
            : "No recent rating actions"}
        </Text>
      </Box>
    </Box>
  );
}

type RatingColumnId = "date" | "firm" | "action" | "current" | "target" | "prior";
type RatingColumn = DataTableColumn & { id: RatingColumnId };

export interface RatingSortPreference {
  columnId: RatingColumnId;
  direction: SortDirection;
}

const DEFAULT_RATING_SORT: RatingSortPreference = {
  columnId: "date",
  direction: "desc",
};

const DEFAULT_RATING_SORT_DIRECTIONS: Record<RatingColumnId, SortDirection> = {
  date: "desc",
  firm: "asc",
  action: "asc",
  current: "asc",
  target: "desc",
  prior: "asc",
};

const RATING_COLUMNS: RatingColumn[] = [
  { id: "date", label: "DATE", width: 10, align: "left" },
  { id: "firm", label: "FIRM", width: 20, align: "left" },
  { id: "action", label: "ACTION", width: 10, align: "left" },
  { id: "current", label: "RATING", width: 13, align: "left" },
  { id: "target", label: "TARGET", width: 13, align: "left" },
  { id: "prior", label: "PRIOR", width: 13, align: "left" },
];

function normalizedText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLocaleLowerCase() : null;
}

function ratingTargetSortValue(row: AnalystRatingRecord): number | null {
  return row.currentPriceTarget ?? row.priorPriceTarget ?? null;
}

function ratingSortValue(row: AnalystRatingRecord, columnId: RatingColumnId): string | number | null {
  switch (columnId) {
    case "date":
      return normalizedText(row.date);
    case "firm":
      return normalizedText(row.firm);
    case "action":
      return normalizedText(row.action);
    case "current":
      return normalizedText(row.current);
    case "target":
      return ratingTargetSortValue(row);
    case "prior":
      return normalizedText(row.prior);
  }
}

export function sortRatingRows<T extends AnalystRatingRecord>(
  rows: readonly T[],
  preference: RatingSortPreference,
): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const primary = compareSortValues(
        ratingSortValue(left.row, preference.columnId),
        ratingSortValue(right.row, preference.columnId),
        preference.direction,
      );
      if (primary !== 0) return primary;

      const dateTieBreak = preference.columnId === "date"
        ? 0
        : compareSortValues(
          ratingSortValue(left.row, "date"),
          ratingSortValue(right.row, "date"),
          "desc",
        );
      if (dateTieBreak !== 0) return dateTieBreak;

      return left.index - right.index;
    })
    .map((entry) => entry.row);
}

export function nextRatingSortPreference(
  current: RatingSortPreference,
  columnId: string,
): RatingSortPreference {
  const typedColumnId = columnId as RatingColumnId;
  if (current.columnId !== typedColumnId) {
    return {
      columnId: typedColumnId,
      direction: DEFAULT_RATING_SORT_DIRECTIONS[typedColumnId] ?? "asc",
    };
  }
  return {
    columnId: typedColumnId,
    direction: current.direction === "asc" ? "desc" : "asc",
  };
}

export function AnalystResearchView({ focused, width, height }: { focused: boolean; width: number; height: number }) {
  const dataProvider = useAssetData();
  const { symbol, exchange } = useSymbolBinding();
  const [sortPreference, setSortPreference] = useState<RatingSortPreference>(DEFAULT_RATING_SORT);
  const loader = useCallback((nextSymbol: string, nextExchange: string, forceRefresh: boolean) => {
    if (!dataProvider?.getAnalystResearch) throw new Error("Analyst data unavailable");
    return dataProvider.getAnalystResearch(nextSymbol, nextExchange, forceRefresh ? { cacheMode: "refresh" } : undefined);
  }, [dataProvider]);
  const { data, loading, error, reload } = useTickerRequest<AnalystResearchData>(loader, symbol, exchange);
  const rows = useMemo(() => sortRatingRows(data?.ratings ?? [], sortPreference), [data?.ratings, sortPreference]);
  const ratingCurrency = data?.priceTarget?.currency ?? data?.currency ?? "USD";

  const renderCell = useCallback((
    row: AnalystResearchData["ratings"][number],
    column: RatingColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "date":
        return { text: row.date, color: selectedColor ?? colors.textDim };
      case "firm":
        return { text: row.firm, color: selectedColor ?? colors.textBright, attributes: TextAttributes.BOLD };
      case "action":
        return { text: row.action ?? "-", color: selectedColor ?? ratingActionColor(row.action) };
      case "current":
        return { text: row.current ?? "-", color: selectedColor ?? colors.text };
      case "target": {
        const delta = ratingTargetDelta(row);
        const hasTarget = row.currentPriceTarget != null || row.priorPriceTarget != null;
        return {
          text: formatRatingTarget(row, ratingCurrency),
          color: selectedColor ?? (hasTarget ? colors.textBright : colors.textDim),
          backgroundColor: rowState.selected ? undefined : ratingTargetBackground(delta),
          attributes: hasTarget ? TextAttributes.BOLD : undefined,
        };
      }
      case "prior":
        return { text: row.prior ?? "-", color: selectedColor ?? colors.textDim };
    }
  }, [ratingCurrency]);

  const handleKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name !== "r") return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    reload();
    return true;
  }, [reload]);
  const handleHeaderClick = useCallback((columnId: string) => {
    setSortPreference((current) => nextRatingSortPreference(current, columnId));
  }, []);

  usePaneFooter("analyst-research", () => ({
    info: [
      ...(loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : []),
    ],
    hints: [{ id: "refresh", key: "r", label: "efresh", onPress: reload }],
  }), [error, loading, reload]);

  return (
    <DataTableView<AnalystResearchData["ratings"][number], RatingColumn>
      focused={focused}
      rootWidth={width}
      rootHeight={height}
      rootBefore={<AnalystSummary data={data} width={width} />}
      onRootKeyDown={handleKeyDown}
      columns={RATING_COLUMNS}
      items={rows}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={handleHeaderClick}
      getItemKey={(row, index) => `${row.date}:${row.firm}:${index}`}
      isSelected={() => false}
      onSelect={() => {}}
      renderCell={renderCell}
      emptyStateTitle={loading ? "Loading analyst data..." : error ?? "No analyst data"}
    />
  );
}
