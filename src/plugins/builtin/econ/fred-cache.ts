import type {
  CloudFredObservationPayload,
  CloudFredSeriesInfoPayload,
} from "../../../api-client";
import type { PluginPersistence } from "../../../types/plugin";

const CACHE_KIND = "fred-series";
const CACHE_SOURCE = "gloomberb-cloud";
const CACHE_SCHEMA_VERSION = 1;
const CACHE_POLICY = {
  staleMs: 24 * 60 * 60 * 1000,
  expireMs: 30 * 24 * 60 * 60 * 1000,
} as const;

export interface FredSeriesCacheData {
  observations: CloudFredObservationPayload[];
  info: CloudFredSeriesInfoPayload | null;
}

export interface FredSeriesRequest {
  seriesId: string;
  startDate: string;
  sortOrder: "asc" | "desc";
}

export interface FredSeriesCacheEntry {
  data: FredSeriesCacheData;
  fetchedAt: number;
  stale: boolean;
}

let econFredPersistence: PluginPersistence | null = null;
const activeFetches = new Map<string, Promise<FredSeriesCacheData>>();

export function attachEconFredPersistence(persistence: PluginPersistence): void {
  econFredPersistence = persistence;
}

export function resetEconFredPersistence(): void {
  econFredPersistence = null;
  activeFetches.clear();
}

function cacheKey(request: FredSeriesRequest): string {
  return `${request.seriesId.trim().toUpperCase()}:start=${request.startDate}:sort=${request.sortOrder}`;
}

export function getCachedFredSeries(
  request: FredSeriesRequest,
  options?: { allowExpired?: boolean },
): FredSeriesCacheEntry | null {
  const key = cacheKey(request);
  const record = econFredPersistence?.getResource<FredSeriesCacheData>(CACHE_KIND, key, {
    sourceKey: CACHE_SOURCE,
    schemaVersion: CACHE_SCHEMA_VERSION,
    allowExpired: options?.allowExpired,
  });
  if (!record) return null;

  return {
    data: record.value,
    fetchedAt: record.fetchedAt,
    stale: !!record.stale,
  };
}

function writeCache(key: string, data: FredSeriesCacheData): void {
  econFredPersistence?.setResource(CACHE_KIND, key, data, {
    sourceKey: CACHE_SOURCE,
    schemaVersion: CACHE_SCHEMA_VERSION,
    cachePolicy: CACHE_POLICY,
  });
}

export async function loadCachedFredSeries(
  request: FredSeriesRequest,
  loader: () => Promise<FredSeriesCacheData>,
  options?: { force?: boolean },
): Promise<FredSeriesCacheData> {
  const key = cacheKey(request);
  const force = options?.force ?? false;
  const cached = getCachedFredSeries(request);
  if (!force && cached && !cached.stale) return cached.data;

  const activeFetch = activeFetches.get(key);
  if (activeFetch) return activeFetch;

  const fallback = cached ?? getCachedFredSeries(request, { allowExpired: true });
  const fetchPromise = loader()
    .then((data) => {
      writeCache(key, data);
      return data;
    })
    .catch((error) => {
      if (fallback) return fallback.data;
      throw error;
    })
    .finally(() => {
      if (activeFetches.get(key) === fetchPromise) {
        activeFetches.delete(key);
      }
    });

  activeFetches.set(key, fetchPromise);
  return fetchPromise;
}
