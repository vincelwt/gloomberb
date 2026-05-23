import {
  fetchFearGreedData,
  type FearGreedData,
} from "./fear-greed-data";

const CACHE_TTL_MS = 5 * 60 * 1000;

let sharedCache: { data: FearGreedData; fetchedAt: number } | null = null;
let activeFetch: Promise<FearGreedData> | null = null;

export function getCachedFearGreedData(): { data: FearGreedData; fetchedAt: number } | null {
  return sharedCache;
}

export async function loadFearGreed(force = false): Promise<FearGreedData> {
  if (!force && sharedCache && Date.now() - sharedCache.fetchedAt < CACHE_TTL_MS) {
    return sharedCache.data;
  }
  if (activeFetch) return activeFetch;

  activeFetch = fetchFearGreedData()
    .then((data) => {
      sharedCache = { data, fetchedAt: Date.now() };
      return data;
    })
    .finally(() => {
      activeFetch = null;
    });
  return activeFetch;
}
