import type { Quote, Fundamentals, TickerFinancials, PricePoint } from "./financials";
import type { TimeRange } from "../components/chart/chart-types";

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: Date;
  summary?: string;
}

export interface DataProvider {
  readonly id: string;
  readonly name: string;

  getTickerFinancials(ticker: string, exchange?: string): Promise<TickerFinancials>;
  getQuote(ticker: string, exchange?: string): Promise<Quote>;
  getExchangeRate(fromCurrency: string): Promise<number>;
  search(query: string): Promise<Array<{ symbol: string; name: string; exchange: string; type: string }>>;
  getNews(ticker: string, count?: number, exchange?: string): Promise<NewsItem[]>;
  /** Fetch article summary/description by URL (lazy-loaded on selection) */
  getArticleSummary(url: string): Promise<string | null>;
  getPriceHistory(ticker: string, exchange: string, range: TimeRange): Promise<PricePoint[]>;
}
