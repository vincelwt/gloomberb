import { useCallback, useEffect, useMemo, useRef } from "react";
import { Box } from "../../../ui";
import { DataTableView, Tabs, usePaneFooter, type DataTableCell, type DataTableKeyEvent } from "../../../components";
import type { GloomPlugin, PaneProps } from "../../../types/plugin";
import type { Quote } from "../../../types/financials";
import { colors, priceColor } from "../../../theme/colors";
import { formatCurrency, formatPercentRaw } from "../../../utils/format";
import { useAssetData, useDebouncedPluginPaneState, usePluginPaneState, usePluginTickerActions } from "../../plugin-runtime";
import {
  SECTOR_COLLECTIONS,
  getSectorCollection,
  type SectorCollectionId,
} from "./sector-data";
import {
  DEFAULT_COLLECTION_ID,
  DEFAULT_SORT_PREFERENCE,
  INITIAL_REFRESH_BY_COLLECTION,
  INITIAL_ROWS_BY_COLLECTION,
  ONE_MONTH_DAYS,
  ONE_YEAR_DAYS,
  REFRESH_INTERVAL_MS,
  buildBar,
  buildSectorColumns,
  computeTrailingReturn,
  formatTime,
  latestHistoryClose,
  nextSortPreference,
  normalizeRowsForCollection,
  sortRows,
  updateRowsForCollection,
  type SectorColumn,
  type SectorRefreshByCollection,
  type SectorRow,
  type SectorRowsByCollection,
  type SectorSortPreference,
} from "./sector-model";

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

  const columns = useMemo(() => buildSectorColumns(width), [width]);
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
