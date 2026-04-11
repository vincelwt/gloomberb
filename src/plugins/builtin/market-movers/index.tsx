import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { DataTable, type DataTableCell, type DataTableColumn } from "../../../components";
import type { GloomPlugin, PaneProps } from "../../../types/plugin";
import { colors, priceColor, blendHex } from "../../../theme/colors";
import { formatCurrency, formatCompact, formatPercentRaw } from "../../../utils/format";
import { usePluginTickerActions } from "../../plugin-runtime";
import { getSharedDataProvider } from "../../registry";
import {
  fetchScreener,
  fetchTrending,
  MARKET_SUMMARY_SYMBOLS,
  type ScreenerCategory,
  type ScreenerQuote,
  type MarketSummaryQuote,
} from "./screener";

const CACHE_TTL_MS = 5 * 60 * 1000;

type TabId = "gainers" | "losers" | "actives" | "trending";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "gainers", label: "Gainers" },
  { id: "losers", label: "Losers" },
  { id: "actives", label: "Most Active" },
  { id: "trending", label: "Trending" },
];

const CATEGORY_MAP: Record<Exclude<TabId, "trending">, ScreenerCategory> = {
  gainers: "day_gainers",
  losers: "day_losers",
  actives: "most_actives",
};

interface TabCache {
  data: ScreenerQuote[];
  fetchedAt: number;
}

type MarketMoverColumnId =
  | "rank"
  | "symbol"
  | "name"
  | "price"
  | "changePercent"
  | "volume"
  | "volumeRatio"
  | "range"
  | "marketCap";
type MarketMoverColumn = DataTableColumn & { id: MarketMoverColumnId };
type SortDirection = "asc" | "desc";
type MarketMoverRow = ScreenerQuote & { rank: number };

interface MarketMoverSortPreference {
  columnId: MarketMoverColumnId | null;
  direction: SortDirection;
}

const DEFAULT_SORT_PREFERENCE: MarketMoverSortPreference = {
  columnId: null,
  direction: "asc",
};

function formatVolRatio(ratio: number): string {
  if (ratio <= 0) return "—";
  if (ratio >= 10) return `${Math.round(ratio)}x`;
  return `${ratio.toFixed(1)}x`;
}

function volRatioColor(ratio: number): string {
  if (ratio >= 3) return colors.textBright;
  if (ratio >= 1.5) return colors.text;
  return colors.textDim;
}

function fiftyTwoWeekPositionPercent(price: number, low: number | undefined, high: number | undefined): number | null {
  if (low == null || high == null || high <= low) return null;
  return ((price - low) / (high - low)) * 100;
}

function fiftyTwoWeekPosition(price: number, low: number | undefined, high: number | undefined): string {
  const pct = fiftyTwoWeekPositionPercent(price, low, high);
  return pct == null ? "—" : `${Math.round(pct)}%`;
}

