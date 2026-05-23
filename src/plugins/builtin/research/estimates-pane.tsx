import { useCallback, useEffect, useMemo } from "react";
import { TextAttributes } from "../../../ui";
import {
  DataTableView,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
} from "../../../components";
import type { AnalystEstimateRecord, AnalystResearchData } from "../../../types/financials";
import type { PaneProps } from "../../../types/plugin";
import { colors, priceColor } from "../../../theme/colors";
import { formatCompact, formatNumber, formatPercent } from "../../../utils/format";
import { useAssetData, usePluginPaneState } from "../../plugin-runtime";
import { useBoundTicker, useTickerRequest } from "../shared/ticker-request";

type EstimateColumnId = "type" | "date" | "period" | "analysts" | "average" | "low" | "high" | "yearAgo" | "growth";
type EstimateColumn = DataTableColumn & { id: EstimateColumnId };

export type EstimateRow = {
  key: string;
  type: "EPS" | "Revenue";
  estimate: AnalystEstimateRecord;
};

function formatMaybePercent(value: number | null): string {
  return value == null ? "-" : formatPercent(value);
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

export function EarningsEstimatesPane({ focused, width, height }: PaneProps) {
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
