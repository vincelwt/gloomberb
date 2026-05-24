import { useCallback, useMemo } from "react";
import { Box, TextAttributes } from "../../../../../ui";
import {
  DataTableView,
  usePaneFooter,
  type DataTableCell,
  type DataTableKeyEvent,
} from "../../../../../components";
import { StaticBarChartSurface } from "../../../../../components/chart/static/bar-chart-surface";
import { colors, priceColor } from "../../../../../theme/colors";
import { usePluginPaneState } from "../../../../runtime";
import { loadingErrorFooterInfo, refreshFooterHint, useClampSelectedIndex } from "../../../shared/table-pane";
import {
  buildFundamentalColumns,
  buildGraphBarSeries,
  defaultMetric,
  formatMaybePercent,
  isMetricForKind,
  metricDef,
  nextMetric,
} from "./model";
import type {
  FundamentalColumn,
  FundamentalGraphRow,
  FundamentalPeriod,
  GraphKind,
  GraphMetricKey,
} from "./types";

export function FundamentalGraphContent({
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

  useClampSelectedIndex(rows.length, selectedIdx, setSelectedIdx);

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
      ...loadingErrorFooterInfo(loading, error),
    ],
    hints: [
      { id: "metric", key: "m", label: "etric", onPress: cycleMetric },
      { id: "kind", key: "g", label: "raph", onPress: toggleGraphKind },
      { id: "period", key: "p", label: "eriod", onPress: togglePeriod },
      refreshFooterHint(reload),
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
