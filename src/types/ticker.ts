export interface TickerPosition {
  portfolio: string;
  shares: number;
  avg_cost: number;
  currency?: string;
  date_acquired?: string;
  broker: string; // "ibkr-flex" | "manual" | future broker plugin IDs
  side?: "long" | "short";
  market_value?: number;
  unrealized_pnl?: number;
  /** Contract multiplier (e.g. 100 for options) */
  multiplier?: number;
  /** Last known mark price from broker snapshot */
  mark_price?: number;
}

export interface TickerFrontmatter {
  ticker: string;
  exchange: string;
  currency: string;
  name: string;
  sector?: string;
  industry?: string;
  asset_category?: string; // STK, ETF, OPT, FUT, BOND, etc.
  isin?: string;
  cusip?: string;
  portfolios: string[];
  watchlists: string[];
  positions: TickerPosition[];
  custom: Record<string, unknown>;
  tags: string[];
}

export interface TickerFile {
  frontmatter: TickerFrontmatter;
  notes: string; // markdown body
  filePath: string;
}

export interface Portfolio {
  id: string;
  name: string;
  description?: string;
  currency: string;
}

export interface Watchlist {
  id: string;
  name: string;
  description?: string;
}
