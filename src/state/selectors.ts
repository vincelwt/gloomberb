import type { AppState } from "./app-context";
import { resolveCollectionForPane } from "./app-context";
import type { TickerRecord } from "../types/ticker";

/** Get tickers belonging to a specific portfolio */
export function getPortfolioTickers(state: AppState, portfolioId: string): TickerRecord[] {
  const result: TickerRecord[] = [];
  for (const ticker of state.tickers.values()) {
    if (ticker.metadata.portfolios.includes(portfolioId)) {
      result.push(ticker);
    }
  }
  return result.sort((a, b) => a.metadata.ticker.localeCompare(b.metadata.ticker));
}

/** Get tickers belonging to a specific watchlist */
export function getWatchlistTickers(state: AppState, watchlistId: string): TickerRecord[] {
  const result: TickerRecord[] = [];
  for (const ticker of state.tickers.values()) {
    if (ticker.metadata.watchlists.includes(watchlistId)) {
      result.push(ticker);
    }
  }
  return result.sort((a, b) => a.metadata.ticker.localeCompare(b.metadata.ticker));
}

export function getCollectionTickers(state: AppState, collectionId: string | null): TickerRecord[] {
  if (!collectionId) return [];
  if (state.config.portfolios.some((portfolio) => portfolio.id === collectionId)) {
    return getPortfolioTickers(state, collectionId);
  }
  if (state.config.watchlists.some((watchlist) => watchlist.id === collectionId)) {
    return getWatchlistTickers(state, collectionId);
  }
  return [];
}

export function getCollectionName(state: AppState, collectionId: string | null): string {
  if (!collectionId) return "";
  const portfolio = state.config.portfolios.find((entry) => entry.id === collectionId);
  if (portfolio) return portfolio.name;
  const watchlist = state.config.watchlists.find((entry) => entry.id === collectionId);
  if (watchlist) return watchlist.name;
  return collectionId;
}

export function getCollectionType(state: AppState, collectionId: string | null): "portfolio" | "watchlist" | null {
  if (!collectionId) return null;
  if (state.config.portfolios.some((portfolio) => portfolio.id === collectionId)) return "portfolio";
  if (state.config.watchlists.some((watchlist) => watchlist.id === collectionId)) return "watchlist";
  return null;
}

export function getPaneCollectionTickers(state: AppState, paneId: string): TickerRecord[] {
  return getCollectionTickers(state, resolveCollectionForPane(state, paneId));
}

export function getAllCollections(state: AppState): Array<{ id: string; name: string; type: "portfolio" | "watchlist" }> {
  const collections: Array<{ id: string; name: string; type: "portfolio" | "watchlist" }> = [];
  for (const portfolio of state.config.portfolios) {
    collections.push({ id: portfolio.id, name: portfolio.name, type: "portfolio" });
  }
  for (const watchlist of state.config.watchlists) {
    collections.push({ id: watchlist.id, name: watchlist.name, type: "watchlist" });
  }
  return collections;
}
