import type { TimeRange } from "../components/chart/chart-types";
import type { DataProvider, MarketDataRequestContext, NewsItem, QuoteSubscriptionTarget, SearchRequestContext, SecFilingItem } from "../types/data-provider";
import type { OptionsChain, PricePoint, Quote, TickerFinancials } from "../types/financials";
import type { InstrumentSearchResult } from "../types/instrument";
import {
  apiClient,
  type CloudPricePointPayload,
  type CloudQuotePayload,
  type CloudTickerFinancialsPayload,
} from "../utils/api-client";
import { createProviderMiss } from "./provider-errors";

const providerId = "gloomberb-cloud" as const;
const CLOUD_PROVIDER_MISS_PATTERNS = [
  /data not found/i,
  /symbol.*missing or invalid/i,
  /figi.*missing or invalid/i,
  /error in the query/i,
];

function isCloudProviderMiss(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return CLOUD_PROVIDER_MISS_PATTERNS.some((pattern) => pattern.test(message));
}

async function withCloudFallback<T>(load: () => Promise<T>, message: string): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (isCloudProviderMiss(error)) {
      throw createProviderMiss(message);
    }
    throw error;
  }
}

function mapQuote(quote: CloudQuotePayload): Quote {
  return {
    ...quote,
    providerId,
  };
}

function mapPricePoint(point: CloudPricePointPayload): PricePoint {
  return {
    date: new Date(point.date),
    open: point.open,
    high: point.high,
    low: point.low,
    close: point.close,
    volume: point.volume,
  };
}

function mapFinancials(financials: CloudTickerFinancialsPayload): TickerFinancials {
  return {
    quote: financials.quote ? mapQuote(financials.quote) : undefined,
    fundamentals: financials.fundamentals,
    profile: financials.profile,
    annualStatements: financials.annualStatements ?? [],
    quarterlyStatements: financials.quarterlyStatements ?? [],
    priceHistory: (financials.priceHistory ?? []).map(mapPricePoint),
  };
}

function toCloudInterval(interval: string): string {
  switch (interval) {
    case "1m":
      return "1min";
    case "5m":
      return "5min";
    case "15m":
      return "15min";
    case "30m":
      return "30min";
    case "45m":
      return "45min";
    case "1d":
      return "1day";
    case "1w":
      return "1week";
    case "1mo":
      return "1month";
    default:
      return interval;
  }
}

function padTimePart(value: number): string {
  return String(value).padStart(2, "0");
}

