import { createThrottledFetch, type ThrottledFetchTransport } from "../../../utils/throttled-fetch";

const YAHOO_FINANCE_HOSTS = [
  "query2.finance.yahoo.com",
  "query1.finance.yahoo.com",
] as const;

const YAHOO_FINANCE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://finance.yahoo.com/",
};

export interface YahooScreenerApi {
  fetchJson<T = unknown>(path: string, params: Record<string, string | number>): Promise<T>;
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
): Promise<ScreenerQuote[]> {
  const data = await api.fetchJson("/v1/finance/screener/predefined/saved", {
    formatted: "false",
    lang: "en-US",
    region: "US",
    scrIds: category,
    count,
  });
  return parseScreenerResponse(data);
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
): Promise<TrendingSymbol[]> {
  const data = await api.fetchJson("/v1/finance/trending/US", {
    count,
  });
  return parseTrendingResponse(data);
}

export const MARKET_SUMMARY_SYMBOLS = ["^GSPC", "^DJI", "^IXIC", "^RUT"] as const;
