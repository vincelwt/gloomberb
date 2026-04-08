import type { TimeRange } from "../components/chart/chart-types";
import {
  normalizeChartResolutionSupport,
  type ChartResolutionSupport,
  type ManualChartResolution,
} from "../components/chart/chart-resolution";
import type { DataProvider, MarketDataRequestContext, NewsItem, QuoteSubscriptionTarget, SearchRequestContext, SecFilingItem } from "../types/data-provider";
import type { OptionsChain, PricePoint, Quote, TickerFinancials } from "../types/financials";
import type { InstrumentSearchResult } from "../types/instrument";
import {
  apiClient,
  type CloudCompanyProfile,
  type CloudFundamentals,
  type CloudMarketResponse,
  type CloudPricePointPayload,
  type CloudQuotePayload,
} from "../utils/api-client";
import { normalizePriceValueByDivisor, resolveCurrencyUnit } from "../utils/currency-units";
import { createProviderMiss } from "./provider-errors";

const providerId = "gloomberb-cloud" as const;
const CLOUD_RESOLUTION_SUPPORT = normalizeChartResolutionSupport([
  { resolution: "1m", maxRange: "1W" },
  { resolution: "5m", maxRange: "1M" },
  { resolution: "15m", maxRange: "3M" },
  { resolution: "30m", maxRange: "6M" },
  { resolution: "45m", maxRange: "6M" },
  { resolution: "1h", maxRange: "1Y" },
  { resolution: "1d", maxRange: "ALL" },
  { resolution: "1wk", maxRange: "ALL" },
  { resolution: "1mo", maxRange: "ALL" },
]);
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
  const { currency, divisor } = resolveCurrencyUnit(quote.currency);
  const listingExchangeName = quote.listingExchangeName ?? quote.exchangeName;
  const listingExchangeFullName = quote.listingExchangeFullName ?? quote.fullExchangeName ?? listingExchangeName;
  return {
    ...quote,
    currency: currency || quote.currency,
    price: normalizePriceValueByDivisor(quote.price, divisor) ?? quote.price,
    change: normalizePriceValueByDivisor(quote.change, divisor) ?? quote.change,
    previousClose: normalizePriceValueByDivisor(quote.previousClose, divisor),
    high52w: normalizePriceValueByDivisor(quote.high52w, divisor),
    low52w: normalizePriceValueByDivisor(quote.low52w, divisor),
    bid: normalizePriceValueByDivisor(quote.bid, divisor),
    ask: normalizePriceValueByDivisor(quote.ask, divisor),
    open: normalizePriceValueByDivisor(quote.open, divisor),
    high: normalizePriceValueByDivisor(quote.high, divisor),
    low: normalizePriceValueByDivisor(quote.low, divisor),
    mark: normalizePriceValueByDivisor(quote.mark, divisor),
    preMarketPrice: normalizePriceValueByDivisor(quote.preMarketPrice, divisor),
    preMarketChange: normalizePriceValueByDivisor(quote.preMarketChange, divisor),
    postMarketPrice: normalizePriceValueByDivisor(quote.postMarketPrice, divisor),
    postMarketChange: normalizePriceValueByDivisor(quote.postMarketChange, divisor),
    listingExchangeName,
    listingExchangeFullName,
    exchangeName: listingExchangeName,
    fullExchangeName: listingExchangeFullName,
    providerId,
  };
}

function mapPricePoint(point: CloudPricePointPayload, divisor = 1): PricePoint {
  return {
    date: new Date(point.date),
    open: normalizePriceValueByDivisor(point.open, divisor),
    high: normalizePriceValueByDivisor(point.high, divisor),
    low: normalizePriceValueByDivisor(point.low, divisor),
    close: normalizePriceValueByDivisor(point.close, divisor) ?? point.close,
    volume: point.volume,
  };
}

