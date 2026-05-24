import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TextAttributes } from "../../../ui";
import {
  DataTableView,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
} from "../../../components";
import type { TickerFinancials } from "../../../types/financials";
import type { PaneProps } from "../../../types/plugin";
import { usePaneInstance } from "../../../state/app/context";
import { blendHex, colors, priceColor } from "../../../theme/colors";
import { formatCompact, formatCurrency, formatNumber, formatPercent, formatPercentRaw } from "../../../utils/format";
import { useAssetData, usePluginTickerActions } from "../../runtime";
import { handleRefreshKey, loadingErrorFooterInfo, refreshFooterHint, useClampSelectedIndex } from "../shared/table-pane";
import { useBoundTicker as useSymbolBinding } from "../shared/ticker-request";

type RelativeColumnId = "symbol" | "price" | "change" | "marketCap" | "pe" | "forwardPe" | "evSales" | "fcfYield" | "revenueGrowth" | "margin";
type RelativeColumn = DataTableColumn & { id: RelativeColumnId };
type RelativeRow = {
  symbol: string;
  financials: TickerFinancials | null;
  error?: string;
};

function relativeSymbolsFromPane(symbol: string | null, paneSettings: Record<string, unknown> | undefined): string[] {
  const settingsSymbols = Array.isArray(paneSettings?.symbols)
    ? paneSettings.symbols.filter((value): value is string => typeof value === "string")
    : [];
  if (settingsSymbols.length > 0) return settingsSymbols;
  return symbol ? [symbol] : [];
}

function buildRelativeColumns(width: number): RelativeColumn[] {
  const symbolWidth = 8;
  const priceWidth = 10;
  const pctWidth = 8;
  const capWidth = 9;
  const metricWidth = 8;
  return [
    { id: "symbol", label: "TICKER", width: symbolWidth, align: "left" },
    { id: "price", label: "LAST", width: priceWidth, align: "right" },
    { id: "change", label: "CHG%", width: pctWidth, align: "right" },
    { id: "marketCap", label: "MCAP", width: capWidth, align: "right" },
    { id: "pe", label: "P/E", width: metricWidth, align: "right" },
    { id: "forwardPe", label: "FWD", width: metricWidth, align: "right" },
    { id: "evSales", label: "EV/S", width: metricWidth, align: "right" },
    { id: "fcfYield", label: "FCF%", width: metricWidth, align: "right" },
    { id: "revenueGrowth", label: "REV%", width: metricWidth, align: "right" },
    { id: "margin", label: "OP%", width: Math.max(metricWidth, width - symbolWidth - priceWidth - pctWidth - capWidth - metricWidth * 5 - 10), align: "right" },
  ];
}

function evSales(financials: TickerFinancials | null): number | undefined {
  const ev = financials?.fundamentals?.enterpriseValue;
  const revenue = financials?.fundamentals?.revenue;
  return ev != null && revenue ? ev / revenue : undefined;
}

function fcfYield(financials: TickerFinancials | null): number | undefined {
  const fcf = financials?.fundamentals?.freeCashFlow;
  const marketCap = financials?.quote?.marketCap;
  return fcf != null && marketCap ? fcf / marketCap : undefined;
}

