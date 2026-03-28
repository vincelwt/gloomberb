import type { TickerRecord, TickerMetadata } from "../types/ticker";
import type { TickerStore } from "./ticker-store";
import { hydrateTickerMetadata } from "../utils/ticker-metadata";

function parseTickerMetadata(json: string): TickerMetadata {
  return hydrateTickerMetadata(JSON.parse(json) as Record<string, unknown>);
}

export class TickerRepository {
  constructor(private readonly tickers: TickerStore) {}

  async loadAllTickers(): Promise<TickerRecord[]> {
    return this.tickers.getAll().flatMap((row) => {
      try {
        return [{ metadata: parseTickerMetadata(row.metadata) }];
      } catch {
        return [];
      }
    });
  }

  async loadTicker(symbol: string): Promise<TickerRecord | null> {
    const json = this.tickers.get(symbol);
    if (!json) return null;
    try {
      return { metadata: parseTickerMetadata(json) };
    } catch {
      return null;
    }
  }

  async saveTicker(ticker: TickerRecord): Promise<void> {
    this.tickers.save(ticker.metadata.ticker, ticker.metadata);
  }

  async createTicker(metadata: TickerMetadata): Promise<TickerRecord> {
    const ticker: TickerRecord = { metadata };
    await this.saveTicker(ticker);
    return ticker;
  }

  async deleteTicker(symbol: string): Promise<void> {
    this.tickers.delete(symbol);
  }
}
