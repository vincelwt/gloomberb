import { useEffect, useMemo } from "react";
import type { MarketNewsItem } from "../../../types/news-source";
import { usePluginPaneState } from "../../plugin-runtime";

const MAX_PERSISTED_ARTICLES = 200;
const EMPTY_PERSISTED_ARTICLES: PersistedNewsArticle[] = [];

interface PersistedNewsArticle extends Omit<MarketNewsItem, "publishedAt"> {
  publishedAt: string;
}

function articleDate(value: MarketNewsItem["publishedAt"]): Date | null {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function serializeArticle(article: MarketNewsItem): PersistedNewsArticle | null {
  const publishedAt = articleDate(article.publishedAt);
  if (!publishedAt) return null;
  return {
    ...article,
    publishedAt: publishedAt.toISOString(),
  };
}

function restoreArticle(article: PersistedNewsArticle): MarketNewsItem | null {
  const publishedAt = articleDate(article.publishedAt);
  if (!publishedAt) return null;
  return {
    ...article,
    publishedAt,
  };
}

function samePersistedArticles(left: PersistedNewsArticle[], right: PersistedNewsArticle[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((article, index) => {
    const other = right[index];
    return other?.id === article.id && other.publishedAt === article.publishedAt;
  });
}

export function usePersistedNewsArticles(key: string, articles: MarketNewsItem[]): MarketNewsItem[] {
  const [persistedArticles, setPersistedArticles] = usePluginPaneState<PersistedNewsArticle[]>(
    key,
    EMPTY_PERSISTED_ARTICLES,
  );
  const restoredArticles = useMemo(
    () => persistedArticles.map(restoreArticle).filter((article): article is MarketNewsItem => !!article),
    [persistedArticles],
  );

  useEffect(() => {
    if (articles.length === 0) return;
    const next = articles
      .slice(0, MAX_PERSISTED_ARTICLES)
      .map(serializeArticle)
      .filter((article): article is PersistedNewsArticle => !!article);
    setPersistedArticles((current) => samePersistedArticles(current, next) ? current : next);
  }, [articles, setPersistedArticles]);

  return articles.length > 0 ? articles : restoredArticles;
}
