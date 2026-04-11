import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { DataTable, type DataTableCell, type DataTableColumn } from "../../../components";
import type { GloomPlugin, PaneProps } from "../../../types/plugin";
import type { Quote } from "../../../types/financials";
import type { MarketState } from "../../../types/financials";
import { colors, priceColor } from "../../../theme/colors";
import { formatCurrency, formatPercentRaw } from "../../../utils/format";
import { usePluginTickerActions } from "../../plugin-runtime";
import { getSharedDataProvider } from "../../registry";
import { WORLD_INDICES, REGION_LABELS, REGION_ORDER, getIndicesByRegion, type IndexEntry } from "./indices";

const REFRESH_INTERVAL_MS = 60_000;

interface IndexQuoteState {
  quote: Quote | null;
  loading: boolean;
  error: string | null;
}

type QuoteMap = Map<string, IndexQuoteState>;
type WorldIndexTableRow =
  | { type: "header"; region: IndexEntry["region"] }
  | { type: "row"; entry: IndexEntry };
type WorldIndexColumnId = "status" | "symbol" | "name" | "price" | "changePercent";
type WorldIndexColumn = DataTableColumn & { id: WorldIndexColumnId };
type SortDirection = "asc" | "desc";

interface WorldIndexSortPreference {
  columnId: WorldIndexColumnId | null;
  direction: SortDirection;
}

const DEFAULT_SORT_PREFERENCE: WorldIndexSortPreference = {
  columnId: null,
  direction: "asc",
};

const MARKET_STATE_SORT_ORDER: Partial<Record<MarketState, number>> = {
  REGULAR: 0,
  PREPRE: 1,
  PRE: 1,
  POST: 1,
  POSTPOST: 1,
  CLOSED: 2,
};

function marketStatusDot(state: MarketState | undefined): { char: string; color: string } {
  switch (state) {
    case "REGULAR":
      return { char: "●", color: colors.positive };
    case "PRE":
    case "POST":
    case "PREPRE":
    case "POSTPOST":
      return { char: "●", color: colors.warning };
    case "CLOSED":
    default:
      return { char: "●", color: colors.negative };
  }
}

