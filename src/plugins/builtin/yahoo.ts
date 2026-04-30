import type { GloomPlugin } from "../../types/plugin";
import type { DataSource } from "../../types/data-source";
import type { NewsArticle, NewsQuery } from "../../types/news-source";
import type { NewsItem } from "../../types/data-provider";
import { YahooFinanceClient } from "../../sources/yahoo-finance";

class YahooPluginProvider extends YahooFinanceClient {
  readonly priority = 1000;
}

export function createYahooProvider() {
  return new YahooPluginProvider();
}

function yahooArticleId(item: NewsItem, ticker: string): string {
  return item.url || `${ticker}:${item.title}:${item.publishedAt.toISOString()}`;
}

function mapYahooNewsItem(item: NewsItem, ticker: string): NewsArticle {
  return {
    id: yahooArticleId(item, ticker),
    title: item.title,
    url: item.url,
    source: item.source || "Yahoo Finance",
    publishedAt: item.publishedAt,
    summary: item.summary,
    topic: "ticker",
    topics: ["ticker"],
    sectors: [],
    categories: [],
    tickers: [ticker],
    scores: {
      importance: 0,
      urgency: 0,
      marketImpact: 0,
      novelty: 0,
      confidence: 0,
    },
    importance: 0,
    isBreaking: false,
    isDeveloping: false,
  };
}

function createYahooSource(provider: YahooPluginProvider): DataSource {
  return {
    id: "yahoo",
    name: "Yahoo Finance",
    priority: 1000,
    market: provider,
    news: {
      supports(query: NewsQuery): boolean {
        const feed = query.feed ?? (query.scope === "ticker" ? "ticker" : "latest");
        return feed === "ticker" && !!query.ticker;
      },
      async fetchNews(query: NewsQuery): Promise<NewsArticle[]> {
        const feed = query.feed ?? (query.scope === "ticker" ? "ticker" : "latest");
        if (feed !== "ticker" || !query.ticker) return [];
        const ticker = query.ticker.trim().toUpperCase();
        const items = await provider.getNews(ticker, query.limit ?? 50, query.exchange ?? "");
        return items.map((item) => mapYahooNewsItem(item, ticker));
      },
    },
  };
}

const yahooProvider = createYahooProvider();
const yahooSource = createYahooSource(yahooProvider);

export const yahooPlugin: GloomPlugin = {
  id: "yahoo",
  name: "Yahoo Fallback",
  version: "1.0.0",
  description: "Built-in delayed fallback for quotes, fundamentals, charts, and unsupported cloud data.",
  dataSources: [yahooSource],
};
