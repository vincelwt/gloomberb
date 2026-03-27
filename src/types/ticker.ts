import type { BrokerContractRef } from "./instrument";

export interface TickerPosition {
  portfolio: string;
  shares: number;
  avg_cost: number;
  currency?: string;
  date_acquired?: string;
  broker: string; // "manual" | future broker plugin IDs
  side?: "long" | "short";
  market_value?: number;
  unrealized_pnl?: number;
  /** Contract multiplier (e.g. 100 for options) */
  multiplier?: number;
  /** Last known mark price from broker snapshot */
  mark_price?: number;
  broker_instance_id?: string;
  broker_account_id?: string;
  broker_contract_id?: number;
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
  broker_contracts?: BrokerContractRef[];
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
  brokerId?: string;
  brokerInstanceId?: string;
  brokerAccountId?: string;
}

export interface Watchlist {
  id: string;
  name: string;
  description?: string;
}
