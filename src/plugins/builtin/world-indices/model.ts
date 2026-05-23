import type { MarketState, Quote } from "../../../types/financials";
import { REGION_ORDER, type IndexEntry } from "./indices";

export interface IndexQuoteState {
  quote: Quote | null;
  loading: boolean;
  error: string | null;
}

export type QuoteMap = Map<string, IndexQuoteState>;

export type WorldIndexTableRow =
  | { type: "header"; region: IndexEntry["region"] }
  | { type: "row"; entry: IndexEntry };

export type WorldIndexColumnId = "status" | "symbol" | "name" | "price" | "changePercent";
type SortDirection = "asc" | "desc";

export interface WorldIndexSortPreference {
  columnId: WorldIndexColumnId | null;
  direction: SortDirection;
}

export const DEFAULT_SORT_PREFERENCE: WorldIndexSortPreference = {
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

export function buildFlatRows(
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

export function rowIndicesOf(flatRows: WorldIndexTableRow[]): number[] {
  return flatRows.reduce<number[]>((acc, row, i) => {
    if (row.type === "row") acc.push(i);
    return acc;
  }, []);
}

export function nextSortPreference(
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

export function countLoadingQuotes(quotes: QuoteMap): number {
  return Array.from(quotes.values()).filter((state) => state.loading).length;
}

export function latestQuoteTimestamp(quotes: QuoteMap): number {
  return Math.max(
    0,
    ...Array.from(quotes.values()).map((state) => state.quote?.lastUpdated ?? 0),
  );
}
