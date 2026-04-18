import { useEffect, useSyncExternalStore } from "react";
import { buildNewsQueryKey, type NewsService } from "./aggregator";
import type { NewsQuery, NewsQueryState } from "./types";

let sharedService: NewsService | null = null;

export function setSharedNewsService(service: NewsService | null): void {
  sharedService = service;
}

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
