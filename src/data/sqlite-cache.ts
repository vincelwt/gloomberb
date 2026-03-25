import { Database } from "bun:sqlite";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS yahoo_cache (
    symbol TEXT NOT NULL,
    data_type TEXT NOT NULL,
    data TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (symbol, data_type)
  );

  CREATE TABLE IF NOT EXISTS price_history (
    symbol TEXT NOT NULL,
    date TEXT NOT NULL,
    open REAL,
    high REAL,
    low REAL,
    close REAL,
    volume INTEGER,
    PRIMARY KEY (symbol, date)
  );

  CREATE TABLE IF NOT EXISTS exchange_rates (
    pair TEXT PRIMARY KEY,
    rate REAL NOT NULL,
    fetched_at INTEGER NOT NULL
  );
`;

export class SqliteCache {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec(SCHEMA);
  }

  // --- Yahoo Cache ---

  getCached<T>(symbol: string, dataType: string): T | null {
    const row = this.db
      .query<{ data: string; expires_at: number }, [string, string]>(
        "SELECT data, expires_at FROM yahoo_cache WHERE symbol = ? AND data_type = ?",
      )
      .get(symbol, dataType);

    if (!row || row.expires_at < Date.now()) return null;
    return JSON.parse(row.data) as T;
  }

  setCache(symbol: string, dataType: string, data: unknown, ttlMs: number): void {
    const now = Date.now();
    this.db
      .query(
        `INSERT OR REPLACE INTO yahoo_cache (symbol, data_type, data, fetched_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(symbol, dataType, JSON.stringify(data), now, now + ttlMs);
  }

  // --- Price History ---

  getPriceHistory(symbol: string): Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }> {
    return this.db
      .query<any, [string]>(
        "SELECT date, open, high, low, close, volume FROM price_history WHERE symbol = ? ORDER BY date",
      )
      .all(symbol);
  }

  setPriceHistory(symbol: string, history: Array<{ date: string; open?: number; high?: number; low?: number; close: number; volume?: number }>): void {
    const insert = this.db.query(
      `INSERT OR REPLACE INTO price_history (symbol, date, open, high, low, close, volume)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    const tx = this.db.transaction(() => {
      for (const p of history) {
        insert.run(symbol, p.date, p.open ?? null, p.high ?? null, p.low ?? null, p.close, p.volume ?? null);
      }
    });
    tx();
  }

  // --- Exchange Rates ---

  getExchangeRate(pair: string): number | null {
    const row = this.db
      .query<{ rate: number; fetched_at: number }, [string]>(
        "SELECT rate, fetched_at FROM exchange_rates WHERE pair = ?",
      )
      .get(pair);

    // 1 hour TTL
    if (!row || Date.now() - row.fetched_at > 3600_000) return null;
    return row.rate;
  }

  setExchangeRate(pair: string, rate: number): void {
    this.db
      .query(
        `INSERT OR REPLACE INTO exchange_rates (pair, rate, fetched_at) VALUES (?, ?, ?)`,
      )
      .run(pair, rate, Date.now());
  }

  /** Clear cached entries by data type (e.g. "full" to force re-fetch of financials) */
  clearByType(dataType: string): void {
    this.db.query("DELETE FROM yahoo_cache WHERE data_type = ?").run(dataType);
  }

  close(): void {
    this.db.close();
  }
}
