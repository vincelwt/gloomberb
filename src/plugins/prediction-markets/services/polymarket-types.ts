export interface PolymarketEventRecord {
  id: string;
  title: string;
  slug?: string;
  description?: string;
  endDate?: string;
  startDate?: string;
  updatedAt?: string;
  resolutionSource?: string;
  openInterest?: number;
  volume24hr?: number;
  tags?: Array<{ label?: string; slug?: string }>;
  markets?: PolymarketMarketRecord[];
}

export interface PolymarketMarketRecord {
  id?: string;
  question: string;
  conditionId?: string;
  slug?: string;
  groupItemTitle?: string;
  description?: string;
  endDate?: string;
  updatedAt?: string;
  createdAt?: string;
  volume24hr?: number;
  volumeNum?: number;
  liquidityNum?: number;
  spread?: number;
  bestBid?: number | null;
  bestAsk?: number | null;
  lastTradePrice?: number | null;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
  clobTokenIds?: string | string[];
  events?: PolymarketEventRecord[];
  resolutionSource?: string;
  active?: boolean;
  closed?: boolean;
}

export interface PolymarketSearchResponse {
  events?: PolymarketEventRecord[] | null;
}

export interface PolymarketBookResponse {
  bids?: Array<{ price: string; size: string }>;
  asks?: Array<{ price: string; size: string }>;
  last_trade_price?: string;
}

export interface PolymarketTradesResponseItem {
  proxyWallet?: string;
  side?: string;
  asset?: string;
  conditionId?: string;
  size?: number;
  price?: number;
  timestamp?: number;
  outcome?: string;
  transactionHash?: string;
}

export interface PolymarketHistoryResponse {
  history?: Array<{ t: number; p: number }>;
}
