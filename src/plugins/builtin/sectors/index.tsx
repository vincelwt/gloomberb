import { useCallback, useEffect, useMemo, useRef } from "react";
import { Box } from "../../../ui";
import { DataTableView, Tabs, usePaneFooter, type DataTableCell, type DataTableColumn, type DataTableKeyEvent } from "../../../components";
import type { GloomPlugin, PaneProps } from "../../../types/plugin";
import type { PricePoint, Quote } from "../../../types/financials";
import { colors, priceColor } from "../../../theme/colors";
import { formatCurrency, formatPercentRaw } from "../../../utils/format";
import { useAssetData, useDebouncedPluginPaneState, usePluginPaneState, usePluginTickerActions } from "../../plugin-runtime";
import {
  SECTOR_COLLECTIONS,
  getSectorCollection,
  type SectorCollectionId,
  type SectorDef,
} from "./sector-data";

const REFRESH_INTERVAL_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ONE_MONTH_DAYS = 30;
const ONE_YEAR_DAYS = 365;
const DEFAULT_COLLECTION_ID: SectorCollectionId = "sectors";

interface SectorRow extends SectorDef {
  price: number | null;
  changePercent: number | null;
  return1M: number | null;
  return1Y: number | null;
  currency: string;
  loading: boolean;
}

type SectorColumnId = "name" | "etf" | "price" | "changePercent" | "return1M" | "return1Y" | "bar";
type SectorColumn = DataTableColumn & { id: SectorColumnId };
type SortDirection = "asc" | "desc";
type SectorRowsByCollection = Record<SectorCollectionId, SectorRow[]>;
type SectorRefreshByCollection = Partial<Record<SectorCollectionId, number>>;

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

function createLoadingRows(sectors: readonly SectorDef[]): SectorRow[] {
  return sectors.map((sector) => ({
    ...sector,
    price: null,
    changePercent: null,
    return1M: null,
    return1Y: null,
    currency: "USD",
    loading: true,
  }));
}

function createRowsByCollection(): SectorRowsByCollection {
  return {
    sectors: createLoadingRows(getSectorCollection("sectors").items),
    industries: createLoadingRows(getSectorCollection("industries").items),
  };
}

const INITIAL_ROWS_BY_COLLECTION = createRowsByCollection();
const INITIAL_REFRESH_BY_COLLECTION: SectorRefreshByCollection = {};

function normalizeRowsForCollection(
  rowsByCollection: SectorRowsByCollection,
  collectionId: SectorCollectionId,
): SectorRow[] {
  const collection = getSectorCollection(collectionId);
  const rows = rowsByCollection[collectionId] ?? [];
  return collection.items.map((sector) => {
    const existing = rows.find((row) => row.etf === sector.etf);
    return {
      ...sector,
      price: existing?.price ?? null,
      changePercent: existing?.changePercent ?? null,
      return1M: existing?.return1M ?? null,
      return1Y: existing?.return1Y ?? null,
      currency: existing?.currency ?? "USD",
      loading: existing?.loading ?? true,
    };
  });
}

function updateRowsForCollection(
  rowsByCollection: SectorRowsByCollection,
  collectionId: SectorCollectionId,
  updater: (rows: SectorRow[]) => SectorRow[],
): SectorRowsByCollection {
  return {
    ...rowsByCollection,
    [collectionId]: updater(normalizeRowsForCollection(rowsByCollection, collectionId)),
  };
}

function getPricePointTimestamp(point: PricePoint): number {
  const value = point.date as Date | string | number | null | undefined;
  if (value instanceof Date) return value.getTime();
  if (value == null) return Number.NaN;
  return new Date(value).getTime();
}

function getSortedHistory(history: readonly PricePoint[]): Array<{ point: PricePoint; timestamp: number }> {
  return history
    .map((point) => ({ point, timestamp: getPricePointTimestamp(point) }))
    .filter(({ point, timestamp }) => (
      Number.isFinite(timestamp)
      && Number.isFinite(point.close)
      && point.close > 0
    ))
    .sort((left, right) => left.timestamp - right.timestamp);
}