function formatCloudDateTime(date: Date, includeTime: boolean): string {
  const year = date.getFullYear();
  const month = padTimePart(date.getMonth() + 1);
  const day = padTimePart(date.getDate());
  if (!includeTime) {
    return `${year}-${month}-${day}`;
  }
  const hours = padTimePart(date.getHours());
  const minutes = padTimePart(date.getMinutes());
  const seconds = padTimePart(date.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function toHistoryRequest(range: TimeRange): {
  interval: string;
  outputsize: number;
  rangeKey: TimeRange;
} {
  switch (range) {
    case "1W":
      return { interval: "1h", outputsize: 7 * 24, rangeKey: range };
    case "1M":
      return { interval: "1day", outputsize: 31, rangeKey: range };
    case "3M":
      return { interval: "1day", outputsize: 93, rangeKey: range };
    case "6M":
      return { interval: "1day", outputsize: 186, rangeKey: range };
    case "1Y":
      return { interval: "1day", outputsize: 366, rangeKey: range };
    case "5Y":
      return { interval: "1week", outputsize: 261, rangeKey: range };
    case "ALL":
      return { interval: "1month", outputsize: 240, rangeKey: range };
    default:
      return { interval: "1day", outputsize: 366, rangeKey: range };
  }
}

async function requireVerifiedSession(): Promise<void> {
  const user = await apiClient.ensureVerifiedSession();
  if (!user) {
    throw createProviderMiss("Gloomberb Cloud requires signup and email verification");
  }
}

export class GloomberbCloudProvider implements DataProvider {
  readonly id = providerId;
  readonly name = "Gloomberb Cloud";
  readonly priority = 100;

  async canProvide(): Promise<boolean> {
    return !!(await apiClient.ensureVerifiedSession());
  }

  async getTickerFinancials(ticker: string, exchange = "", _context?: MarketDataRequestContext): Promise<TickerFinancials> {
    await requireVerifiedSession();
    return withCloudFallback(
      async () => mapFinancials(await apiClient.getCloudFinancials(ticker, exchange)),
      `Cloud financials are unavailable for ${ticker}`,
    );
  }

  async getQuote(ticker: string, exchange = "", _context?: MarketDataRequestContext): Promise<Quote> {
    await requireVerifiedSession();
    return withCloudFallback(
      async () => mapQuote(await apiClient.getCloudQuote(ticker, exchange)),
      `Cloud quotes are unavailable for ${ticker}`,
    );
  }

  async getExchangeRate(fromCurrency: string): Promise<number> {
    await requireVerifiedSession();
    return apiClient.getCloudExchangeRate(fromCurrency);
  }

  async search(query: string, _context?: SearchRequestContext): Promise<InstrumentSearchResult[]> {
    await requireVerifiedSession();
    return withCloudFallback(
      () => apiClient.searchInstruments(query, 10),
      "Cloud search is unavailable",
    );
  }

  async getNews(_ticker: string, _count?: number, _exchange?: string, _context?: MarketDataRequestContext): Promise<NewsItem[]> {
    throw createProviderMiss("Cloud news is not available");
  }

  async getSecFilings(_ticker: string, _count?: number, _exchange?: string, _context?: MarketDataRequestContext): Promise<SecFilingItem[]> {
    throw createProviderMiss("Cloud SEC filings are not available");
  }

  async getSecFilingContent(_filing: SecFilingItem): Promise<string | null> {
    throw createProviderMiss("Cloud filing content is not available");
  }

  async getArticleSummary(_url: string): Promise<string | null> {
    throw createProviderMiss("Cloud article summaries are not available");
  }

  async getPriceHistory(ticker: string, exchange: string, range: TimeRange, _context?: MarketDataRequestContext): Promise<PricePoint[]> {
    await requireVerifiedSession();
    const request = toHistoryRequest(range);
    const points = await withCloudFallback(
      () => apiClient.getCloudHistory(ticker, exchange, request),
      `Cloud chart data is unavailable for ${ticker}`,
    );
    return points.map(mapPricePoint);
  }

  async getDetailedPriceHistory(
    ticker: string,
    exchange: string,
    startDate: Date,
    endDate: Date,
    barSize: string,
    _context?: MarketDataRequestContext,
  ): Promise<PricePoint[]> {
    await requireVerifiedSession();
    const interval = toCloudInterval(barSize);
    const includeTime = /(min|h)$/i.test(interval);
    const points = await withCloudFallback(
      () => apiClient.getCloudHistory(ticker, exchange, {
        interval,
        startDate: formatCloudDateTime(startDate, includeTime),
        endDate: formatCloudDateTime(endDate, includeTime),
      }),
      `Cloud detailed chart history is unavailable for ${ticker}`,
    );
    return points.map(mapPricePoint);
  }

  async getOptionsChain(_ticker: string, _exchange?: string, _expirationDate?: number, _context?: MarketDataRequestContext): Promise<OptionsChain> {
    throw createProviderMiss("Cloud options chains are not available");
  }

  subscribeQuotes(
    targets: QuoteSubscriptionTarget[],
    onQuote: (target: QuoteSubscriptionTarget, quote: Quote) => void,
  ): () => void {
    void apiClient.ensureVerifiedSession().catch(() => {});
    return apiClient.subscribeQuotes(
      targets.map((target) => ({
        symbol: target.symbol,
        exchange: target.exchange,
      })),
      (target, quote) => {
        onQuote(target, mapQuote(quote));
      },
    );
  }
}

export function createGloomberbCloudProvider(): DataProvider {
  return new GloomberbCloudProvider();
}
