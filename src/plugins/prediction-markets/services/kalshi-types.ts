export interface KalshiMarketRecord {
  ticker: string;
  title: string;
  yes_sub_title?: string;
  no_sub_title?: string;
  event_ticker?: string;
  close_time?: string;
  open_time?: string;
  created_time?: string;
  updated_time?: string;
  status?: string;
  market_type?: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  no_bid_dollars?: string;
  no_ask_dollars?: string;
  last_price_dollars?: string;
  volume_24h_fp?: string;
  volume_fp?: string;
  open_interest_fp?: string;
  liquidity_dollars?: string;
  rules_primary?: string;
  rules_secondary?: string;
  strike_type?: string;
  floor_strike?: number | string;
  cap_strike?: number | string;
  custom_strike?: unknown;
  is_provisional?: boolean;
}

export interface KalshiEventRecord {
  title: string;
  category?: string;
  event_ticker?: string;
  series_ticker?: string;
  sub_title?: string;
  markets?: KalshiMarketRecord[];
}

export interface KalshiEventsResponse {
  events: KalshiEventRecord[];
  cursor?: string;
}

export interface KalshiEventResponse {
  event: {
    title: string;
    sub_title?: string;
    category?: string;
    event_ticker?: string;
    series_ticker?: string;
  };
  markets: KalshiMarketRecord[];
}

interface KalshiTradeRecord {
  trade_id: string;
  ticker: string;
  taker_side: "yes" | "no";
  yes_price_dollars: string;
  no_price_dollars: string;
  count_fp: string;
  created_time: string;
}

export interface KalshiTradesResponse {
  trades: KalshiTradeRecord[];
}

export interface KalshiOrderbookResponse {
  orderbook_fp?: {
    yes_dollars?: Array<[string, string]>;
    no_dollars?: Array<[string, string]>;
  };
}

export interface KalshiCandlestickResponse {
  candlesticks?: Array<{
    end_period_ts: number;
    volume_fp?: string;
    price?: {
      open_dollars?: string;
      high_dollars?: string;
      low_dollars?: string;
      close_dollars?: string;
      previous_dollars?: string;
    };
  }>;
}
