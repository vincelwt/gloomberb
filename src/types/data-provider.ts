import type { Quote, Fundamentals, TickerFinancials, PricePoint, OptionsChain } from "./financials";
import type { TimeRange } from "../components/chart/chart-types";
import type { BrokerContractRef, InstrumentSearchResult } from "./instrument";

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: Date;
  summary?: string;
}

export interface MarketDataRequestContext {
  brokerId?: string;
  brokerInstanceId?: string;
  instrument?: BrokerContractRef | null;
}

export interface SearchRequestContext {
  preferBroker?: boolean;
  brokerId?: string;
  brokerInstanceId?: string;
}

export interface DataProvider {
  readonly id: string;
  readonly name: string;
  readonly priority?: number;

  canProvide?(ticker: string, exchange?: string, context?: MarketDataRequestContext): Promise<boolean> | boolean;
  getTickerFinancials(ticker: string, exchange?: string, context?: MarketDataRequestContext): Promise<TickerFinancials>;
  getQuote(ticker: string, exchange?: string, context?: MarketDataRequestContext): Promise<Quote>;
  getExchangeRate(fromCurrency: string): Promise<number>;
  search(query: string, context?: SearchRequestContext): Promise<InstrumentSearchResult[]>;
  getNews(ticker: string, count?: number, exchange?: string, context?: MarketDataRequestContext): Promise<NewsItem[]>;
  /** Fetch article summary/description by URL (lazy-loaded on selection) */
  getArticleSummary(url: string): Promise<string | null>;
  getPriceHistory(ticker: string, exchange: string, range: TimeRange, context?: MarketDataRequestContext): Promise<PricePoint[]>;
  getOptionsChain?(ticker: string, exchange?: string, expirationDate?: number, context?: MarketDataRequestContext): Promise<OptionsChain>;
}
