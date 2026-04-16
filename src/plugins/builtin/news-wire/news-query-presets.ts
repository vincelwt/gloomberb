import type { NewsQuery } from "../../../news/types";

export const SECTOR_NEWS_SECTORS = [
  "information_technology",
  "energy",
  "financials",
  "health_care",
  "industrials",
  "consumer_discretionary",
  "consumer_staples",
  "communication_services",
  "materials",
  "utilities",
] as const;

export type SectorNewsSelection = "all" | typeof SECTOR_NEWS_SECTORS[number];

export const NEWS_QUERY_PRESETS = {
  top: { feed: "top", limit: 50 } satisfies NewsQuery,
  feed: { feed: "latest", limit: 200 } satisfies NewsQuery,
  breaking: { feed: "breaking", breaking: true, limit: 50 } satisfies NewsQuery,
  sector(sector: string): NewsQuery {
    return { feed: "sector", sectors: [sector], limit: 100 };
  },
  ticker(ticker: string, exchange?: string): NewsQuery {
    return {
      feed: "ticker",
      ticker,
      exchange,
      tickerTier: "primary",
      limit: 50,
    };
  },
} as const;

export function sectorNewsLabel(value: SectorNewsSelection): string {
  if (value === "all") return "all";
  return value.replace(/_/g, " ");
}
