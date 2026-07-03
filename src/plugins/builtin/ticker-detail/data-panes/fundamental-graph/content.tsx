import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, TextAttributes } from "../../../../../ui";
import {
  DataTableView,
  Tabs,
  usePaneFooter,
  type DataTableCell,
  type DataTableKeyEvent,
} from "../../../../../components";
import { useShortcut } from "../../../../../react/input";
import type { BarChartHover } from "../../../../../components/chart/bar-chart-renderer";
import type { MouseInteractionEvent } from "../../../../../components/chart/core/pointer";
import { StaticBarChartSurface } from "../../../../../components/chart/static/bar-chart-surface";
import { useAppDispatch, usePaneInstanceId } from "../../../../../state/app/context";
import { colors, priceColor } from "../../../../../theme/colors";
import { usePluginPaneState } from "../../../../runtime";
import { loadingErrorFooterInfo, refreshFooterHint, useClampSelectedIndex } from "../../../shared/table-pane";
import {
  allMetricDefs,
  buildFundamentalColumns,
  buildGraphBarSeries,
  formatMaybePercent,
  metricDef,
  metricKind,
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
  onCapture,
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
  onCapture?: (capturing: boolean) => void;
}) {
  const dispatch = useAppDispatch();
  const paneId = usePaneInstanceId();
  const [selectedIdx, setSelectedIdx] = usePluginPaneState<number>("selectedIdx", 0);
  const [hiddenSeriesIds, setHiddenSeriesIds] = usePluginPaneState<string[]>("hiddenSeriesIds", []);
  const [hoveredBar, setHoveredBar] = useState<BarChartHover | null>(null);
  const [metricTabsFocused, setMetricTabsFocused] = useState(false);
  const definition = metricDef(chartKind, metric);
  const metricOptions = useMemo(() => allMetricDefs(), []);
  const metricTabs = useMemo(() => metricOptions.map(({ definition }) => ({
    label: definition.label,
    value: definition.key,
  })), [metricOptions]);
  const chartSeries = useMemo(() => buildGraphBarSeries(rows), [rows]);
  const chartSeriesIds = useMemo(() => new Set(chartSeries.map((series) => series.id)), [chartSeries]);
  const hiddenSeriesIdSet = useMemo(() => new Set(hiddenSeriesIds), [hiddenSeriesIds]);
  const visibleRows = useMemo(() => rows.filter((row) => {
    const seriesId = row.symbol || "value";
    return !hiddenSeriesIdSet.has(seriesId);
  }), [hiddenSeriesIdSet, rows]);
  const multiSymbol = new Set(visibleRows.map((row) => row.symbol)).size > 1;
  const columns = useMemo(() => buildFundamentalColumns(width, multiSymbol), [multiSymbol, width]);
  const tableRows = useMemo(() => [...visibleRows].sort((left, right) => (
    right.date.localeCompare(left.date) || left.symbol.localeCompare(right.symbol)
  )), [visibleRows]);
  const boundedSelectedIdx = tableRows.length > 0 ? Math.min(selectedIdx, tableRows.length - 1) : -1;
  const minTableHeight = tableRows.length > 0 ? 4 : 3;
  const desiredChartHeight = height >= 14 ? Math.min(16, Math.max(9, Math.floor(height * 0.58))) : Math.max(4, Math.floor(height / 2));
  const chartHeight = Math.max(1, Math.min(desiredChartHeight, Math.max(1, height - minTableHeight)));
  const tableHeight = Math.max(0, height - chartHeight);
  const selectMetric = useCallback((value: string) => {
    const nextMetric = value as GraphMetricKey;
    const nextKind = metricKind(nextMetric);
    if (!nextKind) return;
    setHoveredBar(null);
    setChartKind(() => nextKind);
    setMetric(() => nextMetric);
  }, [setChartKind, setMetric]);
  const focusPaneForMouseInteraction = useCallback((event: MouseInteractionEvent | null | undefined) => {
    event?.stopPropagation?.();
    event?.preventDefault?.();
    if (!focused) {
      dispatch({ type: "FOCUS_PANE", paneId });
    }
  }, [dispatch, focused, paneId]);
  const focusMetricTabs = useCallback((event?: MouseInteractionEvent | null) => {
    focusPaneForMouseInteraction(event);
    if (metricTabsFocused) return;
    setMetricTabsFocused(true);
    onCapture?.(true);
  }, [focusPaneForMouseInteraction, metricTabsFocused, onCapture]);
  const releaseMetricTabs = useCallback(() => {
    if (!metricTabsFocused) return;
    setMetricTabsFocused(false);
    onCapture?.(false);
  }, [metricTabsFocused, onCapture]);
  const selectMetricFromTabs = useCallback((value: string) => {
    focusMetricTabs();
    selectMetric(value);
  }, [focusMetricTabs, selectMetric]);
  const togglePeriod = useCallback(() => setPeriod((current) => current === "annual" ? "quarterly" : "annual"), [setPeriod]);
  const toggleSeries = useCallback((seriesId: string) => {
    setHiddenSeriesIds((current) => {
      const hidden = new Set(current);
      if (hidden.has(seriesId)) hidden.delete(seriesId);
      else hidden.add(seriesId);
      return [...hidden].filter((id) => chartSeriesIds.has(id));
    });
  }, [chartSeriesIds, setHiddenSeriesIds]);
  const hoveredValue = useMemo(() => {
    if (!hoveredBar) return null;
    const label = chartSeries.length > 1 ? `${hoveredBar.category} ${hoveredBar.seriesLabel}` : hoveredBar.category;
    return `${label} ${definition.format(hoveredBar.value)}`;
  }, [chartSeries.length, definition, hoveredBar]);

  useClampSelectedIndex(tableRows.length, selectedIdx, setSelectedIdx);

  useEffect(() => {
    setHiddenSeriesIds((current) => {
      const next = current.filter((id) => chartSeriesIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [chartSeriesIds, setHiddenSeriesIds]);

  useEffect(() => {
    if (!focused && metricTabsFocused) {
      setMetricTabsFocused(false);
      onCapture?.(false);
    }
  }, [focused, metricTabsFocused, onCapture]);

  useEffect(() => () => {
    onCapture?.(false);
  }, [onCapture]);

  useShortcut((event) => {
    if (event.defaultPrevented || event.propagationStopped || event.targetEditable) return;
    if (event.ctrl || event.meta || event.alt || event.shift) return;

    const isEnter = event.name === "enter" || event.name === "return";
    const isEscape = event.name === "escape" || event.name === "esc";
    if (isEnter) {
      event.preventDefault();
      event.stopPropagation();
      focusMetricTabs();
      return;
    }
    if (isEscape && metricTabsFocused) {
      event.preventDefault();
      event.stopPropagation();
      releaseMetricTabs();
    }
  }, { enabled: focused, phase: "before" });

  const handleKeyDown = useCallback((event: DataTableKeyEvent) => {
    const isEnter = event.name === "enter" || event.name === "return";
    if (isEnter) {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusMetricTabs();
      return true;
    }
    if ((event.name === "escape" || event.name === "esc") && metricTabsFocused) {
      event.preventDefault?.();
      event.stopPropagation?.();
      releaseMetricTabs();
      return true;
    }
    if (event.name === "r") {
      event.preventDefault?.();
      reload();
      return true;
    }
    if (event.name === "p") {
      event.preventDefault?.();
      togglePeriod();
      return true;
    }
    return false;
  }, [focusMetricTabs, metricTabsFocused, releaseMetricTabs, reload, togglePeriod]);

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
        return {
          text: definition.format(row.value),
          color: row.value < 0 ? colors.negative : selectedColor ?? colors.textBright,
          attributes: TextAttributes.BOLD,
        };
      case "growth":
        return { text: formatMaybePercent(row.growth), color: selectedColor ?? priceColor(row.growth ?? 0) };
    }
  }, [definition]);

  usePaneFooter("fundamental-graph", () => ({
    info: [
      { id: "period", parts: [{ text: "period", tone: "label" as const }, { text: period, tone: "value" as const }] },
      ...(hoveredValue ? [{ id: "hover", parts: [{ text: hoveredValue, tone: "value" as const }] }] : []),
      ...loadingErrorFooterInfo(loading, error),
    ],
    hints: [
      { id: "period", key: "p", label: "eriod", onPress: togglePeriod },
      refreshFooterHint(reload),
    ],
  }), [error, hoveredValue, loading, period, reload, togglePeriod]);

  const metricHeader = (
    <Tabs
      tabs={metricTabs}
      activeValue={metric}
      onSelect={selectMetricFromTabs}
      compact
      focused={focused && metricTabsFocused}
      keyboardNavigation={metricTabsFocused}
      scrollable
      variant="underline"
    />
  );

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      overflow="hidden"
      onMouseDown={focusMetricTabs}
    >
      <StaticBarChartSurface
        width={width}
        height={chartHeight}
        series={chartSeries}
        hiddenSeriesIds={hiddenSeriesIds}
        onToggleSeries={toggleSeries}
        header={metricHeader}
        formatValue={definition.format}
        onHoverChange={setHoveredBar}
        onMouseDown={focusPaneForMouseInteraction}
      />
      {tableHeight > 0 ? (
        <DataTableView<FundamentalGraphRow, FundamentalColumn>
          focused={focused}
          selection={{
            kind: "index",
            selectedIndex: boundedSelectedIdx,
            onChange: (index) => setSelectedIdx(index),
          }}
          onRootKeyDown={handleKeyDown}
          rootWidth={width}
          rootHeight={tableHeight}
          columns={columns}
          items={tableRows}
          sortColumnId="date"
          sortDirection="desc"
          onHeaderClick={() => {}}
          onTableMouseDown={focusMetricTabs}
          getItemKey={(row) => row.key}
          renderCell={renderCell}
          emptyStateTitle={loading ? "Loading fundamentals..." : "No graph data"}
        />
      ) : null}
    </Box>
  );
}