function quoteTargetKey(symbol: string, exchange?: string): string {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const normalizedExchange = (exchange ?? "").trim().toUpperCase();
  return normalizedExchange ? `${normalizedSymbol}:${normalizedExchange}` : normalizedSymbol;
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
    case "1wk":
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

function getRangeStartDate(range: TimeRange, endDate = new Date()): Date {
  const startDate = new Date(endDate);
  switch (range) {
    case "1D":
      startDate.setDate(startDate.getDate() - 1);
      break;
    case "1W":
      startDate.setDate(startDate.getDate() - 7);
      break;
    case "1M":
      startDate.setMonth(startDate.getMonth() - 1);
      break;
    case "3M":
      startDate.setMonth(startDate.getMonth() - 3);
      break;
    case "6M":
      startDate.setMonth(startDate.getMonth() - 6);
      break;
    case "1Y":
      startDate.setFullYear(startDate.getFullYear() - 1);
      break;
    case "5Y":
      startDate.setFullYear(startDate.getFullYear() - 5);
      break;
    case "ALL":
      startDate.setFullYear(startDate.getFullYear() - 20);
      break;
  }
  return startDate;
}

function toHistoryRequest(range: TimeRange): {
  interval: string;
  outputsize: number;
  rangeKey: TimeRange;
} {
  switch (range) {
    case "1D":
      return { interval: "5min", outputsize: 24 * 12, rangeKey: range };
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

function isEmptyCloudStatus(status: CloudMarketResponse<unknown>["status"]): boolean {
  return status === "empty" || status === "unsupported";
}

function unwrapRequiredCloudResponse<T>(response: CloudMarketResponse<T>, message: string): T {
  if ((response.status === "success" || response.status === "partial") && response.data != null) {
    return response.data;
  }
  if (isEmptyCloudStatus(response.status)) {
    throw createProviderMiss(response.reasonCode ?? message);
  }
  throw new Error(response.reasonCode ?? message);
}

function unwrapOptionalCloudResponse<T>(response: CloudMarketResponse<T>): T | null {
  if ((response.status === "success" || response.status === "partial") && response.data != null) {
    return response.data;
  }
  if (isEmptyCloudStatus(response.status)) {
    return null;
  }
  throw new Error(response.reasonCode ?? "Cloud data request failed");
}

export class GloomberbCloudProvider implements DataProvider {
  readonly id = providerId;
  readonly name = "Gloomberb Cloud";
  readonly priority = 100;

  getChartResolutionSupport(): ChartResolutionSupport[] {
    return CLOUD_RESOLUTION_SUPPORT;
  }

  getChartResolutionCapabilities(): ManualChartResolution[] {
    return CLOUD_RESOLUTION_SUPPORT.map((entry) => entry.resolution);
  }

  async canProvide(): Promise<boolean> {
    return !!(await apiClient.ensureVerifiedSession());
  }

  async getTickerFinancials(ticker: string, exchange = "", _context?: MarketDataRequestContext): Promise<TickerFinancials> {
    await requireVerifiedSession();
    return withCloudFallback(async () => {
      const [quoteResponse, profileResponse, fundamentalsResponse, statementsResponse] = await Promise.all([
        apiClient.getCloudQuote(ticker, exchange),
        apiClient.getCloudProfile(ticker, exchange),
        apiClient.getCloudFundamentals(ticker, exchange),
        apiClient.getCloudStatements(ticker, exchange, "both"),
      ]);
      const quote = mapQuote(unwrapRequiredCloudResponse(quoteResponse, `Cloud quote is unavailable for ${ticker}`));
      const profile = unwrapOptionalCloudResponse(profileResponse) as CloudCompanyProfile | null;
      const fundamentals = unwrapOptionalCloudResponse(fundamentalsResponse) as CloudFundamentals | null;
      const statements = unwrapOptionalCloudResponse(statementsResponse);
      return {
        quote,
        profile: profile ?? undefined,
        fundamentals: fundamentals ?? undefined,
        annualStatements: statements?.annualStatements ?? [],
        quarterlyStatements: statements?.quarterlyStatements ?? [],
        priceHistory: [],
      };
    }, `Cloud financials are unavailable for ${ticker}`);
  }

  async getQuote(ticker: string, exchange = "", _context?: MarketDataRequestContext): Promise<Quote> {
    await requireVerifiedSession();
    return withCloudFallback(
      async () => mapQuote(unwrapRequiredCloudResponse(
        await apiClient.getCloudQuote(ticker, exchange),
        `Cloud quotes are unavailable for ${ticker}`,
      )),
      `Cloud quotes are unavailable for ${ticker}`,
    );
  }

  async getExchangeRate(fromCurrency: string): Promise<number> {
    await requireVerifiedSession();
    const response = await apiClient.getCloudExchangeRate(fromCurrency);
    return unwrapRequiredCloudResponse(response, `Cloud exchange rate is unavailable for ${fromCurrency}`).rate;
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
    const response = await withCloudFallback(
      () => apiClient.getCloudHistory(ticker, exchange, request),
      `Cloud chart data is unavailable for ${ticker}`,
    );
    const { divisor } = resolveCurrencyUnit(response.providerMeta?.currency);
    return unwrapRequiredCloudResponse(response, `Cloud chart data is unavailable for ${ticker}`)
      .map((point) => mapPricePoint(point, divisor));
  }

  async getPriceHistoryForResolution(
    ticker: string,
    exchange: string,
    bufferRange: TimeRange,
    resolution: ManualChartResolution,
    _context?: MarketDataRequestContext,
  ): Promise<PricePoint[]> {
    await requireVerifiedSession();
    const interval = toCloudInterval(resolution);
    const endDate = new Date();
    const startDate = getRangeStartDate(bufferRange, endDate);
    const includeTime = /(min|h)$/i.test(interval);
    const response = await withCloudFallback(
      () => apiClient.getCloudHistory(ticker, exchange, {
        interval,
        startDate: formatCloudDateTime(startDate, includeTime),
        endDate: formatCloudDateTime(endDate, includeTime),
      }),
      `Cloud chart data is unavailable for ${ticker}`,
    );
    const { divisor } = resolveCurrencyUnit(response.providerMeta?.currency);
    return unwrapRequiredCloudResponse(response, `Cloud chart data is unavailable for ${ticker}`)
      .map((point) => mapPricePoint(point, divisor));
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
    const response = await withCloudFallback(
      () => apiClient.getCloudHistory(ticker, exchange, {
        interval,
        startDate: formatCloudDateTime(startDate, includeTime),
        endDate: formatCloudDateTime(endDate, includeTime),
      }),
      `Cloud detailed chart history is unavailable for ${ticker}`,
    );
    const { divisor } = resolveCurrencyUnit(response.providerMeta?.currency);
    return unwrapRequiredCloudResponse(response, `Cloud detailed chart history is unavailable for ${ticker}`)
      .map((point) => mapPricePoint(point, divisor));
  }

  async getOptionsChain(_ticker: string, _exchange?: string, _expirationDate?: number, _context?: MarketDataRequestContext): Promise<OptionsChain> {
    throw createProviderMiss("Cloud options chains are not available");
  }

  subscribeQuotes(
    targets: QuoteSubscriptionTarget[],
    onQuote: (target: QuoteSubscriptionTarget, quote: Quote) => void,
  ): () => void {
    void apiClient.ensureVerifiedSession().catch(() => {});
    const targetMap = new Map<string, QuoteSubscriptionTarget[]>();
    for (const target of targets) {
      const key = quoteTargetKey(target.symbol, target.exchange);
      const matches = targetMap.get(key) ?? [];
      matches.push(target);
      targetMap.set(key, matches);
    }

    return apiClient.subscribeQuotes(
      targets.map((target) => ({
        symbol: target.symbol,
        exchange: target.exchange,
      })),
      (target, quote) => {
        const key = quoteTargetKey(target.symbol, target.exchange);
        const matches = targetMap.get(key) ?? [{
          symbol: target.symbol,
          exchange: target.exchange,
        }];
        const mappedQuote = mapQuote(quote);
        for (const match of matches) {
          onQuote(match, mappedQuote);
        }
      },
    );
  }
}

export function createGloomberbCloudProvider(): DataProvider {
  return new GloomberbCloudProvider();
}
