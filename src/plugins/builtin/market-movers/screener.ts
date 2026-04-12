import { createThrottledFetch } from "../../../utils/throttled-fetch";

const screenerClient = createThrottledFetch({
  requestsPerMinute: 15,
  maxRetries: 2,
  timeoutMs: 10_000,
  defaultHeaders: {
    "User-Agent": "Gloomberb/0.4.1",
    Accept: "application/json",
  },
});

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

export async function fetchScreener(category: ScreenerCategory, count = 25): Promise<ScreenerQuote[]> {
  const url = `https://query2.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${category}&count=${count}`;
  const data = await screenerClient.fetchJson(url);
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

export async function fetchTrending(count = 25): Promise<TrendingSymbol[]> {
  const url = `https://query2.finance.yahoo.com/v1/finance/trending/US?count=${count}`;
  const data = await screenerClient.fetchJson(url);
  return parseTrendingResponse(data);
}

export const MARKET_SUMMARY_SYMBOLS = ["^GSPC", "^DJI", "^IXIC", "^RUT"] as const;
