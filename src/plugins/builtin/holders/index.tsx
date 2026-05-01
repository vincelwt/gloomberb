import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, TextAttributes } from "../../../ui";
import {
  DataTableView,
  Tabs,
  usePaneFooter,
  usePaneTicker,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
} from "../../../components";
import { useShortcut } from "../../../react/input";
import { colors, priceColor } from "../../../theme/colors";
import type { HolderData, HolderRecord } from "../../../types/financials";
import type { GloomPlugin, PaneProps } from "../../../types/plugin";
import { formatCompact, formatPercent, formatPercentRaw, padTo } from "../../../utils/format";
import { normalizeTickerInput } from "../../../utils/ticker-search";
import { useMarketData, usePluginPaneState } from "../../plugin-runtime";

type ViewMode = "table" | "chart";
type HolderColumnId = "holder" | "value" | "shares" | "changeShares" | "changePercent" | "percentHeld" | "reportDate";
type HolderColumn = DataTableColumn & { id: HolderColumnId };
type SortDirection = "asc" | "desc";

interface SortPreference {
  columnId: HolderColumnId;
  direction: SortDirection;
}

interface HolderRow extends HolderRecord {
  id: string;
}

interface TileLayout {
  row: HolderRow;
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEFAULT_SORT: SortPreference = {
  columnId: "value",
  direction: "desc",
};

const VIEW_TABS: Array<{ label: string; value: ViewMode }> = [
  { label: "Table", value: "table" },
  { label: "Chart", value: "chart" },
];

function formatMoneyCompact(value: number | undefined, currency = "USD"): string {
  if (value == null) return "-";
  if (currency === "USD") {
    const sign = value < 0 ? "-" : "";
    return `${sign}$${formatCompact(Math.abs(value))}`;
  }
  return `${formatCompact(value)} ${currency}`;
}

function formatMaybePercent(value: number | undefined): string {
  if (value == null) return "-";
  return Math.abs(value) <= 1 ? formatPercent(value) : formatPercentRaw(value);
}

function formatSignedCompact(value: number | undefined): string {
  if (value == null) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatCompact(value)}`;
}

function displayDate(value: string | undefined): string {
  return value?.slice(0, 10) ?? "-";
}

function rowWeight(row: HolderRow): number {
  return Math.max(row.value ?? row.shares ?? 0, 0);
}

function buildRows(data: HolderData | null): HolderRow[] {
  return (data?.holders ?? []).map((holder, index) => ({
    ...holder,
    id: `${holder.ownerType}:${holder.name}:${holder.reportDate ?? ""}:${index}`,
  }));
}

function buildColumns(width: number): HolderColumn[] {
  const valueWidth = 10;
  const sharesWidth = 10;
  const changeWidth = 10;
  const changePercentWidth = 8;
  const heldWidth = 7;
  const dateWidth = 10;
  const columnCount = 7;
  const fixedWidth = valueWidth + sharesWidth + changeWidth + changePercentWidth + heldWidth + dateWidth;
  const holderWidth = Math.max(16, width - 2 - columnCount - fixedWidth);

  return [
    { id: "holder", label: "HOLDER", width: holderWidth, align: "left" },
    { id: "value", label: "VALUE", width: valueWidth, align: "right" },
    { id: "shares", label: "AMOUNT", width: sharesWidth, align: "right" },
    { id: "changeShares", label: "CHG", width: changeWidth, align: "right" },
    { id: "changePercent", label: "CHG%", width: changePercentWidth, align: "right" },
    { id: "percentHeld", label: "HELD", width: heldWidth, align: "right" },
    { id: "reportDate", label: "DATE", width: dateWidth, align: "right" },
  ];
}

function sortValue(row: HolderRow, columnId: HolderColumnId): string | number | null {
  switch (columnId) {
    case "holder":
      return row.name;
    case "value":
      return row.value ?? null;
    case "shares":
      return row.shares ?? null;
    case "changeShares":
      return row.changeShares ?? null;
    case "changePercent":
      return row.changePercent ?? null;
    case "percentHeld":
      return row.percentHeld ?? null;
    case "reportDate":
      return row.reportDate ?? null;
  }
}

function compareSortValues(
  left: string | number | null,
  right: string | number | null,
  direction: SortDirection,
): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;

  const comparison = typeof left === "string" && typeof right === "string"
    ? left.localeCompare(right)
    : Number(left) - Number(right);
  return direction === "asc" ? comparison : -comparison;
}

function sortRows(rows: HolderRow[], preference: SortPreference): HolderRow[] {
  return [...rows].sort((left, right) => compareSortValues(
    sortValue(left, preference.columnId),
    sortValue(right, preference.columnId),
    preference.direction,
  ));
}

function nextSortPreference(current: SortPreference, columnId: string): SortPreference {
  const typedColumnId = columnId as HolderColumnId;
  if (current.columnId !== typedColumnId) {
    return {
      columnId: typedColumnId,
      direction: typedColumnId === "holder" || typedColumnId === "reportDate" ? "asc" : "desc",
    };
  }
  return {
    columnId: typedColumnId,
    direction: current.direction === "asc" ? "desc" : "asc",
  };
}

function buildTreemap(rows: HolderRow[], width: number, height: number): TileLayout[] {
  if (width <= 0 || height <= 0) return [];
  const weightedRows = rows
    .filter((row) => rowWeight(row) > 0)
    .slice(0, Math.max(1, Math.min(80, width * height)));
  const total = weightedRows.reduce((sum, row) => sum + rowWeight(row), 0);
  if (total <= 0) return [];

  let x = 0;
  let y = 0;
  let remainingWidth = width;
  let remainingHeight = height;
  let remainingWeight = total;
  const tiles: TileLayout[] = [];

  weightedRows.forEach((row, index) => {
    const last = index === weightedRows.length - 1;
    if (remainingWidth <= 0 || remainingHeight <= 0) return;

    if (remainingWidth >= remainingHeight) {
      const sliceWidth = last
        ? remainingWidth
        : Math.max(1, Math.min(remainingWidth - 1, Math.round(remainingWidth * rowWeight(row) / remainingWeight)));
      tiles.push({ row, x, y, width: sliceWidth, height: remainingHeight });
      x += sliceWidth;
      remainingWidth -= sliceWidth;
    } else {
      const sliceHeight = last
        ? remainingHeight
        : Math.max(1, Math.min(remainingHeight - 1, Math.round(remainingHeight * rowWeight(row) / remainingWeight)));
      tiles.push({ row, x, y, width: remainingWidth, height: sliceHeight });
      y += sliceHeight;
      remainingHeight -= sliceHeight;
    }
    remainingWeight -= rowWeight(row);
  });

  return tiles.filter((tile) => tile.width > 0 && tile.height > 0);
}

function tileColor(row: HolderRow): string {
  if (row.changePercent == null) return colors.neutral;
  return priceColor(row.changePercent);
}

function Tile({ tile, selected, currency, onSelect }: {
  tile: TileLayout;
  selected: boolean;
  currency: string;
  onSelect: () => void;
}) {
  const innerWidth = Math.max(1, tile.width - 1);
  const textColor = "#ffffff";
  const attributes = selected ? TextAttributes.BOLD : TextAttributes.NONE;
  const label = tile.row.name;
  const amount = tile.row.value != null
    ? formatMoneyCompact(tile.row.value, currency)
    : formatCompact(tile.row.shares);
  const change = tile.row.changePercent != null ? formatMaybePercent(tile.row.changePercent) : "No change";

  return (
    <Box
      position="absolute"
      left={tile.x}
      top={tile.y}
      width={tile.width}
      height={tile.height}
      backgroundColor={selected ? colors.selected : tileColor(tile.row)}
      onMouseDown={(event) => {
        event.preventDefault();
        onSelect();
      }}
    >
      <Text fg={textColor} attributes={attributes}>{padTo(label, innerWidth)}</Text>
      {tile.height >= 2 && (
        <Text fg={textColor} attributes={attributes}>{padTo(amount, innerWidth)}</Text>
      )}
      {tile.height >= 3 && (
        <Text fg={textColor} attributes={attributes}>{padTo(change, innerWidth)}</Text>
      )}
    </Box>
  );
}

function HoldersTreemap({ rows, width, height, selectedId, onSelect, currency }: {
  rows: HolderRow[];
  width: number;
  height: number;
  selectedId: string | null;
  onSelect: (row: HolderRow) => void;
  currency: string;
}) {
  const chartWidth = Math.max(1, width - 2);
  const tiles = useMemo(() => buildTreemap(rows, chartWidth, height), [chartWidth, height, rows]);

  if (tiles.length === 0) {
    return (
      <Box width={width} height={height} paddingX={1} paddingY={1}>
        <Text fg={colors.textDim}>No chartable holder values</Text>
      </Box>
    );
  }

  return (
    <Box width={width} height={height} paddingX={1} backgroundColor={colors.bg}>
      <Box position="relative" width={chartWidth} height={height} backgroundColor={colors.bg}>
        {tiles.map((tile) => (
          <Tile
            key={tile.row.id}
            tile={tile}
            selected={tile.row.id === selectedId}
            currency={currency}
            onSelect={() => onSelect(tile.row)}
          />
        ))}
      </Box>
    </Box>
  );
}

export function HoldersPane({ focused, width, height }: PaneProps) {
  const { symbol, ticker } = usePaneTicker();
  const dataProvider = useMarketData();
  const [viewMode, setViewMode] = usePluginPaneState<ViewMode>("viewMode", "table");
  const [sortPreference, setSortPreference] = usePluginPaneState<SortPreference>("sortPreference", DEFAULT_SORT);
  const [data, setData] = useState<HolderData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fetchGenRef = useRef(0);

  const currency = data?.currency ?? ticker?.metadata.currency ?? "USD";
  const exchange = ticker?.metadata.exchange ?? "";
  const rows = useMemo(() => buildRows(data), [data]);
  const sortedRows = useMemo(() => sortRows(rows, sortPreference), [rows, sortPreference]);
  const columns = useMemo(() => buildColumns(width), [width]);
  const selectedIdx = selectedId
    ? sortedRows.findIndex((row) => row.id === selectedId)
    : -1;
  const activeIdx = selectedIdx >= 0 ? selectedIdx : (sortedRows.length > 0 ? 0 : -1);

  const loadHolders = useCallback(async (forceRefresh = false) => {
    if (!symbol || !dataProvider?.getHolders) {
      setData(null);
      setLoading(false);
      setError(dataProvider?.getHolders ? null : "Holder data source unavailable");
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
    if (event.name === "j" || event.name === "down") {
      event.preventDefault?.();
      event.stopPropagation?.();
      const nextIdx = Math.min((selectedIdx >= 0 ? selectedIdx : 0) + 1, sortedRows.length - 1);
      const nextRow = sortedRows[nextIdx];
      if (nextRow) setSelectedId(nextRow.id);
      return;
    }
    if (event.name === "k" || event.name === "up") {
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
        return { text: formatMaybePercent(row.percentHeld), color: selectedColor ?? colors.textDim };
      case "reportDate":
        return { text: displayDate(row.reportDate), color: selectedColor ?? colors.textDim };
    }
  }, [currency]);

  usePaneFooter("holders", () => ({
    info: [
      { id: "source", parts: [{ text: data?.providerId ?? "holders", tone: "label" }] },
      ...(data?.asOf ? [{ id: "as-of", parts: [{ text: data.asOf, tone: "value" as const }] }] : []),
      { id: "count", parts: [{ text: `${rows.length} rows`, tone: rows.length > 0 ? "value" : "muted" }] },
      ...(loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
    ],
    hints: [
      { id: "refresh", key: "r", label: "efresh", onPress: refresh },
      { id: "view", key: "s", label: "witch", onPress: toggleView },
    ],
  }), [data?.asOf, data?.providerId, loading, refresh, rows.length, toggleView]);

  const emptyTitle = !symbol
    ? "No ticker selected"
    : loading
      ? "Loading holders..."
      : error ?? "No holders available";

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box height={1} paddingX={1}>
        <Tabs
          tabs={VIEW_TABS}
          activeValue={viewMode}
          onSelect={(value) => setViewMode(value as ViewMode)}
          compact
          variant="bare"
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
          height={Math.max(1, height - 1)}
          selectedId={selectedId}
          onSelect={(row) => setSelectedId(row.id)}
          currency={currency}
        />
      )}
    </Box>
  );
}

export const holdersPlugin: GloomPlugin = {
  id: "holders",
  name: "Holders",
  version: "1.0.0",
  description: "Institutional holders by value and position change",
  toggleable: true,

  panes: [
    {
      id: "holders",
      name: "Holders",
      icon: "H",
      component: HoldersPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 105, height: 34 },
    },
  ],

  paneTemplates: [
    {
      id: "holders-pane",
      paneId: "holders",
      label: "Holders",
      description: "Institutional holders for the selected ticker.",
      keywords: ["holders", "ownership", "institutional", "owners", "hds"],
      shortcut: { prefix: "HDS", argPlaceholder: "ticker", argKind: "ticker" },
      canCreate: (context, options) => (options?.symbol ?? normalizeTickerInput(context.activeTicker, options?.arg)) !== null,
      createInstance: (context, options) => {
        const ticker = options?.symbol ?? normalizeTickerInput(context.activeTicker, options?.arg);
        return ticker
          ? {
            title: ticker,
            binding: { kind: "fixed", symbol: ticker },
            placement: "floating",
          }
          : null;
      },
    },
  ],
};
