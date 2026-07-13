import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataTableView } from "../../../components";
import type { GloomPlugin, PaneProps } from "../../../types/plugin";
import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import { useAssetData, usePluginTickerActions } from "../../runtime";
import { WORLD_INDICES, REGION_LABELS, getIndicesByRegion } from "./indices";
import { useWorldIndicesFooter } from "./footer";
import {
  buildFlatRows,
  DEFAULT_SORT_PREFERENCE,
  nextSortPreference,
  type IndexQuoteState,
  type QuoteMap,
  type WorldIndexSortPreference,
  type WorldIndexTableRow,
} from "./model";
import {
  createWorldIndexColumns,
  renderWorldIndexCell,
  type WorldIndexColumn,
} from "./table";

const REFRESH_INTERVAL_MS = 60_000;

function WorldIndicesPane({ focused, width, height }: PaneProps) {
  const dataProvider = useAssetData();
  const { pinTicker } = usePluginTickerActions();
  const [quotes, setQuotes] = useState<QuoteMap>(new Map());
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [sortPreference, setSortPreference] = useState<WorldIndexSortPreference>(DEFAULT_SORT_PREFERENCE);
  const fetchGenRef = useRef(0);

  const indicesByRegion = useMemo(() => getIndicesByRegion(), []);
  const flatRows = useMemo(
    () => buildFlatRows(indicesByRegion, sortPreference, quotes),
    [indicesByRegion, quotes, sortPreference],
  );
  const selectedFlatIdx = selectedSymbol
    ? flatRows.findIndex((row) => row.type === "row" && row.entry.symbol === selectedSymbol)
    : -1;
  useEffect(() => {
    if (selectedSymbol && selectedFlatIdx >= 0) return;
    const firstRow = flatRows.find((row) => row.type === "row");
    if (firstRow?.type === "row") {
      setSelectedSymbol(firstRow.entry.symbol);
    } else if (selectedSymbol !== null) {
      setSelectedSymbol(null);
    }
  }, [flatRows, selectedFlatIdx, selectedSymbol]);

  const fetchAll = useCallback(() => {
    if (!dataProvider) return;

    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;

    setQuotes((prev) => {
      const next = new Map(prev);
      for (const entry of WORLD_INDICES) {
        const existing = next.get(entry.symbol);
        next.set(entry.symbol, { quote: existing?.quote ?? null, loading: true, error: null });
      }
      return next;
    });

    const loadQuotes = async (): Promise<QuoteMap> => {
      const next = new Map<string, IndexQuoteState>();
      if (dataProvider.getQuotesBatch) {
        const results = await dataProvider.getQuotesBatch(
          WORLD_INDICES.map((entry) => ({ symbol: entry.symbol, exchange: "" })),
        );
        const bySymbol = new Map(results.map((result) => [result.target.symbol, result]));
        for (const entry of WORLD_INDICES) {
          const result = bySymbol.get(entry.symbol);
          next.set(entry.symbol, {
            quote: result?.quote ?? null,
            loading: false,
            error: result?.error
              ? result.error instanceof Error ? result.error.message : String(result.error)
              : null,
          });
        }
        return next;
      }

      await Promise.all(WORLD_INDICES.map(async (entry) => {
        try {
          const quote = await dataProvider.getQuote(entry.symbol, "");
          next.set(entry.symbol, { quote, loading: false, error: null });
        } catch (err: unknown) {
          next.set(entry.symbol, {
            quote: null,
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }));
      return next;
    };

    loadQuotes().then((nextQuotes) => {
      if (fetchGenRef.current !== gen) return;
      setQuotes((prev) => {
        const next = new Map(prev);
        for (const [symbol, state] of nextQuotes) {
          next.set(symbol, state);
        }
        return next;
      });
    }).catch((err: unknown) => {
      if (fetchGenRef.current !== gen) return;
      const message = err instanceof Error ? err.message : String(err);
      setQuotes((prev) => {
        const next = new Map(prev);
        for (const entry of WORLD_INDICES) {
          next.set(entry.symbol, { quote: null, loading: false, error: message });
        }
        return next;
      });
    });
  }, [dataProvider]);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const openSelected = useCallback((flatIdx: number) => {
    const row = flatRows[flatIdx];
    if (!row || row.type !== "row") return;
    pinTicker(row.entry.symbol, { floating: true, paneType: TICKER_RESEARCH_PANE_ID });
  }, [flatRows, pinTicker]);

  const selectFlatIndex = useCallback((flatIdx: number) => {
    const row = flatRows[flatIdx];
    if (!row || row.type !== "row") return;
    setSelectedSymbol(row.entry.symbol);
  }, [flatRows]);

  const handleHeaderClick = useCallback((columnId: string) => {
    setSortPreference((current) => nextSortPreference(current, columnId));
  }, []);

  const columns = useMemo<WorldIndexColumn[]>(() => createWorldIndexColumns(width), [width]);

  const renderCell = useCallback((
    row: WorldIndexTableRow,
    column: WorldIndexColumn,
    _index: number,
    rowState: { selected: boolean },
  ) => {
    return renderWorldIndexCell(row, column, rowState, quotes);
  }, [quotes]);

  useWorldIndicesFooter(quotes);

  return (
    <DataTableView<WorldIndexTableRow, WorldIndexColumn>
      focused={focused}
      selection={{
        kind: "id",
        selectedId: selectedSymbol,
        getId: (row) => row.type === "row" ? row.entry.symbol : `header-${row.region}`,
        onChange: (_id, row, index) => {
          if (row.type === "row") selectFlatIndex(index);
        },
      }}
      isNavigable={(row) => row.type === "row"}
      onActivate={(_row, index) => openSelected(index)}
      rootWidth={width}
      rootHeight={height}
      columns={columns}
      items={flatRows}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={handleHeaderClick}
      getItemKey={(row) => row.type === "header" ? `header-${row.region}` : row.entry.symbol}
      renderSectionHeader={(row) => row.type === "header"
        ? { text: REGION_LABELS[row.region] }
        : null}
      renderCell={renderCell}
      emptyStateTitle="No indices configured."
    />
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