function latestHistoryClose(history: readonly PricePoint[]): number | null {
  return getSortedHistory(history).at(-1)?.point.close ?? null;
}

export function computeTrailingReturn(
  history: readonly PricePoint[],
  days: number,
  latestPrice?: number | null,
): number | null {
  const points = getSortedHistory(history);
  if (points.length < 2) return null;

  const latest = points.at(-1)!;
  const endPrice = latestPrice != null && Number.isFinite(latestPrice) && latestPrice > 0
    ? latestPrice
    : latest.point.close;
  const targetTimestamp = latest.timestamp - days * DAY_MS;
  let baseline = points[0]!;
  for (const point of points) {
    if (point.timestamp > targetTimestamp) break;
    baseline = point;
  }
  const baselinePrice = baseline.point.close;
  if (!Number.isFinite(endPrice) || !Number.isFinite(baselinePrice) || baselinePrice <= 0) return null;
  return (endPrice / baselinePrice - 1) * 100;
}

function buildColumns(width: number): SectorColumn[] {
  const etfWidth = 4;
  const priceWidth = 8;
  const changeWidth = 8;
  const returnWidth = 8;
  const showBar = width >= 67;
  const compactBar = width < 82;
  const barWidth = showBar
    ? compactBar ? 6 : Math.max(8, Math.min(18, Math.floor(width * 0.16)))
    : 0;
  const columnCount = showBar ? 7 : 6;
  const fixedWidth = etfWidth + priceWidth + changeWidth + returnWidth * 2 + barWidth;
  const nameWidth = Math.max(12, Math.min(22, width - 2 - columnCount - fixedWidth));

  const columns: SectorColumn[] = [
    { id: "name", label: "SECTOR", width: nameWidth, align: "left" },
    { id: "etf", label: "ETF", width: etfWidth, align: "left" },
    { id: "price", label: "LAST", width: priceWidth, align: "right" },
    { id: "changePercent", label: "1D", width: changeWidth, align: "right" },
    { id: "return1M", label: "1M", width: returnWidth, align: "right" },
    { id: "return1Y", label: "1Y", width: returnWidth, align: "right" },
  ];
  if (showBar) {
    columns.push({ id: "bar", label: "MOVE", width: barWidth, align: "left" });
  }
  return columns;
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
      return row.changePercent;
    case "return1M":
      return row.return1M;
    case "return1Y":
      return row.return1Y;
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
      direction: typedColumnId === "changePercent"
        || typedColumnId === "return1M"
        || typedColumnId === "return1Y"
        || typedColumnId === "bar"
        ? "desc"
        : "asc",
    };
  }
  if (current.direction === "desc") {
    return { columnId: typedColumnId, direction: "asc" };
  }
  return DEFAULT_SORT_PREFERENCE;
}