export function RelativeValuationPane({ focused, width, height }: PaneProps) {
  const pane = usePaneInstance();
  const { symbol } = useSymbolBinding();
  const symbols = useMemo(
    () => relativeSymbolsFromPane(symbol, pane?.settings),
    [pane?.settings, symbol],
  );
  const dataProvider = useAssetData();
  const { navigateTicker } = usePluginTickerActions();
  const [rows, setRows] = useState<RelativeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const columns = useMemo(() => buildRelativeColumns(width), [width]);
  const fetchGenRef = useRef(0);

  const reload = useCallback((forceRefresh = false) => {
    if (symbols.length === 0) {
      setRows([]);
      setError("No tickers selected");
      return;
    }
    if (!dataProvider) {
      setRows([]);
      setError("Market data unavailable");
      return;
    }
    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setLoading(true);
    setError(null);
    Promise.all(symbols.map(async (nextSymbol): Promise<RelativeRow> => {
      try {
        const financials = await dataProvider.getTickerFinancials(nextSymbol, "", forceRefresh ? { cacheMode: "refresh" } : undefined);
        return { symbol: nextSymbol, financials };
      } catch (err) {
        return { symbol: nextSymbol, financials: null, error: err instanceof Error ? err.message : String(err) };
      }
    }))
      .then((nextRows) => {
        if (fetchGenRef.current !== gen) return;
        setRows(nextRows);
      })
      .catch((err) => {
        if (fetchGenRef.current !== gen) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (fetchGenRef.current === gen) setLoading(false);
      });
  }, [dataProvider, symbols]);

  useEffect(() => {
    reload(false);
  }, [reload]);

  useClampSelectedIndex(rows.length, selectedIdx, setSelectedIdx);

  const renderCell = useCallback((row: RelativeRow, column: RelativeColumn, _index: number, rowState: { selected: boolean }): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    const quote = row.financials?.quote;
    const fundamentals = row.financials?.fundamentals;
    switch (column.id) {
      case "symbol":
        return { text: row.symbol, color: selectedColor ?? (row.error ? colors.warning : colors.textBright), attributes: TextAttributes.BOLD };
      case "price":
        return { text: quote?.price != null ? formatCurrency(quote.price, quote.currency) : "-", color: selectedColor ?? colors.text };
      case "change":
        return { text: quote?.changePercent != null ? formatPercentRaw(quote.changePercent) : "-", color: selectedColor ?? priceColor(quote?.changePercent ?? 0) };
      case "marketCap":
        return { text: formatCompact(quote?.marketCap), color: selectedColor ?? colors.textDim };
      case "pe":
        return { text: formatNumber(fundamentals?.trailingPE, 1), color: selectedColor ?? colors.text };
      case "forwardPe":
        return { text: formatNumber(fundamentals?.forwardPE, 1), color: selectedColor ?? colors.text };
      case "evSales":
        return { text: formatNumber(evSales(row.financials), 1), color: selectedColor ?? colors.text };
      case "fcfYield":
        return { text: formatPercent(fcfYield(row.financials)), color: selectedColor ?? priceColor(fcfYield(row.financials) ?? 0) };
      case "revenueGrowth":
        return { text: formatPercent(fundamentals?.revenueGrowth ?? fundamentals?.lastQuarterGrowth), color: selectedColor ?? priceColor(fundamentals?.revenueGrowth ?? fundamentals?.lastQuarterGrowth ?? 0) };
      case "margin":
        return { text: formatPercent(fundamentals?.operatingMargin), color: selectedColor ?? colors.text };
    }
  }, []);

  const handleKeyDown = useCallback((event: DataTableKeyEvent) => {
    return handleRefreshKey(event, () => reload(true), { stopPropagation: true });
  }, [reload]);

  usePaneFooter("relative-valuation", () => ({
    info: [
      { id: "tickers", parts: [{ text: `${symbols.length} tickers`, tone: symbols.length > 0 ? "value" as const : "muted" as const }] },
      ...loadingErrorFooterInfo(loading, error),
    ],
    hints: [refreshFooterHint(() => reload(true))],
  }), [error, loading, reload, symbols.length]);

  return (
    <DataTableView<RelativeRow, RelativeColumn>
      focused={focused}
      selectedIndex={rows.length > 0 ? selectedIdx : -1}
      onSelectIndex={(index) => setSelectedIdx(index)}
      onActivateIndex={(_index, row) => navigateTicker(row.symbol)}
      onRootKeyDown={handleKeyDown}
      rootWidth={width}
      rootHeight={height}
      columns={columns}
      items={rows}
      sortColumnId={null}
      sortDirection="asc"
      onHeaderClick={() => {}}
      getItemKey={(row) => row.symbol}
      isSelected={(row) => rows[selectedIdx]?.symbol === row.symbol}
      onSelect={(row, index) => {
        setSelectedIdx(index);
        navigateTicker(row.symbol);
      }}
      renderCell={renderCell}
      emptyStateTitle={loading ? "Loading peers..." : error ?? "No peers"}
    />
  );
}
