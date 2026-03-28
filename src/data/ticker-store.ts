import type { Database } from "bun:sqlite";
import { serializeJson } from "./sqlite-json";

export interface StoredTickerRecord {
  symbol: string;
  metadata: string;
}

export class TickerStore {
  constructor(private readonly db: Database) {}

  getAll(): StoredTickerRecord[] {
    return this.db
      .query<StoredTickerRecord, []>(
        "SELECT symbol, metadata FROM tickers ORDER BY symbol",
      )
      .all();
  }

  get(symbol: string): string | null {
    const row = this.db
      .query<{ metadata: string }, [string]>(
        "SELECT metadata FROM tickers WHERE symbol = ?",
      )
      .get(symbol);
    return row?.metadata ?? null;
  }

  save(symbol: string, metadata: unknown): void {
    this.db
      .query(
        `INSERT OR REPLACE INTO tickers (symbol, metadata, updated_at)
         VALUES (?, ?, ?)`,
      )
      .run(symbol, serializeJson(metadata), Date.now());
  }

  delete(symbol: string): void {
    this.db.query("DELETE FROM tickers WHERE symbol = ?").run(symbol);
  }

  count(): number {
    const row = this.db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM tickers").get();
    return row?.count ?? 0;
  }
}
