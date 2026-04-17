
export interface MarketNewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: Date;
  summary?: string;
  imageUrl?: string;
  categories: string[];
  tickers: string[];
  importance: number;
  isBreaking: boolean;
}

export interface NewsSource {
  readonly id: string;
  readonly name: string;
  getCachedMarketNews?(): MarketNewsItem[];
  fetchMarketNews(): Promise<MarketNewsItem[]>;
}
