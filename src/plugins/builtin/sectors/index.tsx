import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { DataTable, type DataTableCell, type DataTableColumn } from "../../../components";
import type { GloomPlugin, PaneProps } from "../../../types/plugin";
import { colors, priceColor } from "../../../theme/colors";
import { formatCurrency, formatPercentRaw } from "../../../utils/format";
import { usePluginPaneState, usePluginTickerActions } from "../../plugin-runtime";
import { getSharedDataProvider } from "../../registry";
import { SECTORS, type SectorDef } from "./sector-data";

const REFRESH_INTERVAL_MS = 60_000;

interface SectorRow extends SectorDef {
  price: number | null;
  changePercent: number | null;
  currency: string;
  loading: boolean;
}

type SectorColumnId = "name" | "etf" | "price" | "changePercent" | "bar";
type SectorColumn = DataTableColumn & { id: SectorColumnId };
type SortDirection = "asc" | "desc";

interface SectorSortPreference {
  columnId: SectorColumnId;
  direction: SortDirection;
}

const DEFAULT_SORT_PREFERENCE: SectorSortPreference = {
  columnId: "changePercent",
  direction: "desc",
};

function buildBar(changePercent: number, barWidth: number): string {
  if (barWidth <= 0) return "";
  const filled = Math.round(Math.abs(changePercent) / 5 * barWidth);
  const clamped = Math.min(filled, barWidth);
  return "━".repeat(clamped);
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function buildColumns(width: number): SectorColumn[] {
  const etfWidth = 6;
  const priceWidth = 11;
  const changeWidth = 9;
  const barWidth = Math.max(4, Math.min(24, Math.floor(width * 0.24)));
  const columnCount = 5;
  const fixedWidth = etfWidth + priceWidth + changeWidth + barWidth;
  const nameWidth = Math.max(12, width - 2 - columnCount - fixedWidth);

  return [
    { id: "name", label: "SECTOR", width: nameWidth, align: "left" },
    { id: "etf", label: "ETF", width: etfWidth, align: "left" },
    { id: "price", label: "LAST", width: priceWidth, align: "right" },
    { id: "changePercent", label: "CHG%", width: changeWidth, align: "right" },
    { id: "bar", label: "MOVE", width: barWidth, align: "left" },
  ];
}

function getSortValue(columnId: SectorColumnId, row: SectorRow): string | number | null {
  switch (columnId) {
    case "name":
      return row.name;
    case "etf":
      return row.etf;
    case "price":
      return row.price;
    case "changePercent":
    case "bar":
      return row.changePercent;
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

function sortRows(rows: SectorRow[], sortPreference: SectorSortPreference): SectorRow[] {
  return [...rows].sort((left, right) => compareSortValues(
    getSortValue(sortPreference.columnId, left),
    getSortValue(sortPreference.columnId, right),
    sortPreference.direction,
  ));
}

function nextSortPreference(current: SectorSortPreference, columnId: string): SectorSortPreference {
  const typedColumnId = columnId as SectorColumnId;
  if (current.columnId !== typedColumnId) {
    return {
      columnId: typedColumnId,
      direction: typedColumnId === "changePercent" || typedColumnId === "bar" ? "desc" : "asc",
    };
  }
  if (current.direction === "desc") {
    return { columnId: typedColumnId, direction: "asc" };
  }
  return DEFAULT_SORT_PREFERENCE;
}

export function SectorPerformancePane({ focused, width, height }: PaneProps) {
  const { navigateTicker } = usePluginTickerActions();
  const [rows, setRows] = useState<SectorRow[]>(
    SECTORS.map((sector) => ({ ...sector, price: null, changePercent: null, currency: "USD", loading: true })),
  );
  const [selectedEtf, setSelectedEtf] = usePluginPaneState<string | null>("selectedEtf", null);
  const [sortPreference, setSortPreference] = usePluginPaneState<SectorSortPreference>(
    "sortPreference",
    DEFAULT_SORT_PREFERENCE,
  );
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchGenRef = useRef(0);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const headerScrollRef = useRef<ScrollBoxRenderable>(null);

  const columns = useMemo(() => buildColumns(width), [width]);
  const sortedRows = useMemo(() => sortRows(rows, sortPreference), [rows, sortPreference]);
  const selectedIdx = selectedEtf
    ? sortedRows.findIndex((row) => row.etf === selectedEtf)
    : -1;
  const activeIdx = selectedIdx >= 0 ? selectedIdx : (sortedRows.length > 0 ? 0 : -1);

  const syncHeaderScroll = useCallback(() => {
    const bodyScrollBox = scrollRef.current;
    const headerScrollBox = headerScrollRef.current;
    if (bodyScrollBox && headerScrollBox && headerScrollBox.scrollLeft !== bodyScrollBox.scrollLeft) {
      headerScrollBox.scrollLeft = bodyScrollBox.scrollLeft;
    }
  }, []);

  const handleBodyScrollActivity = useCallback(() => {
    syncHeaderScroll();
  }, [syncHeaderScroll]);

  const fetchAll = useCallback(() => {
    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    const provider = getSharedDataProvider();
    if (!provider) {
      setRows((prev) => prev.map((row) => ({ ...row, loading: false })));
      return;
    }

    setRows((prev) => prev.map((row) => ({ ...row, loading: true })));

    const fetches = SECTORS.map(async (sector) => {
      try {
        const quote = await provider.getQuote(sector.etf, "");
        if (fetchGenRef.current !== gen) return;
        setRows((prev) =>
          prev.map((row) =>
            row.etf === sector.etf
              ? {
                  ...row,
                  price: quote?.price ?? null,
                  changePercent: quote?.changePercent ?? null,
                  currency: quote?.currency ?? "USD",
                  loading: false,
                }
              : row,
          ),
        );
      } catch {
        if (fetchGenRef.current !== gen) return;
        setRows((prev) =>
          prev.map((row) =>
            row.etf === sector.etf ? { ...row, loading: false } : row,
          ),
        );
      }
    });

    Promise.allSettled(fetches).then(() => {
      if (fetchGenRef.current === gen) {
        setLastRefresh(new Date());
      }
    });
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchAll]);

  useEffect(() => {
    if (selectedEtf && sortedRows.some((row) => row.etf === selectedEtf)) return;
    const firstRow = sortedRows[0];
    if (firstRow && selectedEtf !== firstRow.etf) {
      setSelectedEtf(firstRow.etf);
    }
  }, [selectedEtf, setSelectedEtf, sortedRows]);

  useEffect(() => {
    const scrollBox = scrollRef.current;
    if (!scrollBox?.viewport || activeIdx < 0) return;
    const viewportHeight = Math.max(scrollBox.viewport.height, 1);
    if (activeIdx < scrollBox.scrollTop) {
      scrollBox.scrollTo(activeIdx);
    } else if (activeIdx >= scrollBox.scrollTop + viewportHeight) {
      scrollBox.scrollTo(activeIdx - viewportHeight + 1);
    }
  }, [activeIdx, sortedRows.length]);

  const openRow = useCallback((row: SectorRow) => {
    navigateTicker(row.etf);
  }, [navigateTicker]);

  const handleHeaderClick = useCallback((columnId: string) => {
    setSortPreference((current) => nextSortPreference(current, columnId));
  }, [setSortPreference]);

  const selectIndex = useCallback((index: number) => {
    const row = sortedRows[index];
    if (row) setSelectedEtf(row.etf);
  }, [setSelectedEtf, sortedRows]);

  const selectRow = useCallback((row: SectorRow) => {
    if (row.etf === selectedEtf) {
      openRow(row);
      return;
    }
    setSelectedEtf(row.etf);
  }, [openRow, selectedEtf, setSelectedEtf]);

  useKeyboard((event) => {
    if (!focused) return;

    if (event.name === "j" || event.name === "down") {
      selectIndex(Math.min(activeIdx + 1, sortedRows.length - 1));
    } else if (event.name === "k" || event.name === "up") {
      selectIndex(Math.max(activeIdx - 1, 0));
    } else if (event.name === "return") {
      const row = sortedRows[activeIdx];
      if (row) openRow(row);
    } else if (event.name === "r") {
      fetchAll();
    }
  });

  const renderCell = useCallback((
    row: SectorRow,
    column: SectorColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "name":
        return { text: row.name, color: selectedColor ?? colors.text };
      case "etf":
        return { text: row.etf, color: selectedColor ?? colors.textDim };
      case "price":
        if (row.loading && row.price === null) {
          return { text: "…", color: selectedColor ?? colors.textDim };
        }
        return {
          text: row.price !== null ? formatCurrency(row.price, row.currency) : "—",
          color: selectedColor ?? (row.price !== null ? colors.text : colors.textDim),
        };
      case "changePercent":
        return {
          text: row.changePercent !== null ? formatPercentRaw(row.changePercent) : "—",
          color: selectedColor ?? (row.changePercent !== null ? priceColor(row.changePercent) : colors.textDim),
        };
      case "bar": {
        const bar = row.changePercent !== null ? buildBar(row.changePercent, column.width) : "";
        const barColor = row.changePercent !== null && row.changePercent >= 0 ? colors.positive : colors.negative;
        return {
          text: bar,
          color: selectedColor ?? (bar ? barColor : colors.textDim),
        };
      }
    }
  }, []);

  return (
    <box flexDirection="column" width={width} height={height}>
      <box flexDirection="row" height={1} paddingX={1}>
        {lastRefresh ? (
          <text fg={colors.textMuted}>{formatTime(lastRefresh)}</text>
        ) : (
          <text fg={colors.textMuted}>loading…</text>
        )}
      </box>

      <DataTable<SectorRow, SectorColumn>
        columns={columns}
        items={sortedRows}
        sortColumnId={sortPreference.columnId}
        sortDirection={sortPreference.direction}
        onHeaderClick={handleHeaderClick}
        headerScrollRef={headerScrollRef}
        scrollRef={scrollRef}
        syncHeaderScroll={syncHeaderScroll}
        onBodyScrollActivity={handleBodyScrollActivity}
        hoveredIdx={hoveredIdx}
        setHoveredIdx={setHoveredIdx}
        getItemKey={(row) => row.etf}
        isSelected={(row) => row.etf === selectedEtf}
        onSelect={selectRow}
        renderCell={renderCell}
        emptyStateTitle="No sector data available"
        showHorizontalScrollbar={false}
      />

      <box height={1} paddingX={1}>
        <text fg={colors.textMuted}>[r]efresh</text>
      </box>
    </box>
  );
}

export const sectorsPlugin: GloomPlugin = {
  id: "sectors",
  name: "Sector Performance",
  version: "1.0.0",
  description: "S&P 500 sector performance via sector ETF proxies",
  toggleable: true,

  panes: [
    {
      id: "sectors",
      name: "Sector Performance",
      icon: "S",
      component: SectorPerformancePane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 75, height: 16 },
    },
  ],

  paneTemplates: [
    {
      id: "sectors-pane",
      paneId: "sectors",
      label: "Sector Performance",
      description: "S&P 500 sector performance sorted by daily change.",
      keywords: ["sector", "sectors", "etf", "xlk", "xlv", "xlf", "performance", "spdr"],
      shortcut: { prefix: "BI" },
    },
  ],
};
