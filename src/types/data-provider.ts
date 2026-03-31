import type { Quote, Fundamentals, TickerFinancials, PricePoint, OptionsChain } from "./financials";
import type { TimeRange } from "../components/chart/chart-types";
import type { BrokerContractRef, InstrumentSearchResult } from "./instrument";
import type { CachePolicyMap } from "./persistence";

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: Date;
  summary?: string;
}

export interface SecFilingItem {
  accessionNumber: string;
  form: string;
  filingDate: Date;
  acceptedAt?: Date;
  primaryDocument?: string;
  primaryDocDescription?: string;
  items?: string;
  cik: string;
  companyName?: string;
  filingUrl: string;
  primaryDocumentUrl?: string;
}

export interface MarketDataRequestContext {
  brokerId?: string;
  brokerInstanceId?: string;
  instrument?: BrokerContractRef | null;
  cacheMode?: "default" | "refresh";
}

export interface CachedFinancialsTarget {
  symbol: string;
  exchange?: string;
  brokerId?: string;
  brokerInstanceId?: string;
  instrument?: BrokerContractRef | null;
}

export interface SearchRequestContext {
  preferBroker?: boolean;
  brokerId?: string;
  brokerInstanceId?: string;
}

export interface QuoteSubscriptionTarget {
  symbol: string;
  exchange?: string;
  context?: MarketDataRequestContext;
  route?: "auto" | "provider" | "broker";
}

export interface DataProvider {
  readonly id: string;
  readonly name: string;
  readonly priority?: number;
  readonly cachePolicy?: CachePolicyMap;

  canProvide?(ticker: string, exchange?: string, context?: MarketDataRequestContext): Promise<boolean> | boolean;
  getCachedFinancialsForTargets?(targets: CachedFinancialsTarget[], options?: { allowExpired?: boolean }): Map<string, TickerFinancials>;
  getTickerFinancials(ticker: string, exchange?: string, context?: MarketDataRequestContext): Promise<TickerFinancials>;
  getQuote(ticker: string, exchange?: string, context?: MarketDataRequestContext): Promise<Quote>;
  getExchangeRate(fromCurrency: string): Promise<number>;
  search(query: string, context?: SearchRequestContext): Promise<InstrumentSearchResult[]>;
  getNews(ticker: string, count?: number, exchange?: string, context?: MarketDataRequestContext): Promise<NewsItem[]>;
  getSecFilings?(ticker: string, count?: number, exchange?: string, context?: MarketDataRequestContext): Promise<SecFilingItem[]>;
  getSecFilingContent?(filing: SecFilingItem): Promise<string | null>;
  /** Fetch article summary/description by URL (lazy-loaded on selection) */
  getArticleSummary(url: string): Promise<string | null>;
  getPriceHistory(ticker: string, exchange: string, range: TimeRange, context?: MarketDataRequestContext): Promise<PricePoint[]>;
  /** Fetch higher-resolution price data for a specific date window (e.g. when zoomed in). */
  getDetailedPriceHistory?(ticker: string, exchange: string, startDate: Date, endDate: Date, barSize: string, context?: MarketDataRequestContext): Promise<PricePoint[]>;
  getOptionsChain?(ticker: string, exchange?: string, expirationDate?: number, context?: MarketDataRequestContext): Promise<OptionsChain>;
  subscribeQuotes?(
    targets: QuoteSubscriptionTarget[],
    onQuote: (target: QuoteSubscriptionTarget, quote: Quote) => void,
  ): () => void;
}