function getSortValue(
  columnId: MarketMoverColumnId,
  row: MarketMoverRow,
): string | number | null {
  switch (columnId) {
    case "rank":
      return row.rank;
    case "symbol":
      return row.symbol;
    case "name":
      return row.name;
    case "price":
      return row.price;
    case "changePercent":
      return row.changePercent;
    case "volume":
      return row.volume;
    case "volumeRatio":
      return row.volumeRatio;
    case "range":
      return fiftyTwoWeekPositionPercent(row.price, row.fiftyTwoWeekLow, row.fiftyTwoWeekHigh);
    case "marketCap":
      return row.marketCap ?? null;
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

function sortRows(
  rows: MarketMoverRow[],
  sortPreference: MarketMoverSortPreference,
): MarketMoverRow[] {
  const sortColumnId = sortPreference.columnId;
  if (!sortColumnId) return rows;
  return [...rows].sort((left, right) => compareSortValues(
    getSortValue(sortColumnId, left),
    getSortValue(sortColumnId, right),
    sortPreference.direction,
  ));
}

function nextSortPreference(
  current: MarketMoverSortPreference,
  columnId: string,
): MarketMoverSortPreference {
  const typedColumnId = columnId as MarketMoverColumnId;
  if (current.columnId !== typedColumnId) {
    return { columnId: typedColumnId, direction: "asc" };
  }
  if (current.direction === "asc") {
    return { columnId: typedColumnId, direction: "desc" };
  }
  return DEFAULT_SORT_PREFERENCE;
}

function createRows(quotes: ScreenerQuote[]): MarketMoverRow[] {
  return quotes.map((quote, index) => ({
    ...quote,
    rank: index + 1,
  }));
}

function buildColumns(width: number): MarketMoverColumn[] {
  const rankWidth = 3;
  const tickerWidth = 8;
  const priceWidth = 11;
  const chgWidth = 9;
  const volWidth = 8;
  const volRatioWidth = 6;
  const rangeWidth = 6;
  const mcapWidth = 8;
  const columnCount = 9;
  const fixedWidth = rankWidth + tickerWidth + priceWidth + chgWidth + volWidth + volRatioWidth + rangeWidth + mcapWidth;
  const nameWidth = Math.max(6, width - 2 - columnCount - fixedWidth);

  return [
    { id: "rank", label: "#", width: rankWidth, align: "left" },
    { id: "symbol", label: "TICKER", width: tickerWidth, align: "left" },
    { id: "name", label: "NAME", width: nameWidth, align: "left" },
    { id: "price", label: "LAST", width: priceWidth, align: "right" },
    { id: "changePercent", label: "CHG%", width: chgWidth, align: "right" },
    { id: "volume", label: "VOL", width: volWidth, align: "right" },
    { id: "volumeRatio", label: "V/AVG", width: volRatioWidth, align: "right" },
    { id: "range", label: "52W%", width: rangeWidth, align: "right" },
    { id: "marketCap", label: "MCAP", width: mcapWidth, align: "right" },
  ];
}

const INDEX_SHORT: Record<string, string> = {
  "^GSPC": "SPX",
  "^DJI": "DJIA",
  "^IXIC": "COMP",
  "^RUT": "RUT",
};

export function MarketMoversPane({ focused, width, height }: PaneProps) {
  const { pinTicker } = usePluginTickerActions();
  const [activeTab, setActiveTab] = useState<TabId>("gainers");
  const [quotes, setQuotes] = useState<ScreenerQuote[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [sortPreference, setSortPreference] = useState<MarketMoverSortPreference>(DEFAULT_SORT_PREFERENCE);
  const [summaryQuotes, setSummaryQuotes] = useState<MarketSummaryQuote[]>([]);

  const cacheRef = useRef<Map<TabId, TabCache>>(new Map());
  const fetchGenRef = useRef(0);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const headerScrollRef = useRef<ScrollBoxRenderable>(null);

  const columns = useMemo(() => buildColumns(width), [width]);
  const rankedRows = useMemo(() => createRows(quotes), [quotes]);
  const rows = useMemo(() => sortRows(rankedRows, sortPreference), [rankedRows, sortPreference]);
  const selectedIdx = selectedSymbol
    ? rows.findIndex((row) => row.symbol === selectedSymbol)
    : -1;
  const activeIdx = selectedIdx >= 0 ? selectedIdx : (rows.length > 0 ? 0 : -1);

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

  const resetTableScroll = useCallback(() => {
    const bodyScrollBox = scrollRef.current;
    if (bodyScrollBox) {
      bodyScrollBox.scrollTop = 0;
      bodyScrollBox.scrollLeft = 0;
    }
    const headerScrollBox = headerScrollRef.current;
    if (headerScrollBox) {
      headerScrollBox.scrollLeft = 0;
    }
  }, []);

  useEffect(() => {
    if (selectedSymbol && selectedIdx >= 0) return;
    const firstRow = rows[0];
    if (firstRow) {
      setSelectedSymbol(firstRow.symbol);
    } else if (selectedSymbol !== null) {
      setSelectedSymbol(null);
    }
  }, [rows, selectedIdx, selectedSymbol]);

  // Fetch market summary via the provider router
  useEffect(() => {
    const provider = getSharedDataProvider();
    if (!provider) return;
    const loadSummary = async () => {
      const results: MarketSummaryQuote[] = [];
      await Promise.allSettled(
        MARKET_SUMMARY_SYMBOLS.map(async (symbol) => {
          try {
            const q = await provider.getQuote(symbol, "");
            if (q) {
              results.push({
                symbol,
                name: q.name ?? symbol,
                price: q.price,
                change: q.change,
                changePercent: q.changePercent,
              });
            }
          } catch { /* skip */ }
        }),
      );
      // Preserve the original symbol order
      setSummaryQuotes(
        MARKET_SUMMARY_SYMBOLS
          .map((s) => results.find((r) => r.symbol === s))
          .filter((r): r is MarketSummaryQuote => r !== undefined),
      );
    };
    loadSummary();
    const interval = setInterval(loadSummary, 60_000);
    return () => clearInterval(interval);
  }, []);

  const loadTab = async (tab: TabId) => {
    const cached = cacheRef.current.get(tab);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      setQuotes(cached.data);
      setSelectedSymbol(null);
      resetTableScroll();
      return;
    }

    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setLoading(true);

    try {
      let data: ScreenerQuote[];

      if (tab === "trending") {
        const trending = await fetchTrending(25);
        if (fetchGenRef.current !== gen) return;

        const provider = getSharedDataProvider();
        const resolved: ScreenerQuote[] = [];

        if (provider) {
          await Promise.allSettled(
            trending.slice(0, 25).map(async ({ symbol }) => {
              try {
                const q = await provider.getQuote(symbol, "");
                if (fetchGenRef.current !== gen) return;
                if (q) {
                  resolved.push({
                    symbol,
                    name: q.name ?? symbol,
                    price: q.price ?? 0,
                    change: q.change ?? 0,
                    changePercent: q.changePercent ?? 0,
                    volume: q.volume ?? 0,
                    avgVolume: 0,
                    volumeRatio: 0,
                    marketCap: undefined,
                    currency: q.currency ?? "USD",
                    fiftyTwoWeekHigh: undefined,
                    fiftyTwoWeekLow: undefined,
                    dayHigh: undefined,
                    dayLow: undefined,
                    exchange: "",
                  });
                }
              } catch { /* skip */ }
            }),
          );
        }

        if (fetchGenRef.current !== gen) return;
        data = trending
          .map((t) => resolved.find((r) => r.symbol === t.symbol))
          .filter((r): r is ScreenerQuote => r !== undefined);
      } else {
        data = await fetchScreener(CATEGORY_MAP[tab], 25);
        if (fetchGenRef.current !== gen) return;
      }

      cacheRef.current.set(tab, { data, fetchedAt: Date.now() });
      setQuotes(data);
      setSelectedSymbol(null);
      resetTableScroll();
    } catch { /* leave existing data */ }
    finally {
      if (fetchGenRef.current === gen) setLoading(false);
    }
  };

  useEffect(() => { loadTab(activeTab); }, [activeTab]);

  const openSymbol = useCallback((symbol: string) => {
    pinTicker(symbol, { floating: true, paneType: "ticker-detail" });
  }, [pinTicker]);

  const openSelected = useCallback((idx: number) => {
    const row = rows[idx];
    if (!row) return;
    openSymbol(row.symbol);
  }, [openSymbol, rows]);

  const handleHeaderClick = useCallback((columnId: string) => {
    setSortPreference((current) => nextSortPreference(current, columnId));
  }, []);

  useKeyboard((event) => {
    if (!focused) return;

    const key = event.name;
    const isEnter = key === "enter" || key === "return";

    if (key === "tab" || key === "right" || key === "l") {
      event.preventDefault?.();
      const currentTabIdx = TABS.findIndex((t) => t.id === activeTab);
      setActiveTab(TABS[(currentTabIdx + 1) % TABS.length]!.id);
      setSelectedSymbol(null);
      resetTableScroll();
    } else if (key === "left" || key === "h") {
      event.preventDefault?.();
      const currentTabIdx = TABS.findIndex((t) => t.id === activeTab);
      setActiveTab(TABS[(currentTabIdx - 1 + TABS.length) % TABS.length]!.id);
      setSelectedSymbol(null);
      resetTableScroll();
    } else if (key === "j" || key === "down") {
      event.preventDefault?.();
      if (rows.length === 0) return;
      const nextIdx = activeIdx >= 0 ? Math.min(activeIdx + 1, rows.length - 1) : 0;
      setSelectedSymbol(rows[nextIdx]!.symbol);
    } else if (key === "k" || key === "up") {
      event.preventDefault?.();
      if (rows.length === 0) return;
      const nextIdx = activeIdx > 0 ? activeIdx - 1 : 0;
      setSelectedSymbol(rows[nextIdx]!.symbol);
    } else if (isEnter) {
      event.preventDefault?.();
      openSelected(activeIdx);
    } else if (key === "r") {
      event.preventDefault?.();
      cacheRef.current.delete(activeTab);
      loadTab(activeTab);
    }
  });

  // Scroll to keep selected row visible
  useEffect(() => {
    const sb = scrollRef.current;
    if (!sb?.viewport || rows.length === 0 || activeIdx < 0) return;
    const viewportHeight = Math.max(sb.viewport.height, 1);
    if (activeIdx < sb.scrollTop) {
      sb.scrollTo(activeIdx);
    } else if (activeIdx >= sb.scrollTop + viewportHeight) {
      sb.scrollTo(activeIdx - viewportHeight + 1);
    }
  }, [activeIdx, rows.length]);

  const renderCell = useCallback((
    row: MarketMoverRow,
    column: MarketMoverColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;

    switch (column.id) {
      case "rank":
        return { text: String(row.rank), color: selectedColor ?? colors.textDim };
      case "symbol":
        return {
          text: row.symbol,
          color: selectedColor ?? colors.textBright,
          attributes: TextAttributes.BOLD,
        };
      case "name":
        return { text: row.name, color: selectedColor };
      case "price":
        return { text: formatCurrency(row.price, row.currency), color: selectedColor };
      case "changePercent":
        return {
          text: formatPercentRaw(row.changePercent),
          color: selectedColor ?? priceColor(row.changePercent),
        };
      case "volume":
        return { text: formatCompact(row.volume), color: selectedColor ?? colors.textDim };
      case "volumeRatio":
        return {
          text: formatVolRatio(row.volumeRatio),
          color: selectedColor ?? volRatioColor(row.volumeRatio),
        };
      case "range":
        return {
          text: fiftyTwoWeekPosition(row.price, row.fiftyTwoWeekLow, row.fiftyTwoWeekHigh),
          color: selectedColor ?? colors.textDim,
        };
      case "marketCap":
        return {
          text: row.marketCap != null ? formatCompact(row.marketCap) : "—",
          color: selectedColor ?? colors.textDim,
        };
    }
  }, []);

  const summaryBg = blendHex(colors.bg, colors.border, 0.2);

  return (
    <box flexDirection="column" width={width} height={height}>
      {/* Market Summary Bar */}
      {summaryQuotes.length > 0 ? (
        <box flexDirection="row" height={1} backgroundColor={summaryBg} paddingX={1} gap={2}>
          {summaryQuotes.map((idx) => {
            const short = INDEX_SHORT[idx.symbol] ?? idx.symbol;
            const chgColor = priceColor(idx.changePercent);
            return (
              <box key={idx.symbol} flexDirection="row" gap={1}>
                <text fg={colors.textBright} attributes={TextAttributes.BOLD}>{short}</text>
                <text fg={colors.text}>{formatCurrency(idx.price, "USD")}</text>
                <text fg={chgColor}>{formatPercentRaw(idx.changePercent)}</text>
              </box>
            );
          })}
          {loading && <text fg={colors.textMuted}> loading…</text>}
        </box>
      ) : null}

      {/* Tab bar */}
      <box flexDirection="row" height={1} paddingX={1}>
        {TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <box
              key={tab.id}
              paddingX={1}
              marginRight={1}
              onMouseDown={(event: any) => {
                event.preventDefault?.();
                setActiveTab(tab.id);
                setSelectedSymbol(null);
                resetTableScroll();
              }}
            >
              <text
                fg={isActive ? colors.textBright : colors.textDim}
                attributes={isActive ? TextAttributes.BOLD | TextAttributes.UNDERLINE : TextAttributes.NONE}
              >
                {tab.label}
              </text>
            </box>
          );
        })}
        <box flexGrow={1} />
        <text fg={colors.textMuted}>{quotes.length} stocks</text>
      </box>

      <DataTable<MarketMoverRow, MarketMoverColumn>
        columns={columns}
        items={rows}
        sortColumnId={sortPreference.columnId}
        sortDirection={sortPreference.direction}
        onHeaderClick={handleHeaderClick}
        headerScrollRef={headerScrollRef}
        scrollRef={scrollRef}
        syncHeaderScroll={syncHeaderScroll}
        onBodyScrollActivity={handleBodyScrollActivity}
        hoveredIdx={hoveredIdx}
        setHoveredIdx={setHoveredIdx}
        getItemKey={(row) => `${row.symbol}-${row.rank}`}
        isSelected={(row) => row.symbol === selectedSymbol}
        onSelect={(row) => setSelectedSymbol(row.symbol)}
        onActivate={(row) => openSymbol(row.symbol)}
        renderCell={renderCell}
        emptyStateTitle={loading ? "Loading movers..." : "No data"}
      />
    </box>
  );
}

export const marketMoversPlugin: GloomPlugin = {
  id: "market-movers",
  name: "Market Movers",
  version: "1.0.0",
  description: "Top gainers, losers, most active, and trending tickers",
  toggleable: true,

  panes: [
    {
      id: "market-movers",
      name: "Market Movers",
      icon: "T",
      component: MarketMoversPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 36 },
    },
  ],

  paneTemplates: [
    {
      id: "market-movers-pane",
      paneId: "market-movers",
      label: "Market Movers",
      description: "Top gainers, losers, most active, and trending tickers.",
      keywords: ["movers", "gainers", "losers", "active", "trending", "screener", "top"],
      shortcut: { prefix: "TOP" },
    },
  ],
};
