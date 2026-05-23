import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TextAttributes } from "../../../../ui";
import {
  DataTableView,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
} from "../../../../components";
import type { PaneProps, PaneTemplateDef } from "../../../../types/plugin";
import type { InstrumentSearchResult } from "../../../../types/instrument";
import { usePaneInstance } from "../../../../state/app-context";
import { colors } from "../../../../theme/colors";
import { useAssetData, usePluginPaneState, usePluginTickerActions } from "../../../plugin-runtime";
import type { LoadState } from "../../shared/ticker-request";

function resultSymbol(result: InstrumentSearchResult): string {
  return result.symbol.trim().toUpperCase();
}

function useSearchQuerySetting(): string {
  const pane = usePaneInstance();
  const raw = pane?.settings?.query;
  return typeof raw === "string" ? raw.trim() : "";
}

function buildSearchColumns(width: number): Array<DataTableColumn & { id: "symbol" | "name" | "exchange" | "type" }> {
  const symbolWidth = 12;
  const exchangeWidth = 14;
  const typeWidth = 10;
  const nameWidth = Math.max(18, width - 2 - symbolWidth - exchangeWidth - typeWidth - 4);
  return [
    { id: "symbol", label: "TICKER", width: symbolWidth, align: "left" },
    { id: "name", label: "NAME", width: nameWidth, align: "left" },
    { id: "exchange", label: "EXCHANGE", width: exchangeWidth, align: "left" },
    { id: "type", label: "TYPE", width: typeWidth, align: "left" },
  ];
}

export function ProviderSearchPane({ focused, width, height }: PaneProps) {
  const dataProvider = useAssetData();
  const query = useSearchQuerySetting();
  const { pinTicker } = usePluginTickerActions();
  const [selectedIdx, setSelectedIdx] = usePluginPaneState<number>("selectedIdx", 0);
  const [state, setState] = useState<LoadState<InstrumentSearchResult[]>>({
    data: null,
    loading: false,
    error: null,
  });
  const fetchGenRef = useRef(0);

  const load = useCallback((forceRefresh = false) => {
    if (!query) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    if (!dataProvider) {
      setState({ data: null, loading: false, error: "Search unavailable" });
      return;
    }
    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    dataProvider.search(query, forceRefresh ? { preferBroker: false } : undefined)
      .then((results) => {
        if (fetchGenRef.current !== gen) return;
        setState({ data: results, loading: false, error: null });
      })
      .catch((error) => {
        if (fetchGenRef.current !== gen) return;
        setState({ data: null, loading: false, error: error instanceof Error ? error.message : String(error) });
      });
  }, [dataProvider, query]);

  useEffect(() => {
    load(false);
  }, [load]);

  const rows = state.data ?? [];
  const columns = useMemo(() => buildSearchColumns(width), [width]);
  const boundedSelectedIdx = rows.length > 0 ? Math.min(selectedIdx, rows.length - 1) : -1;
  const openResult = useCallback((row: InstrumentSearchResult) => {
    pinTicker(resultSymbol(row), { floating: true, paneType: "ticker-detail" });
  }, [pinTicker]);

  useEffect(() => {
    if (rows.length > 0 && selectedIdx >= rows.length) setSelectedIdx(rows.length - 1);
  }, [rows.length, selectedIdx, setSelectedIdx]);

  const handleKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name !== "r") return false;
    event.preventDefault?.();
    load(true);
    return true;
  }, [load]);

  const renderCell = useCallback((
    row: InstrumentSearchResult,
    column: DataTableColumn & { id: "symbol" | "name" | "exchange" | "type" },
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "symbol":
        return { text: resultSymbol(row), color: selectedColor ?? colors.textBright, attributes: TextAttributes.BOLD };
      case "name":
        return { text: row.name || "-", color: selectedColor ?? colors.text };
      case "exchange":
        return { text: row.exchange || row.primaryExchange || "-", color: selectedColor ?? colors.textDim };
      case "type":
        return { text: row.type || "-", color: selectedColor ?? colors.textDim };
    }
  }, []);

  usePaneFooter("provider-search", () => ({
    info: [
      ...(query ? [{ id: "query", parts: [{ text: query, tone: "muted" as const }] }] : []),
      ...(state.loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(state.error ? [{ id: "error", parts: [{ text: state.error, tone: "warning" as const }] }] : []),
    ],
    hints: [{ id: "refresh", key: "r", label: "efresh", onPress: () => load(true) }],
  }), [load, query, state.error, state.loading]);

  return (
    <DataTableView<InstrumentSearchResult, DataTableColumn & { id: "symbol" | "name" | "exchange" | "type" }>
      focused={focused}
      selectedIndex={boundedSelectedIdx}
      onSelectIndex={(index) => setSelectedIdx(index)}
      onActivateIndex={(_index, row) => openResult(row)}
      onRootKeyDown={handleKeyDown}
      rootWidth={width}
      rootHeight={height}
      columns={columns}
      items={rows}
      sortColumnId={null}
      sortDirection="asc"
      onHeaderClick={() => {}}
      getItemKey={(row, index) => `${row.providerId}:${row.symbol}:${row.exchange}:${row.type}:${index}`}
      isSelected={(_row, index) => index === boundedSelectedIdx}
      onSelect={(_row, index) => setSelectedIdx(index)}
      renderCell={renderCell}
      emptyStateTitle={state.loading ? "Searching..." : query ? "No search results" : "No search query"}
    />
  );
}

export function createProviderSearchPaneTemplate(): PaneTemplateDef {
  return {
    id: "provider-search-pane",
    paneId: "provider-search-results",
    label: "Provider Search",
    description: "Search upstream provider instruments and open a selected ticker.",
    keywords: ["search", "srch", "provider", "symbol"],
    shortcut: { prefix: "SRCH", argPlaceholder: "query", argKind: "text" },
    wizard: [
      {
        key: "query",
        label: "Search Query",
        placeholder: "apple, sony, AAPL",
        type: "text",
      },
    ],
    canCreate: (_context, options) => !!(options?.arg ?? options?.values?.query)?.trim(),
    createInstance: (_context, options) => {
      const query = (options?.arg ?? options?.values?.query ?? "").trim();
      return query
        ? {
          title: `SRCH ${query}`,
          placement: "floating",
          settings: { query },
        }
        : null;
    },
  };
}
