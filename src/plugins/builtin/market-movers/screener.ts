import { createThrottledFetch, type ThrottledFetchTransport } from "../../../utils/throttled-fetch";
import type { PluginPersistence } from "../../../types/plugin";

const YAHOO_FINANCE_HOSTS = [
  "query2.finance.yahoo.com",
  "query1.finance.yahoo.com",
] as const;
const CACHE_KIND = "yahoo-screener";
const CACHE_SOURCE = "yahoo-finance";
const CACHE_SCHEMA_VERSION = 1;
const CACHE_POLICY = {
  staleMs: 5 * 60 * 1000,
  expireMs: 60 * 60 * 1000,
} as const;

const YAHOO_FINANCE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://finance.yahoo.com/",
};

export interface YahooScreenerApi {
  fetchJson<T = unknown>(path: string, params: Record<string, string | number>): Promise<T>;
}

export interface FetchCacheOptions {
  cache?: boolean;
  forceRefresh?: boolean;
}

let marketMoversPersistence: PluginPersistence | null = null;
const activeFetches = new Map<string, Promise<unknown>>();

export function attachMarketMoversPersistence(persistence: PluginPersistence): void {
  marketMoversPersistence = persistence;
}

export function resetMarketMoversPersistence(): void {
  marketMoversPersistence = null;
  activeFetches.clear();
}

export function createYahooScreenerApi(transport?: ThrottledFetchTransport): YahooScreenerApi {
  const client = createThrottledFetch({
    requestsPerMinute: 15,
    maxRetries: 2,
    timeoutMs: 10_000,
    defaultHeaders: YAHOO_FINANCE_HEADERS,
    transport,
  });

  return {
    async fetchJson<T = unknown>(path: string, params: Record<string, string | number>): Promise<T> {
      let lastError: unknown;
      for (const host of YAHOO_FINANCE_HOSTS) {
        const url = new URL(`https://${host}${path}`);
        for (const [key, value] of Object.entries(params)) {
          url.searchParams.set(key, String(value));
        }

        try {
          return await client.fetchJson<T>(url.toString());
        } catch (error) {
          lastError = error;
        }
      }

      throw lastError instanceof Error
        ? lastError
        : new Error("Yahoo Finance screener request failed");
    },
  };
}

const screenerApi = createYahooScreenerApi();

function shouldUseCache(api: YahooScreenerApi, options?: FetchCacheOptions): boolean {
  return options?.cache === true || (options?.cache !== false && api === screenerApi);
}

function readCache<T>(key: string, options?: { allowExpired?: boolean }): { data: T; stale: boolean } | null {
  const record = marketMoversPersistence?.getResource<T>(CACHE_KIND, key, {
    sourceKey: CACHE_SOURCE,
    schemaVersion: CACHE_SCHEMA_VERSION,
    allowExpired: options?.allowExpired,
  });
  if (!record) return null;

  return {
    data: record.value,
    stale: !!record.stale,
  };
}

function writeCache<T>(key: string, data: T): void {
  marketMoversPersistence?.setResource(CACHE_KIND, key, data, {
    sourceKey: CACHE_SOURCE,
    schemaVersion: CACHE_SCHEMA_VERSION,
    cachePolicy: CACHE_POLICY,
  });
}

async function loadCached<T>(
  key: string,
  fetcher: () => Promise<T>,
  options?: FetchCacheOptions,
): Promise<T> {
  if (options?.cache === false) return fetcher();

  const cached = readCache<T>(key);
  if (!options?.forceRefresh && cached && !cached.stale) return cached.data;

  const activeFetch = activeFetches.get(key) as Promise<T> | undefined;
  if (activeFetch) return activeFetch;

  const fallback = cached ?? readCache<T>(key, { allowExpired: true });
  const fetchPromise = fetcher()
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

export type ScreenerCategory = "day_gainers" | "day_losers" | "most_actives";

export interface ScreenerQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  avgVolume: number;
  volumeRatio: number; // volume / avgVolume
  marketCap: number | undefined;
  currency: string;
  fiftyTwoWeekHigh: number | undefined;
  fiftyTwoWeekLow: number | undefined;
  dayHigh: number | undefined;
  dayLow: number | undefined;
  exchange: string;
}

export interface TrendingSymbol {
  symbol: string;
}

export interface MarketSummaryQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
}

export function parseScreenerResponse(data: any): ScreenerQuote[] {
  try {
    const quotes = data?.finance?.result?.[0]?.quotes;
    if (!Array.isArray(quotes)) return [];
    const result: ScreenerQuote[] = [];
    for (const q of quotes) {
      if (!q || typeof q.symbol !== "string") continue;
      const volume = q.regularMarketVolume ?? 0;
      const avgVolume = q.averageDailyVolume3Month ?? q.averageDailyVolume10Day ?? 0;
      result.push({
        symbol: q.symbol,
        name: q.shortName ?? q.longName ?? q.symbol,
        price: q.regularMarketPrice ?? 0,
        change: q.regularMarketChange ?? 0,
        changePercent: q.regularMarketChangePercent ?? 0,
        volume,
        avgVolume,
        volumeRatio: avgVolume > 0 ? volume / avgVolume : 0,
        marketCap: q.marketCap ?? undefined,
        currency: q.currency ?? "USD",
        fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? undefined,
        fiftyTwoWeekLow: q.fiftyTwoWeekLow ?? undefined,
        dayHigh: q.regularMarketDayHigh ?? undefined,
        dayLow: q.regularMarketDayLow ?? undefined,
        exchange: q.fullExchangeName ?? q.exchange ?? "",
      });
    }
    return result;
  } catch {
    return [];
  }
}

export async function fetchScreener(
  category: ScreenerCategory,
  count = 25,
  api: YahooScreenerApi = screenerApi,
  options?: FetchCacheOptions,
): Promise<ScreenerQuote[]> {
  const load = async () => {
    const data = await api.fetchJson("/v1/finance/screener/predefined/saved", {
      formatted: "false",
      lang: "en-US",
      region: "US",
      scrIds: category,
      count,
    });
    return parseScreenerResponse(data);
  };
  if (!shouldUseCache(api, options)) return load();
  return loadCached(`screener:${category}:count=${count}`, load, options);
}

export function parseTrendingResponse(data: any): TrendingSymbol[] {
  try {
    const quotes = data?.finance?.result?.[0]?.quotes;
    if (!Array.isArray(quotes)) return [];
    const result: TrendingSymbol[] = [];
    for (const q of quotes) {
      if (!q || typeof q.symbol !== "string") continue;
      result.push({ symbol: q.symbol });
    }
    return result;
  } catch {
    return [];
  }
}

export async function fetchTrending(
  count = 25,
  api: YahooScreenerApi = screenerApi,
  options?: FetchCacheOptions,
): Promise<TrendingSymbol[]> {
  const load = async () => {
    const data = await api.fetchJson("/v1/finance/trending/US", {
      count,
    });
    return parseTrendingResponse(data);
  };
  if (!shouldUseCache(api, options)) return load();
  return loadCached(`trending:US:count=${count}`, load, options);
}

export const MARKET_SUMMARY_SYMBOLS = ["^GSPC", "^DJI", "^IXIC", "^RUT"] as const;
