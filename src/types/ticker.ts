import type { BrokerContractRef } from "./instrument";

export interface TickerPosition {
  portfolio: string;
  shares: number;
  avgCost: number;
  currency?: string;
  dateAcquired?: string;
  broker: string; // "manual" | future broker plugin IDs
  side?: "long" | "short";
  marketValue?: number;
  unrealizedPnl?: number;
  /** Contract multiplier (e.g. 100 for options) */
  multiplier?: number;
  /** Last known mark price from broker snapshot */
  markPrice?: number;
  brokerInstanceId?: string;
  brokerAccountId?: string;
  brokerContractId?: number;
}

export interface TickerMetadata {
  ticker: string;
  exchange: string;
  currency: string;
  name: string;
  sector?: string;
  industry?: string;
  assetCategory?: string; // STK, ETF, OPT, FUT, BOND, etc.
  isin?: string;
  cusip?: string;
  portfolios: string[];
  watchlists: string[];
  positions: TickerPosition[];
  broker_contracts?: BrokerContractRef[];
  custom: Record<string, unknown>;
  tags: string[];
}

export interface TickerRecord {
  metadata: TickerMetadata;
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
