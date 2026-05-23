import type { DataTableColumn } from "../../../components";
import type { MarketSummaryQuote, ScreenerCategory, ScreenerQuote } from "./screener";

export const CACHE_TTL_MS = 5 * 60 * 1000;

export type TabId = "gainers" | "losers" | "actives" | "trending";

export const TABS: Array<{ id: TabId; label: string }> = [
  { id: "gainers", label: "Gainers" },
  { id: "losers", label: "Losers" },
  { id: "actives", label: "Most Active" },
  { id: "trending", label: "Trending" },
];

export const CATEGORY_MAP: Record<Exclude<TabId, "trending">, ScreenerCategory> = {
  gainers: "day_gainers",
  losers: "day_losers",
  actives: "most_actives",
};

export interface TabCache {
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
export type MarketMoverColumn = DataTableColumn & { id: MarketMoverColumnId };
type SortDirection = "asc" | "desc";
export type MarketMoverRow = ScreenerQuote & { rank: number };

export interface MarketMoverSortPreference {
  columnId: MarketMoverColumnId | null;
  direction: SortDirection;
}

export const DEFAULT_SORT_PREFERENCE: MarketMoverSortPreference = {
  columnId: null,
  direction: "asc",
};

export const INDEX_SHORT: Record<string, string> = {
  "^GSPC": "SPX",
  "^DJI": "DJIA",
  "^IXIC": "COMP",
  "^RUT": "RUT",
};

export function fiftyTwoWeekPositionPercent(price: number, low: number | undefined, high: number | undefined): number | null {
  if (low == null || high == null || high <= low) return null;
  return ((price - low) / (high - low)) * 100;
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

export function sortRows(
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

export function nextSortPreference(
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

export function createRows(quotes: ScreenerQuote[]): MarketMoverRow[] {
  return quotes.map((quote, index) => ({
    ...quote,
    rank: index + 1,
  }));
}

export function summaryQuoteFromQuote(
  symbol: string,
  quote: { name?: string; price: number; change: number; changePercent: number },
): MarketSummaryQuote {
  return {
    symbol,
    name: quote.name ?? symbol,
    price: quote.price,
    change: quote.change,
    changePercent: quote.changePercent,
  };
}

export function screenerQuoteFromQuote(symbol: string, quote: { name?: string; price?: number; change?: number; changePercent?: number; volume?: number; currency?: string }): ScreenerQuote {
  return {
    symbol,
    name: quote.name ?? symbol,
    price: quote.price ?? 0,
    change: quote.change ?? 0,
    changePercent: quote.changePercent ?? 0,
    volume: quote.volume ?? 0,
    avgVolume: 0,
    volumeRatio: 0,
    marketCap: undefined,
    currency: quote.currency ?? "USD",
    fiftyTwoWeekHigh: undefined,
    fiftyTwoWeekLow: undefined,
    dayHigh: undefined,
    dayLow: undefined,
    exchange: "",
  };
}
