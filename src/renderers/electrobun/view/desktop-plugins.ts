import { uiBuiltinPlugins } from "../../../plugins/catalog-ui";
import { ibkrPlugin } from "../../../plugins/ibkr";
import type { NewsItem } from "../../../types/data-provider";
import type { NewsArticle, NewsQuery, NewsSource } from "../../../types/news-source";
import type { GloomPlugin } from "../../../types/plugin";

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

function createYahooNewsSource(fetchNews: (ticker: string, count?: number, exchange?: string) => Promise<NewsItem[]>): NewsSource {
  return {
    id: "yahoo",
    name: "Yahoo Finance",
    priority: 1000,
    supports(query: NewsQuery): boolean {
      const feed = query.feed ?? (query.scope === "ticker" ? "ticker" : "latest");
      return feed === "ticker" && !!query.ticker;
    },
    async fetchNews(query: NewsQuery): Promise<NewsArticle[]> {
      const feed = query.feed ?? (query.scope === "ticker" ? "ticker" : "latest");
      if (feed !== "ticker" || !query.ticker) return [];
      const ticker = query.ticker.trim().toUpperCase();
      const items = await fetchNews(ticker, query.limit ?? 50, query.exchange ?? "");
      return items.map((item) => mapYahooNewsItem(item, ticker));
    },
  };
}

export function createDesktopBuiltinPlugins(fetchYahooNews: (ticker: string, count?: number, exchange?: string) => Promise<NewsItem[]>): GloomPlugin[] {
  const yahooNewsPlugin: GloomPlugin = {
    id: "yahoo",
    name: "Yahoo Fallback",
    version: "1.0.0",
    description: "Registers Yahoo-backed ticker news through the Bun desktop backend.",
    setup(ctx) {
      ctx.registerNewsSource?.(createYahooNewsSource(fetchYahooNews));
    },
  };

  const insertionAnchors = [
    uiBuiltinPlugins.findIndex((plugin) => plugin.id === "broker-manager"),
    uiBuiltinPlugins.findIndex((plugin) => plugin.id === "layout-manager"),
  ].filter((index) => index >= 0);
  const insertIndex = insertionAnchors.length > 0
    ? Math.min(...insertionAnchors)
    : uiBuiltinPlugins.length;

  return [
    yahooNewsPlugin,
    ...uiBuiltinPlugins.slice(0, insertIndex),
    ibkrPlugin,
    ...uiBuiltinPlugins.slice(insertIndex),
  ];
}
