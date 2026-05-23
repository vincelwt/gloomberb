import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, TextAttributes, useUiCapabilities } from "../../../ui";
import {
  DataTableView,
  Tabs,
  usePaneFooter,
  usePaneTicker,
  type DataTableCell,
  type DataTableKeyEvent,
} from "../../../components";
import { useShortcut } from "../../../react/input";
import { colors, priceColor } from "../../../theme/colors";
import type { HolderData } from "../../../types/financials";
import { formatCompact } from "../../../utils/format";
import { isPlainKey } from "../../../utils/keyboard";
import { useAssetData, usePluginPaneState } from "../../plugin-runtime";
import {
  displayDate,
  formatHolderOwnershipPercent,
  formatMaybePercent,
  formatMoneyCompact,
  formatSignedCompact,
  resolveHolderOwnershipPercent,
} from "./format";
import {
  buildColumns,
  buildRows,
  DEFAULT_SORT,
  nextSortPreference,
  sortRows,
  VIEW_TABS,
} from "./table-model";
import { HoldersTreemap } from "./treemap";
import type { HolderColumn, HolderRow, SortPreference, ViewMode } from "./types";

export function HoldersView({ focused, width, height }: { focused: boolean; width: number; height: number }) {
  const { nativePaneChrome } = useUiCapabilities();
  const { symbol, ticker, financials } = usePaneTicker();
  const dataProvider = useAssetData();
  const [viewMode, setViewMode] = usePluginPaneState<ViewMode>("viewMode", "chart");
  const [sortPreference, setSortPreference] = usePluginPaneState<SortPreference>("sortPreference", DEFAULT_SORT);
  const [data, setData] = useState<HolderData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fetchGenRef = useRef(0);

  const currency = data?.currency ?? ticker?.metadata.currency ?? "USD";
  const quoteMarketCap = financials?.quote?.marketCap;
  const marketCap = financials?.quote?.currency && financials.quote.currency !== currency ? undefined : quoteMarketCap;
  const exchange = ticker?.metadata.exchange ?? "";
  const rows = useMemo(() => buildRows(data), [data]);
  const sortedRows = useMemo(() => sortRows(rows, sortPreference, marketCap), [marketCap, rows, sortPreference]);
  const columns = useMemo(() => buildColumns(width), [width]);
  const selectedIdx = selectedId
    ? sortedRows.findIndex((row) => row.id === selectedId)
    : -1;
  const activeIdx = selectedIdx >= 0 ? selectedIdx : (sortedRows.length > 0 ? 0 : -1);

  const loadHolders = useCallback(async (forceRefresh = false) => {
    if (!symbol || !dataProvider?.getHolders) {
      setData(null);
      setLoading(false);
      setError(dataProvider?.getHolders ? null : "Holder data unavailable");
      return;
    }

    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setLoading(true);
    setError(null);

    try {
      const nextData = await dataProvider.getHolders(symbol, exchange, forceRefresh ? { cacheMode: "refresh" } : undefined);
      if (fetchGenRef.current !== gen) return;
      setData(nextData);
      setSelectedId(null);
    } catch (err) {
      if (fetchGenRef.current !== gen) return;
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
    } finally {
      if (fetchGenRef.current === gen) setLoading(false);
    }
  }, [dataProvider, exchange, symbol]);

  useEffect(() => {
    void loadHolders(false);
  }, [loadHolders]);

  useEffect(() => {
    if (selectedId && sortedRows.some((row) => row.id === selectedId)) return;
    setSelectedId(sortedRows[0]?.id ?? null);
  }, [selectedId, sortedRows]);

  const selectIndex = useCallback((index: number) => {
    const row = sortedRows[index];
    if (row) setSelectedId(row.id);
  }, [sortedRows]);

  const handleHeaderClick = useCallback((columnId: string) => {
    setSortPreference((current) => nextSortPreference(current, columnId));
  }, [setSortPreference]);

  const toggleView = useCallback(() => {
    setViewMode((current) => current === "table" ? "chart" : "table");
  }, [setViewMode]);

  const refresh = useCallback(() => {
    void loadHolders(true);
  }, [loadHolders]);

  const handleKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name === "r") {
      event.preventDefault?.();
      event.stopPropagation?.();
      refresh();
      return true;
    }
    if (event.name === "s") {
      event.preventDefault?.();
      event.stopPropagation?.();
      toggleView();
      return true;
    }
    return false;
  }, [refresh, toggleView]);

  useShortcut((event) => {
    if (!focused || viewMode !== "chart") return;
    if (isPlainKey(event, "j", "down")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      const nextIdx = Math.min((selectedIdx >= 0 ? selectedIdx : 0) + 1, sortedRows.length - 1);
      const nextRow = sortedRows[nextIdx];
      if (nextRow) setSelectedId(nextRow.id);
      return;
    }
    if (isPlainKey(event, "k", "up")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      const nextIdx = Math.max((selectedIdx >= 0 ? selectedIdx : 0) - 1, 0);
      const nextRow = sortedRows[nextIdx];
      if (nextRow) setSelectedId(nextRow.id);
      return;
    }
    if (event.name === "r") {
      event.preventDefault?.();
      event.stopPropagation?.();
      refresh();
      return;
    }
    if (event.name === "s") {
      event.preventDefault?.();
      event.stopPropagation?.();
      toggleView();
    }
  });

  const renderCell = useCallback((
    row: HolderRow,
    column: HolderColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "holder":
        return {
          text: row.name,
          color: selectedColor ?? colors.textBright,
          attributes: TextAttributes.BOLD,
        };
      case "value":
        return { text: formatMoneyCompact(row.value, currency), color: selectedColor ?? colors.text };
      case "shares":
        return { text: formatCompact(row.shares), color: selectedColor ?? colors.text };
      case "changeShares":
        return {
          text: formatSignedCompact(row.changeShares),
          color: selectedColor ?? (row.changeShares != null ? priceColor(row.changeShares) : colors.textDim),
        };
      case "changePercent":
        return {
          text: formatMaybePercent(row.changePercent),
          color: selectedColor ?? (row.changePercent != null ? priceColor(row.changePercent) : colors.textDim),
        };
      case "percentHeld":
        return {
          text: formatHolderOwnershipPercent(resolveHolderOwnershipPercent(row, marketCap)),
          color: selectedColor ?? colors.textDim,
        };
      case "reportDate":
        return { text: displayDate(row.reportDate), color: selectedColor ?? colors.textDim };
    }
  }, [currency, marketCap]);

  usePaneFooter("holders", () => ({
    info: [
      ...(data?.asOf ? [{ id: "as-of", parts: [{ text: data.asOf, tone: "value" as const }] }] : []),
      ...(loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
    ],
    hints: [
      { id: "refresh", key: "r", label: "efresh", onPress: refresh },
      { id: "view", key: "s", label: "witch", onPress: toggleView },
    ],
  }), [data?.asOf, loading, refresh, toggleView]);

  const emptyTitle = !symbol
    ? "No ticker selected"
    : loading
      ? "Loading holders..."
      : error ?? "No holders available";
  const chartHeight = Math.max(1, height - 1 - (nativePaneChrome ? 1 : 0));

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box height={1} paddingX={1}>
        <Tabs
          tabs={VIEW_TABS}
          activeValue={viewMode}
          onSelect={(value) => setViewMode(value as ViewMode)}
          compact
          variant="bare"
          focused={focused}
        />
      </Box>

      {viewMode === "table" ? (
        <DataTableView<HolderRow, HolderColumn>
          focused={focused}
          selectedIndex={activeIdx}
          onSelectIndex={selectIndex}
          onRootKeyDown={handleKeyDown}
          resetScrollKey={data?.symbol}
          rootWidth={width}
          columns={columns}
          items={sortedRows}
          sortColumnId={sortPreference.columnId}
          sortDirection={sortPreference.direction}
          onHeaderClick={handleHeaderClick}
          getItemKey={(row) => row.id}
          isSelected={(row) => row.id === selectedId}
          onSelect={(row) => setSelectedId(row.id)}
          renderCell={renderCell}
          emptyStateTitle={emptyTitle}
        />
      ) : (
        <HoldersTreemap
          rows={sortedRows}
          width={width}
          height={chartHeight}
          selectedId={selectedId}
          onSelect={(row) => setSelectedId(row.id)}
          currency={currency}
          marketCap={marketCap}
        />
      )}
    </Box>
  );
}
