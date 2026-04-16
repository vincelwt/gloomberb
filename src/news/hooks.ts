import { useEffect, useSyncExternalStore } from "react";
import { buildNewsQueryKey, type NewsService } from "./aggregator";
import type { NewsArticle, NewsQuery, NewsQueryState } from "./types";

let sharedService: NewsService | null = null;

export function setSharedNewsService(service: NewsService | null): void {
  sharedService = service;
}

export function getSharedNewsService(): NewsService | null {
  return sharedService;
}

export const setSharedNewsAggregator = setSharedNewsService;
export const getSharedNewsAggregator = getSharedNewsService;

function idleState(): NewsQueryState {
  return {
    phase: "idle",
    articles: [],
    error: null,
    updatedAt: null,
    sourceIds: [],
  };
}

function useNewsServiceVersion(): number {
  if (!sharedService) return 0;
  return useSyncExternalStore(
    (cb) => sharedService!.subscribe(cb),
    () => sharedService!.getVersion(),
  );
}

export function useNewsArticles(query: NewsQuery | null | undefined): NewsQueryState {
  const key = query ? buildNewsQueryKey(query) : null;
  useNewsServiceVersion();

  useEffect(() => {
    if (!query || !sharedService) return;
    void sharedService.load(query);
  }, [key]);

  return query && sharedService ? sharedService.getQueryState(query) : idleState();
}

export function useTopStories(count = 20): NewsArticle[] {
  return useNewsArticles({ feed: "top", limit: Math.max(count, 50) }).articles.slice(0, count);
}

export function useFirehose(count = 100): NewsArticle[] {
  return useNewsArticles({ feed: "latest", limit: count }).articles.slice(0, count);
}

export function useSectorNews(sector: string, count = 50): NewsArticle[] {
  return useNewsArticles({ feed: "sector", sectors: [sector], limit: Math.max(count, 100) }).articles.slice(0, count);
}

export function useBreakingNews(count = 20): NewsArticle[] {
  return useNewsArticles({ feed: "breaking", breaking: true, limit: Math.max(count, 50) }).articles.slice(0, count);
}