function SectorPerformancePane({ focused, width, height }: PaneProps) {
  const dataProvider = useAssetData();
  const { navigateTicker } = usePluginTickerActions();
  const [activeCollectionId, setActiveCollectionId] = usePluginPaneState<SectorCollectionId>(
    "activeCollectionId",
    DEFAULT_COLLECTION_ID,
  );
  const activeCollection = getSectorCollection(activeCollectionId);
  const [rowsByCollection, setRowsByCollection] = useDebouncedPluginPaneState<SectorRowsByCollection>(
    "rowsByCollection:v1",
    INITIAL_ROWS_BY_COLLECTION,
  );
  const [lastRefreshByCollection, setLastRefreshByCollection] = useDebouncedPluginPaneState<SectorRefreshByCollection>(
    "lastRefreshByCollection:v1",
    INITIAL_REFRESH_BY_COLLECTION,
  );
  const [selectedEtf, setSelectedEtf] = usePluginPaneState<string | null>("selectedEtf", null);
  const [sortPreference, setSortPreference] = usePluginPaneState<SectorSortPreference>(
    "sortPreference",
    DEFAULT_SORT_PREFERENCE,
  );

  const fetchGenRef = useRef(0);

  const columns = useMemo(() => buildColumns(width), [width]);
  const rows = useMemo(
    () => normalizeRowsForCollection(rowsByCollection, activeCollection.id),
    [activeCollection.id, rowsByCollection],
  );
  const sortedRows = useMemo(() => sortRows(rows, sortPreference), [rows, sortPreference]);
  const lastRefreshMs = lastRefreshByCollection[activeCollection.id];
  const lastRefreshText = lastRefreshMs ? formatTime(new Date(lastRefreshMs)) : "loading";
  const tabs = useMemo(() => SECTOR_COLLECTIONS.map((collection) => ({
    label: collection.label,
    value: collection.id,
  })), []);
  const selectedIdx = selectedEtf
    ? sortedRows.findIndex((row) => row.etf === selectedEtf)
    : -1;
  const activeIdx = selectedIdx >= 0 ? selectedIdx : (sortedRows.length > 0 ? 0 : -1);

  const fetchAll = useCallback(() => {
    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    if (!dataProvider) {
      setRowsByCollection((prev) => updateRowsForCollection(prev, activeCollection.id, (rows) => (
        rows.map((row) => ({ ...row, loading: false }))
      )));
      return;
    }

    const sectorDefs = activeCollection.items;
    const collectionId = activeCollection.id;

    setRowsByCollection((prev) => updateRowsForCollection(prev, collectionId, (rows) => (
      rows.map((row) => ({ ...row, loading: true }))
    )));

    const loadQuotes = async (): Promise<Map<string, Quote | null>> => {
      const quotes = new Map<string, Quote | null>();
      if (dataProvider.getQuotesBatch) {
        const results = await dataProvider.getQuotesBatch(
          sectorDefs.map((sector) => ({ symbol: sector.etf, exchange: "" })),
        ).catch(() => []);
        for (const result of results) {
          quotes.set(result.target.symbol, result.quote ?? null);
        }
        return quotes;
      }

      await Promise.all(sectorDefs.map(async (sector) => {
        try {
          quotes.set(sector.etf, await dataProvider.getQuote(sector.etf, ""));
        } catch {
          quotes.set(sector.etf, null);
        }
      }));
      return quotes;
    };

    const fetches = loadQuotes().then((quotesByEtf) => Promise.allSettled(sectorDefs.map(async (sector) => {
      try {
        const historyResult = await dataProvider.getPriceHistory(sector.etf, "", "1Y")
          .then((value) => ({ status: "fulfilled" as const, value }))
          .catch(() => ({ status: "rejected" as const }));
        if (fetchGenRef.current !== gen) return;
        const quote = quotesByEtf.get(sector.etf) ?? null;
        const history = historyResult.status === "fulfilled" ? historyResult.value : [];
        const historyClose = latestHistoryClose(history);
        const price = quote?.price ?? historyClose;
        const return1M = computeTrailingReturn(history, ONE_MONTH_DAYS, price);
        const return1Y = computeTrailingReturn(history, ONE_YEAR_DAYS, price);
        setRowsByCollection((prev) => updateRowsForCollection(prev, collectionId, (rows) => (
          rows.map((row) =>
            row.etf === sector.etf
              ? {
                  ...row,
                  price,
                  changePercent: quote?.changePercent ?? null,
                  return1M,
                  return1Y,
                  currency: quote?.currency ?? "USD",
                  loading: false,
                }
              : row,
          )
        )));
      } catch {
        if (fetchGenRef.current !== gen) return;
        setRowsByCollection((prev) => updateRowsForCollection(prev, collectionId, (rows) => (
          rows.map((row) =>
            row.etf === sector.etf ? { ...row, loading: false } : row,
          )
        )));
      }
    })));

    fetches.then(() => {
      if (fetchGenRef.current === gen) {
        setLastRefreshByCollection((prev) => ({
          ...prev,
          [collectionId]: Date.now(),
        }));
      }
    });
  }, [activeCollection, dataProvider, setLastRefreshByCollection, setRowsByCollection]);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchAll]);

  useEffect(() => {
    if (activeCollectionId === activeCollection.id) return;
    setActiveCollectionId(activeCollection.id);
  }, [activeCollection.id, activeCollectionId, setActiveCollectionId]);

  useEffect(() => {
    if (selectedEtf && sortedRows.some((row) => row.etf === selectedEtf)) return;
    const firstRow = sortedRows[0];
    if (firstRow && selectedEtf !== firstRow.etf) {
      setSelectedEtf(firstRow.etf);
    }
  }, [selectedEtf, setSelectedEtf, sortedRows]);

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

  const handleTableKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name === "r") {
      event.preventDefault?.();
      fetchAll();
      return true;
    }
    return false;
  }, [fetchAll]);

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
      case "return1M":
        return {
          text: row.loading && row.return1M === null ? "…" : row.return1M !== null ? formatPercentRaw(row.return1M) : "—",
          color: selectedColor ?? (row.return1M !== null ? priceColor(row.return1M) : colors.textDim),
        };
      case "return1Y":
        return {
          text: row.loading && row.return1Y === null ? "…" : row.return1Y !== null ? formatPercentRaw(row.return1Y) : "—",
          color: selectedColor ?? (row.return1Y !== null ? priceColor(row.return1Y) : colors.textDim),
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

  usePaneFooter("sectors", () => ({
    info: [
      {
        id: "collection",
        parts: [{ text: activeCollection.label, tone: "label" }],
      },
      {
        id: "updated",
        parts: [{ text: lastRefreshText, tone: lastRefreshMs ? "value" : "muted" }],
      },
    ],
    hints: [{ id: "refresh", key: "r", label: "efresh", onPress: fetchAll }],
  }), [activeCollection.label, fetchAll, lastRefreshMs, lastRefreshText]);

  const rootBefore = (
    <Box height={1} paddingX={1}>
      <Tabs
        tabs={tabs}
        activeValue={activeCollection.id}
        onSelect={(value) => {
          const nextId = value as SectorCollectionId;
          setActiveCollectionId(nextId);
          setSelectedEtf(null);
        }}
        compact
        variant="bare"
        focused={focused}
      />
    </Box>
  );

  return (
    <DataTableView<SectorRow, SectorColumn>
      focused={focused}
      selectedIndex={activeIdx}
      onSelectIndex={selectIndex}
      onActivateIndex={(_index, row) => openRow(row)}
      onRootKeyDown={handleTableKeyDown}
      rootBefore={rootBefore}
      rootWidth={width}
      rootHeight={height}
      resetScrollKey={activeCollection.id}
      columns={columns}
      items={sortedRows}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={handleHeaderClick}
      getItemKey={(row) => row.etf}
      isSelected={(row) => row.etf === selectedEtf}
      onSelect={selectRow}
      renderCell={renderCell}
      emptyStateTitle="No sector data available"
      showHorizontalScrollbar={false}
    />
  );
}

export const sectorsPlugin: GloomPlugin = {
  id: "sectors",
  name: "Sector Performance",
  version: "1.0.0",
  description: "S&P 500 sector and industry performance via ETF proxies",
  toggleable: true,

  panes: [
    {
      id: "sectors",
      name: "Sector Performance",
      icon: "S",
      component: SectorPerformancePane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 82, height: 18 },
    },
  ],

  paneTemplates: [
    {
      id: "sectors-pane",
      paneId: "sectors",
      label: "Sector Performance",
      description: "S&P 500 sector and industry performance sorted by daily change.",
      keywords: ["sector", "sectors", "industry", "semis", "defense", "food", "leisure", "etf", "xlk", "xlv", "xlf", "performance", "spdr"],
      shortcut: { prefix: "BI" },
    },
  ],
};
