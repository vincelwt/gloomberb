import type { DataProvider } from "../types/data-provider";
import type { TickerRecord } from "../types/ticker";
import type { TickerRepository } from "../data/ticker-repository";
import { resolveTickerSearch, upsertTickerFromSearchResult } from "../utils/ticker-search";

export async function resolveTickerForCli(
  symbol: string,
  store: TickerRepository,
  dataProvider: DataProvider,
): Promise<TickerRecord> {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) {
    throw new Error("Ticker symbol is required.");
  }

  const localTicker = await store.loadTicker(normalized);
  if (localTicker) return localTicker;

  const localTickers = new Map(
    (await store.loadAllTickers()).map((ticker) => [ticker.metadata.ticker.toUpperCase(), ticker] as const),
  );
  const resolved = await resolveTickerSearch({
    query: normalized,
    activeTicker: null,
    tickers: localTickers,
    dataProvider,
  });

  if (!resolved) {
    throw new Error(`No ticker match found for "${normalized}".`);
  }

  if (resolved.kind === "local") {
    return resolved.ticker;
  }

  const { ticker } = await upsertTickerFromSearchResult(store, resolved.result);
  return ticker;
}