function getSortValue(
  columnId: WorldIndexColumnId,
  entry: IndexEntry,
  quotes: QuoteMap,
): string | number | null {
  const quote = quotes.get(entry.symbol)?.quote;

  switch (columnId) {
    case "status":
      return quote?.marketState ? (MARKET_STATE_SORT_ORDER[quote.marketState] ?? 3) : 3;
    case "symbol":
      return entry.shortName;
    case "name":
      return entry.name;
    case "price":
      return quote?.price ?? null;
    case "changePercent":
      return quote?.changePercent ?? null;
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

function sortEntries(
  entries: IndexEntry[],
  sortPreference: WorldIndexSortPreference,
  quotes: QuoteMap,
): IndexEntry[] {
  const sortColumnId = sortPreference.columnId;
  if (!sortColumnId) return entries;
  return [...entries].sort((left, right) => compareSortValues(
    getSortValue(sortColumnId, left, quotes),
    getSortValue(sortColumnId, right, quotes),
    sortPreference.direction,
  ));
}

function buildFlatRows(
  indicesByRegion: Map<IndexEntry["region"], IndexEntry[]>,
  sortPreference: WorldIndexSortPreference,
  quotes: QuoteMap,
): WorldIndexTableRow[] {
  const rows: WorldIndexTableRow[] = [];
  for (const region of REGION_ORDER) {
    const entries = sortEntries(indicesByRegion.get(region) ?? [], sortPreference, quotes);
    if (entries.length === 0) continue;
    rows.push({ type: "header", region });
    for (const entry of entries) {
      rows.push({ type: "row", entry });
    }
  }
  return rows;
}

// Returns only the row-type indices (for navigation purposes)
function rowIndicesOf(flatRows: ReturnType<typeof buildFlatRows>): number[] {
  return flatRows.reduce<number[]>((acc, row, i) => {
    if (row.type === "row") acc.push(i);
    return acc;
  }, []);
}

function nextSortPreference(
  current: WorldIndexSortPreference,
  columnId: string,
): WorldIndexSortPreference {
  const typedColumnId = columnId as WorldIndexColumnId;
  if (current.columnId !== typedColumnId) {
    return { columnId: typedColumnId, direction: "asc" };
  }
  if (current.direction === "asc") {
    return { columnId: typedColumnId, direction: "desc" };
  }
  return DEFAULT_SORT_PREFERENCE;
}

export function WorldIndicesPane({ focused, width, height }: PaneProps) {
  const { pinTicker } = usePluginTickerActions();
  const [quotes, setQuotes] = useState<QuoteMap>(new Map());
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [hoveredFlatIdx, setHoveredFlatIdx] = useState<number | null>(null);
  const [sortPreference, setSortPreference] = useState<WorldIndexSortPreference>(DEFAULT_SORT_PREFERENCE);
  const fetchGenRef = useRef(0);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const headerScrollRef = useRef<ScrollBoxRenderable>(null);

  const indicesByRegion = useMemo(() => getIndicesByRegion(), []);
  const flatRows = useMemo(
    () => buildFlatRows(indicesByRegion, sortPreference, quotes),
    [indicesByRegion, quotes, sortPreference],
  );
  const navigableIndices = useMemo(() => rowIndicesOf(flatRows), [flatRows]);
  const selectedFlatIdx = selectedSymbol
    ? flatRows.findIndex((row) => row.type === "row" && row.entry.symbol === selectedSymbol)
    : -1;
  const activeFlatIdx = selectedFlatIdx >= 0 ? selectedFlatIdx : (navigableIndices[0] ?? -1);

  useEffect(() => {
    if (selectedSymbol && selectedFlatIdx >= 0) return;
    const firstRow = flatRows.find((row) => row.type === "row");
    if (firstRow?.type === "row") {
      setSelectedSymbol(firstRow.entry.symbol);
    } else if (selectedSymbol !== null) {
      setSelectedSymbol(null);
    }
  }, [flatRows, selectedFlatIdx, selectedSymbol]);

  const fetchAll = () => {
    const provider = getSharedDataProvider();
    if (!provider) return;

    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;

    for (const entry of WORLD_INDICES) {
      setQuotes((prev) => {
        const next = new Map(prev);
        const existing = next.get(entry.symbol);
        next.set(entry.symbol, { quote: existing?.quote ?? null, loading: true, error: null });
        return next;
      });

      provider.getQuote(entry.symbol, "").then((quote) => {
        if (fetchGenRef.current !== gen) return;
        setQuotes((prev) => {
          const next = new Map(prev);
          next.set(entry.symbol, { quote, loading: false, error: null });
          return next;
        });
      }).catch((err: unknown) => {
        if (fetchGenRef.current !== gen) return;
        const msg = err instanceof Error ? err.message : String(err);
        setQuotes((prev) => {
          const next = new Map(prev);
          next.set(entry.symbol, { quote: null, loading: false, error: msg });
          return next;
        });
      });
    }
  };

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

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

  const openSelected = useCallback((flatIdx: number) => {
    const row = flatRows[flatIdx];
    if (!row || row.type !== "row") return;
    pinTicker(row.entry.symbol, { floating: true, paneType: "ticker-detail" });
  }, [flatRows, pinTicker]);

  const selectFlatIndex = useCallback((flatIdx: number) => {
    const row = flatRows[flatIdx];
    if (!row || row.type !== "row") return;
    setSelectedSymbol(row.entry.symbol);
  }, [flatRows]);

  const handleHeaderClick = useCallback((columnId: string) => {
    setSortPreference((current) => nextSortPreference(current, columnId));
  }, []);

  useKeyboard((event) => {
    if (!focused) return;

    const currentPos = navigableIndices.indexOf(activeFlatIdx);
    const key = event.name;
    const isEnter = key === "enter" || key === "return";

    if (key === "j" || key === "down") {
      event.preventDefault?.();
      const next = navigableIndices[currentPos >= 0 ? currentPos + 1 : 0];
      if (next !== undefined) selectFlatIndex(next);
    } else if (key === "k" || key === "up") {
      event.preventDefault?.();
      const next = navigableIndices[currentPos > 0 ? currentPos - 1 : 0];
      if (next !== undefined) selectFlatIndex(next);
    } else if (isEnter) {
      event.preventDefault?.();
      openSelected(activeFlatIdx);
    }
  });

  useEffect(() => {
    const scrollBox = scrollRef.current;
    if (!scrollBox?.viewport || activeFlatIdx < 0) return;
    const viewportHeight = Math.max(scrollBox.viewport.height, 1);
    if (activeFlatIdx < scrollBox.scrollTop) {
      scrollBox.scrollTo(activeFlatIdx);
    } else if (activeFlatIdx >= scrollBox.scrollTop + viewportHeight) {
      scrollBox.scrollTo(activeFlatIdx - viewportHeight + 1);
    }
  }, [activeFlatIdx]);

  const columns = useMemo<WorldIndexColumn[]>(() => {
    const statusWidth = 1;
    const symbolWidth = 8;
    const priceWidth = 15;
    const changeWidth = 9;
    const columnCount = 5;
    const fixedWidth = statusWidth + symbolWidth + priceWidth + changeWidth;
    const nameWidth = Math.max(10, width - 2 - columnCount - fixedWidth);

    return [
      { id: "status", label: "", width: statusWidth, align: "left" },
      { id: "symbol", label: "INDEX", width: symbolWidth, align: "left" },
      { id: "name", label: "NAME", width: nameWidth, align: "left" },
      { id: "price", label: "LAST", width: priceWidth, align: "right" },
      { id: "changePercent", label: "CHG%", width: changeWidth, align: "right" },
    ];
  }, [width]);

  const renderCell = useCallback((
    row: WorldIndexTableRow,
    column: WorldIndexColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    if (row.type === "header") return { text: "" };

    const { entry } = row;
    const state = quotes.get(entry.symbol);
    const quote = state?.quote;
    const selectedColor = rowState.selected ? colors.selectedText : undefined;

    switch (column.id) {
      case "status": {
        const dot = marketStatusDot(quote?.marketState);
        return { text: dot.char, color: dot.color };
      }
      case "symbol":
        return {
          text: entry.shortName,
          color: selectedColor ?? colors.textBright,
          attributes: TextAttributes.BOLD,
        };
      case "name":
        return {
          text: entry.name,
          color: selectedColor,
        };
      case "price":
        if (state?.loading && !quote) {
          return { text: "…", color: rowState.selected ? colors.selectedText : colors.textDim };
        }
        if (state?.error || quote?.price === undefined) {
          return { text: "—", color: rowState.selected ? colors.selectedText : colors.textDim };
        }
        return {
          text: formatCurrency(quote.price, quote.currency ?? "USD"),
          color: selectedColor,
        };
      case "changePercent":
        if (!quote || quote.changePercent === undefined) {
          return { text: "—", color: rowState.selected ? colors.selectedText : colors.textDim };
        }
        return {
          text: formatPercentRaw(quote.changePercent),
          color: selectedColor ?? priceColor(quote.changePercent),
        };
    }
  }, [quotes]);

  return (
    <box flexDirection="column" width={width} height={height}>
      <DataTable<WorldIndexTableRow, WorldIndexColumn>
        columns={columns}
        items={flatRows}
        sortColumnId={sortPreference.columnId}
        sortDirection={sortPreference.direction}
        onHeaderClick={handleHeaderClick}
        headerScrollRef={headerScrollRef}
        scrollRef={scrollRef}
        syncHeaderScroll={syncHeaderScroll}
        onBodyScrollActivity={handleBodyScrollActivity}
        hoveredIdx={hoveredFlatIdx}
        setHoveredIdx={setHoveredFlatIdx}
        getItemKey={(row) => row.type === "header" ? `header-${row.region}` : row.entry.symbol}
        isSelected={(row) => row.type === "row" && row.entry.symbol === selectedSymbol}
        onSelect={(_row, index) => selectFlatIndex(index)}
        onActivate={(_row, index) => openSelected(index)}
        renderSectionHeader={(row) => row.type === "header"
          ? { text: REGION_LABELS[row.region] }
          : null}
        renderCell={renderCell}
        emptyStateTitle="No indices configured."
      />
    </box>
  );
}

export const worldIndicesPlugin: GloomPlugin = {
  id: "world-indices",
  name: "World Equity Indices",
  version: "1.0.0",
  description: "Global equity index monitor grouped by region",
  toggleable: true,

  panes: [
    {
      id: "world-indices",
      name: "World Indices",
      icon: "W",
      component: WorldIndicesPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 72, height: 32 },
    },
  ],

  paneTemplates: [
    {
      id: "world-indices-pane",
      paneId: "world-indices",
      label: "World Equity Indices",
      description: "Monitor global equity indices grouped by region.",
      keywords: ["world", "indices", "global", "equity", "markets", "international"],
      shortcut: { prefix: "WEI" },
    },
  ],
};
