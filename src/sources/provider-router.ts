import type { CachedResourceRecord, ResourceStore } from "../data/resource-store";
import type { PluginRegistry } from "../plugins/registry";
import type { BrokerAdapter } from "../types/broker";
import type { AppConfig } from "../types/config";
import { createDefaultConfig } from "../types/config";
import type {
  CachedFinancialsTarget,
  DataProvider,
  MarketDataRequestContext,
  NewsItem,
  QuoteSubscriptionTarget,
  SearchRequestContext,
  SecFilingItem,
} from "../types/data-provider";
import type { OptionsChain, PricePoint, Quote, TickerFinancials } from "../types/financials";
import type { BrokerContractRef, InstrumentSearchResult } from "../types/instrument";
import type { CachePolicy, CachePolicyMap } from "../types/persistence";
import type { TimeRange } from "../components/chart/chart-types";
import {
  isIntradayResolution,
  normalizeChartResolutionSupport,
  type ChartResolutionSupport,
  type ManualChartResolution,
} from "../components/chart/chart-resolution";
import { hasLikelyQuoteUnitMismatch } from "../utils/currency-units";
import { debugLog } from "../utils/debug-log";
import { normalizePriceHistory, normalizeTickerFinancialsPriceHistory } from "../utils/price-history";
import { isProviderMiss } from "./provider-errors";

const providerLog = debugLog.createLogger("provider-router");

const BROKER_ATTEMPT_TIMEOUT = 10_000;
const EXPECTED_PROVIDER_MISS = /No data found|symbol may be delisted|"code":"Not Found"|No history for /i;
const MARKET_NAMESPACE = "market";

const DEFAULT_CACHE_POLICIES: Record<string, CachePolicy> = {
  brokerQuote: { staleMs: 15_000, expireMs: 15 * 60_000 },
  quote: { staleMs: 5 * 60_000, expireMs: 24 * 60 * 60_000 },
  financials: { staleMs: 60 * 60_000, expireMs: 7 * 24 * 60 * 60_000 },
  priceHistoryIntraday: { staleMs: 5 * 60_000, expireMs: 2 * 24 * 60 * 60_000 },
  priceHistoryDaily: { staleMs: 24 * 60 * 60_000, expireMs: 30 * 24 * 60 * 60_000 },
  news: { staleMs: 15 * 60_000, expireMs: 2 * 24 * 60 * 60_000 },
  secFilings: { staleMs: 15 * 60_000, expireMs: 2 * 24 * 60 * 60_000 },
  secFilingContent: { staleMs: 30 * 24 * 60 * 60_000, expireMs: 365 * 24 * 60 * 60_000 },
  articleSummary: { staleMs: 30 * 24 * 60 * 60_000, expireMs: 90 * 24 * 60 * 60_000 },
  optionsChain: { staleMs: 5 * 60_000, expireMs: 2 * 24 * 60 * 60_000 },
  exchangeRate: { staleMs: 60 * 60_000, expireMs: 7 * 24 * 60 * 60_000 },
};

function withBrokerTimeout<T>(promise: Promise<T>): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), BROKER_ATTEMPT_TIMEOUT);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });
}

function shouldLogProviderError(error: unknown): boolean {
  if (isProviderMiss(error)) return false;
  const message = error instanceof Error ? error.message : String(error);
  return !EXPECTED_PROVIDER_MISS.test(message);
}

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

function normalizeExchange(exchange?: string): string {
  return (exchange ?? "").trim().toUpperCase();
}

function compactUrl(url: string): string {
  return url.trim();
}

function compactDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function normalizeSearchKeyPart(value?: string): string {
  return (value ?? "").trim().toUpperCase();
}

function buildSearchResultKey(item: InstrumentSearchResult): string {
  return [
    normalizeSearchKeyPart(item.symbol),
    normalizeSearchKeyPart(item.exchange),
    normalizeSearchKeyPart(item.type),
    normalizeSearchKeyPart(item.primaryExchange),
    normalizeSearchKeyPart(item.currency),
  ].join("|");
}

function getSearchResultRichness(item: InstrumentSearchResult, context?: SearchRequestContext): number {
  let score = 0;
  if (item.brokerContract) score += 500;
  if (item.brokerInstanceId) score += 250;
  if (item.brokerLabel) score += 100;
  if (item.name) score += Math.min(80, item.name.length);
  if (context?.brokerInstanceId && item.brokerInstanceId === context.brokerInstanceId) score += 800;
  if (context?.brokerId && item.brokerContract?.brokerId === context.brokerId) score += 400;
  return score;
}

function buildVariantKey(parts: Array<[string, string | number | undefined | null]>): string {
  return parts
    .filter(([, value]) => value !== undefined && value !== null && String(value).length > 0)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(";");
}

function isIntradayRange(range: TimeRange): boolean {
  return range === "1D" || range === "1W" || range === "1M" || range === "3M";
}

function hasMeaningfulFundamentals(data: TickerFinancials | null | undefined): boolean {
  return !!data && Object.keys(data.fundamentals ?? {}).length > 0;
}

function hasMeaningfulProfile(data: TickerFinancials | null | undefined): boolean {
  return !!data && !!(
    data.profile?.description
    || data.profile?.sector
    || data.profile?.industry
  );
}

function hasLikelyPriceUnitMismatch(primary: TickerFinancials, fallback: TickerFinancials): boolean {
  return hasLikelyQuoteUnitMismatch(primary.quote, fallback.quote);
}

function mergeDefinedObject<T extends object>(preferred: T | null | undefined, fallback: T | null | undefined): T | undefined {
  const mergedEntries: Array<[string, unknown]> = [];

  for (const source of [fallback, preferred]) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined) {
        mergedEntries.push([key, value]);
      }
    }
  }

  if (mergedEntries.length === 0) return undefined;
  return Object.fromEntries(mergedEntries) as T;
}

function mergeFinancials(primary: TickerFinancials | null, fallback: TickerFinancials | null): TickerFinancials | null {
  if (!primary || !fallback) {
    const single = primary ?? fallback;
    return single ? normalizeTickerFinancialsPriceHistory(single) : null;
  }

  const preferFallbackPriceData = hasLikelyPriceUnitMismatch(primary, fallback);
  const dominant = preferFallbackPriceData ? fallback : primary;
  const secondary = preferFallbackPriceData ? primary : fallback;

  return {
    ...fallback,
    ...primary,
    quote: mergeDefinedObject(dominant.quote, secondary.quote),
    profile: mergeDefinedObject(primary.profile, fallback.profile),
    fundamentals: mergeDefinedObject(primary.fundamentals, fallback.fundamentals),
    priceHistory: normalizePriceHistory(dominant.priceHistory.length > 0 ? dominant.priceHistory : secondary.priceHistory),
    annualStatements: primary.annualStatements.length > 0 ? primary.annualStatements : fallback.annualStatements,
    quarterlyStatements: primary.quarterlyStatements.length > 0 ? primary.quarterlyStatements : fallback.quarterlyStatements,
  };
}

function mergeCachedFinancialRecords(records: CachedResourceRecord<TickerFinancials>[]): {
  value: TickerFinancials | null;
  stale: boolean;
} {
  const seenSources = new Set<string>();
  let merged: TickerFinancials | null = null;
  let stale = false;

  for (const record of records) {
    if (seenSources.has(record.sourceKey)) continue;
    seenSources.add(record.sourceKey);
    merged = mergeFinancials(merged, record.value);
    stale = stale || record.stale;
  }

  return { value: merged, stale };
}

interface CachedFinancialsSelection {
  brokerRecord: CachedResourceRecord<TickerFinancials> | null;
  providerValue: TickerFinancials | null;
  value: TickerFinancials | null;
  stale: boolean;
}

interface BrokerCandidate {
  brokerId: string;
  brokerInstanceId: string;
  brokerLabel: string;
  broker: BrokerAdapter;
  instance: AppConfig["brokerInstances"][number];
}

interface SourceResult<T> {
  sourceKey: string;
  value: T;
}

export class ProviderRouter implements DataProvider {
  readonly id = "provider-router";
  readonly name = "Provider Router";
  readonly priority = Number.MAX_SAFE_INTEGER;

  private registry: PluginRegistry | null = null;
  private readonly revalidationInFlight = new Map<string, Promise<unknown>>();
  private getConfigFn: () => AppConfig = () => createDefaultConfig("");

  constructor(
    private readonly fallbackProvider: DataProvider | null = null,
    private readonly extraProviders: DataProvider[] = [],
    private readonly resources?: ResourceStore,
  ) {}

  attachRegistry(registry: PluginRegistry): void {
    this.registry = registry;
  }

  setConfigAccessor(getConfig: () => AppConfig): void {
    this.getConfigFn = getConfig;
  }

  async canProvide(ticker: string, exchange?: string, context?: MarketDataRequestContext): Promise<boolean> {
    const brokerQuote = await withBrokerTimeout(this.fetchBrokerQuote(ticker, exchange, context));
    if (brokerQuote) return true;
    for (const provider of this.providersInPriorityOrder()) {
      try {
        if (!provider.canProvide || await provider.canProvide(ticker, exchange, context)) {
          return true;
        }
      } catch {
        // continue through provider chain
      }
    }
    return false;
  }

  getCachedFinancialsForTargets(targets: CachedFinancialsTarget[], options: { allowExpired?: boolean } = {}): Map<string, TickerFinancials> {
    const results = new Map<string, TickerFinancials>();
    for (const target of targets) {
      const cached = this.readCachedMergedFinancials(target.symbol, target.exchange, {
        brokerId: target.brokerId,
        brokerInstanceId: target.brokerInstanceId,
        instrument: target.instrument ?? undefined,
      }, options.allowExpired ?? true);
      if (cached) results.set(target.symbol.toUpperCase(), cached);
    }
    return results;
  }

  getCachedExchangeRates(currencies: string[], options: { allowExpired?: boolean } = {}): Map<string, number> {
    const results = new Map<string, number>();
    for (const currency of currencies) {
      const cached = this.readCachedExchangeRate(currency, options.allowExpired ?? true);
      if (cached != null) results.set(currency, cached);
    }
    return results;
  }

  async getTickerFinancials(ticker: string, exchange?: string, context?: MarketDataRequestContext): Promise<TickerFinancials> {
    const cached = this.readCachedMergedFinancialsSelection(ticker, exchange, context, false);
    const forceRefresh = context?.cacheMode === "refresh";
    if (cached.value && !forceRefresh) {
      if (!cached.stale && hasMeaningfulProfile(cached.value)) {
        return cached.value;
      }
      if (!hasMeaningfulProfile(cached.value) && !cached.stale) {
        const providerResult = await this.fetchProviderFinancials(ticker, exchange, context);
        return mergeFinancials(cached.value, providerResult?.value ?? null) ?? cached.value;
      }
    }

    if (cached.value) {
      const brokerResult = await withBrokerTimeout(this.fetchBrokerFinancials(ticker, exchange, context));
      const providerResult = await this.fetchProviderFinancials(ticker, exchange, context);
      return mergeFinancials(
        brokerResult?.value ?? cached.brokerRecord?.value ?? null,
        providerResult?.value ?? cached.providerValue ?? null,
      ) ?? cached.value;
    }

    const brokerResult = await withBrokerTimeout(this.fetchBrokerFinancials(ticker, exchange, context));
    const fallback = await this.fetchProviderFinancials(ticker, exchange, context);
    const merged = mergeFinancials(brokerResult?.value ?? null, fallback?.value ?? null);
    if (!merged) {
      throw new Error(`No provider available for ${ticker}`);
    }
    return merged;
  }

  async getQuote(ticker: string, exchange?: string, context?: MarketDataRequestContext): Promise<Quote> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKeys = this.getTickerVariantCandidates(exchange);
    const sourceKeys = [
      ...this.getBrokerCandidatesForContext(context, false).map((candidate) => this.brokerSourceKey(candidate)),
      ...this.getProviderSourceKeys(),
    ];
    const cached = this.selectCachedResource<Quote>("quote", entityKey, variantKeys, sourceKeys, false);
    const forceRefresh = context?.cacheMode === "refresh";
    if (cached && !forceRefresh && !cached.stale) {
      return cached.value;
    }

    const brokerQuote = await withBrokerTimeout(this.fetchBrokerQuote(ticker, exchange, context));
    if (brokerQuote) return brokerQuote.value;

    const providerQuote = await this.fetchProviderQuote(ticker, exchange, context);
    if (providerQuote) {
      return providerQuote.value;
    }
    if (cached) return cached.value;
    throw new Error(`No quote provider available for ${ticker}`);
  }

  async getExchangeRate(fromCurrency: string): Promise<number> {
    const cached = this.readCachedExchangeRate(fromCurrency, false);
    if (cached != null) {
      this.scheduleRevalidation(`exchange-rate:${fromCurrency.toUpperCase()}`, async () => {
        await this.revalidateExchangeRate(fromCurrency);
      });
      return cached;
    }

    const result = await this.firstProvider(async (provider) => {
      const rate = await provider.getExchangeRate(fromCurrency);
      return { provider, rate };
    });
    if (!result) {
      throw new Error(`No exchange rate provider available for ${fromCurrency}`);
    }
    this.cacheExchangeRate(fromCurrency, result.value.rate, result.value.provider);
    return result.value.rate;
  }

  async search(query: string, context?: SearchRequestContext): Promise<InstrumentSearchResult[]> {
    const results: InstrumentSearchResult[] = [];
    const resultIndexByKey = new Map<string, number>();

    const push = (items: InstrumentSearchResult[]) => {
      for (const item of items) {
        const key = buildSearchResultKey(item);
        const existingIndex = resultIndexByKey.get(key);
        if (existingIndex == null) {
          resultIndexByKey.set(key, results.length);
          results.push(item);
          continue;
        }

        const existing = results[existingIndex]!;
        if (getSearchResultRichness(item, context) > getSearchResultRichness(existing, context)) {
          results[existingIndex] = item;
        }
      }
    };

    const searchPromises: Promise<void>[] = [];

    if (context?.preferBroker !== false) {
      for (const candidate of this.getBrokerCandidates(
        context?.brokerInstanceId,
        context?.brokerId,
      )) {
        if (!candidate.broker.searchInstruments) continue;
        searchPromises.push(
          candidate.broker.searchInstruments(query, candidate.instance)
            .then((items) => push(this.annotateSearchResults(items, candidate)))
            .catch(() => {}),
        );
      }
    }

    for (const provider of this.providersInPriorityOrder()) {
      searchPromises.push(
        provider.search(query, context)
          .then((items) => push(items))
          .catch(() => {}),
      );
    }

    const deadline = new Promise<void>((resolve) => setTimeout(resolve, 5_000));
    await Promise.race([Promise.all(searchPromises), deadline]);
    return results;
  }

  async getNews(ticker: string, count = 15, exchange?: string, context?: MarketDataRequestContext): Promise<NewsItem[]> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKeys = [
      buildVariantKey([["exchange", normalizeExchange(exchange)], ["count", count]]),
      buildVariantKey([["count", count]]),
      "",
    ];
    const cached = this.selectCachedResource<NewsItem[]>("news", entityKey, variantKeys, this.getProviderSourceKeys(), false);
    if (cached) {
      this.scheduleRevalidation(this.makeRevalidationKey("news", ticker, exchange, context, count), async () => {
        await this.revalidateNews(ticker, count, exchange, context);
      });
      return cached.value;
    }

    const result = await this.firstProvider((provider) => provider.getNews(ticker, count, exchange, context));
    if (!result) {
      throw new Error(`No news provider available for ${ticker}`);
    }
    const provider = this.resolveProviderBySourceKey(result.sourceKey);
    if (provider) {
      this.cacheResource("news", entityKey, variantKeys[0] ?? "", result.sourceKey, result.value, this.resolveProviderPolicy("news", provider));
    }
    return result.value;
  }

  async getSecFilings(ticker: string, count = 15, exchange?: string, context?: MarketDataRequestContext): Promise<SecFilingItem[]> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKeys = [
      buildVariantKey([["exchange", normalizeExchange(exchange)], ["count", count]]),
      buildVariantKey([["count", count]]),
      "",
    ];
    const cached = this.selectCachedResource<SecFilingItem[]>("sec-filings", entityKey, variantKeys, this.getProviderSourceKeys(), false);
    if (cached) {
      this.scheduleRevalidation(this.makeRevalidationKey("sec-filings", ticker, exchange, context, count), async () => {
        await this.revalidateSecFilings(ticker, count, exchange, context);
      });
      return cached.value;
    }

    const result = await this.fetchProviderSecFilings(ticker, count, exchange, context);
    if (!result) {
      throw new Error(`No SEC filings provider available for ${ticker}`);
    }
    return result.value;
  }

  async getSecFilingContent(filing: SecFilingItem): Promise<string | null> {
    const entityKey = compactUrl(filing.primaryDocumentUrl ?? filing.filingUrl);
    const cached = this.selectCachedResource<string | null>("sec-filing-content", entityKey, [""], this.getProviderSourceKeys(), false);
    if (cached) {
      this.scheduleRevalidation(`sec-filing-content:${entityKey}`, async () => {
        await this.revalidateSecFilingContent(filing);
      });
      return cached.value;
    }

    const result = await this.fetchProviderSecFilingContent(filing);
    if (!result) {
      throw new Error("No SEC filing content provider available");
    }
    return result.value;
  }

  async getArticleSummary(url: string): Promise<string | null> {
    const entityKey = compactUrl(url);
    const cached = this.selectCachedResource<string>("article-summary", entityKey, [""], this.getProviderSourceKeys(), false);
    if (cached) {
      this.scheduleRevalidation(`article-summary:${entityKey}`, async () => {
        await this.revalidateArticleSummary(url);
      });
      return cached.value;
    }

    const result = await this.firstProvider((provider) => provider.getArticleSummary(url));
    if (!result) {
      return null;
    }
    const provider = this.resolveProviderBySourceKey(result.sourceKey);
    if (provider && result.value) {
      this.cacheResource("article-summary", entityKey, "", result.sourceKey, result.value, this.resolveProviderPolicy("articleSummary", provider));
    }
    return result.value;
  }

  async getPriceHistory(ticker: string, exchange: string, range: TimeRange, context?: MarketDataRequestContext): Promise<PricePoint[]> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKeys = [
      buildVariantKey([["exchange", normalizeExchange(exchange)], ["range", range]]),
      buildVariantKey([["range", range]]),
    ];
    const sourceKeys = [
      ...this.getBrokerCandidatesForContext(context, false).map((candidate) => this.brokerSourceKey(candidate)),
      ...this.getProviderSourceKeys(),
    ];
    const cached = this.selectCachedArrayResource<PricePoint>("price-history", entityKey, variantKeys, sourceKeys, false);
    const cachedValue = cached ? normalizePriceHistory(cached.value) : [];
    const forceRefresh = context?.cacheMode === "refresh";
    if (cachedValue.length > 0 && !forceRefresh && cached && !cached.stale) {
      return cachedValue;
    }

    const brokerHistory = await withBrokerTimeout(this.fetchBrokerPriceHistory(ticker, exchange, range, context));
    if (brokerHistory && brokerHistory.value.length > 0) return brokerHistory.value;

    const providerHistory = await this.fetchProviderPriceHistory(ticker, exchange, range, context);
    if (providerHistory && providerHistory.value.length > 0) {
      return providerHistory.value;
    }
    if (cachedValue.length > 0) return cachedValue;
    if (!providerHistory) {
      throw new Error(`No history provider available for ${ticker}`);
    }
    return providerHistory.value;
  }

  async getPriceHistoryForResolution(
    ticker: string,
    exchange: string,
    bufferRange: TimeRange,
    resolution: ManualChartResolution,
    context?: MarketDataRequestContext,
  ): Promise<PricePoint[]> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKeys = [
      buildVariantKey([["exchange", normalizeExchange(exchange)], ["range", bufferRange], ["resolution", resolution]]),
      buildVariantKey([["range", bufferRange], ["resolution", resolution]]),
    ];
    const sourceKeys = [
      ...this.getBrokerCandidatesForContext(context, false).map((candidate) => this.brokerSourceKey(candidate)),
      ...this.getProviderSourceKeys(),
    ];
    const cached = this.selectCachedArrayResource<PricePoint>("price-history", entityKey, variantKeys, sourceKeys, false);
    const cachedValue = cached ? normalizePriceHistory(cached.value) : [];
    const forceRefresh = context?.cacheMode === "refresh";
    if (cachedValue.length > 0 && !forceRefresh && cached && !cached.stale) {
      return cachedValue;
    }

    const brokerHistory = await withBrokerTimeout(this.fetchBrokerPriceHistoryForResolution(ticker, exchange, bufferRange, resolution, context));
    if (brokerHistory && brokerHistory.value.length > 0) return brokerHistory.value;

    const providerHistory = await this.fetchProviderPriceHistoryForResolution(ticker, exchange, bufferRange, resolution, context);
    if (providerHistory && providerHistory.value.length > 0) {
      return providerHistory.value;
    }
    if (cachedValue.length > 0) return cachedValue;
    if (!providerHistory) {
      throw new Error(`No resolution-aware history provider available for ${ticker}`);
    }
    return providerHistory.value;
  }

  async getChartResolutionSupport(
    ticker: string,
    exchange?: string,
    context?: MarketDataRequestContext,
  ): Promise<ChartResolutionSupport[]> {
    const brokerSupport = await withBrokerTimeout(this.fetchBrokerChartResolutionSupport(ticker, exchange, context));
    if (brokerSupport && brokerSupport.value.length > 0) {
      return brokerSupport.value;
    }
    const providerSupport = await this.fetchProviderChartResolutionSupport(ticker, exchange, context);
    return providerSupport?.value ?? [];
  }

  async getChartResolutionCapabilities(
    ticker: string,
    exchange?: string,
    context?: MarketDataRequestContext,
  ): Promise<ManualChartResolution[]> {
    const support = await this.getChartResolutionSupport(ticker, exchange, context);
    return support.map((entry) => entry.resolution);
  }

  async getDetailedPriceHistory(
    ticker: string,
    exchange: string,
    startDate: Date,
    endDate: Date,
    barSize: string,
    context?: MarketDataRequestContext,
  ): Promise<PricePoint[]> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKeys = [
      buildVariantKey([["exchange", normalizeExchange(exchange)], ["start", compactDate(startDate)], ["end", compactDate(endDate)], ["bar", barSize]]),
      buildVariantKey([["start", compactDate(startDate)], ["end", compactDate(endDate)], ["bar", barSize]]),
    ];
    const sourceKeys = [
      ...this.getBrokerCandidatesForContext(context, false).map((candidate) => this.brokerSourceKey(candidate)),
      ...this.getProviderSourceKeys(),
    ];
    const cached = this.selectCachedArrayResource<PricePoint>("detailed-price-history", entityKey, variantKeys, sourceKeys, false);
    const cachedValue = cached ? normalizePriceHistory(cached.value) : [];
    const forceRefresh = context?.cacheMode === "refresh";
    if (cachedValue.length > 0 && !forceRefresh && cached && !cached.stale) {
      return cachedValue;
    }

    const brokerResult = await withBrokerTimeout(this.fetchBrokerDetailedPriceHistory(ticker, exchange, startDate, endDate, barSize, context));
    if (brokerResult && brokerResult.value.length > 0) return brokerResult.value;

    const providerResult = await this.fetchProviderDetailedPriceHistory(ticker, exchange, startDate, endDate, barSize, context);
    if (providerResult && providerResult.value.length > 0) {
      return providerResult.value;
    }
    return cachedValue.length > 0 ? cachedValue : (providerResult?.value ?? []);
  }

  async getOptionsChain(ticker: string, exchange?: string, expirationDate?: number, context?: MarketDataRequestContext): Promise<OptionsChain> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKeys = [
      buildVariantKey([["exchange", normalizeExchange(exchange)], ["expiration", expirationDate ?? "default"]]),
      buildVariantKey([["expiration", expirationDate ?? "default"]]),
      "",
    ];
    const sourceKeys = [
      ...this.getBrokerCandidatesForContext(context, false).map((candidate) => this.brokerSourceKey(candidate)),
      ...this.getProviderSourceKeys(),
    ];
    const cached = this.selectCachedResource<OptionsChain>("options-chain", entityKey, variantKeys, sourceKeys, false);
    if (cached) {
      this.scheduleRevalidation(this.makeRevalidationKey("options-chain", ticker, exchange, context, expirationDate ?? "default"), async () => {
        await this.revalidateOptionsChain(ticker, exchange, expirationDate, context);
      });
      return cached.value;
    }

    const brokerChain = await withBrokerTimeout(this.fetchBrokerOptionsChain(ticker, exchange, expirationDate, context));
    if (brokerChain) return brokerChain.value;

    const providerChain = await this.fetchProviderOptionsChain(ticker, exchange, expirationDate, context);
    if (!providerChain) {
      throw new Error(`No options provider available for ${ticker}`);
    }
    return providerChain.value;
  }

  private makeRevalidationKey(kind: string, ticker: string, exchange?: string, context?: MarketDataRequestContext, extra?: string | number): string {
    return [
      kind,
      this.getEntityKey(ticker, exchange, context?.instrument),
      extra != null ? String(extra) : "",
    ].join("|");
  }

  private scheduleRevalidation(key: string, task: () => Promise<void>): void {
    if (this.revalidationInFlight.has(key)) return;
    const promise = task()
      .catch(() => {})
      .finally(() => {
        this.revalidationInFlight.delete(key);
      });
    this.revalidationInFlight.set(key, promise);
  }

  private getEntityKey(ticker: string, exchange?: string, instrument?: BrokerContractRef | null): string {
    if (instrument?.conId != null) return `contract:${instrument.conId}`;
    if (instrument?.localSymbol) return `contract:${instrument.localSymbol.toUpperCase()}`;
    if (instrument?.symbol) return `contract:${instrument.symbol.toUpperCase()}`;
    return normalizeTicker(ticker);
  }

  private getTickerVariantCandidates(exchange?: string): string[] {
    const normalizedExchange = normalizeExchange(exchange);
    return [
      buildVariantKey([["exchange", normalizedExchange]]),
      "",
    ].filter((value, index, array) => value.length > 0 || array.indexOf(value) === index);
  }

  private providerSourceKey(provider: DataProvider): string {
    return `provider:${provider.id}`;
  }

  private brokerSourceKey(candidate: BrokerCandidate): string {
    return `broker:${candidate.brokerId}:${candidate.brokerInstanceId}`;
  }

  private getProviderSourceKeys(): string[] {
    return this.providersInPriorityOrder().map((provider) => this.providerSourceKey(provider));
  }

  private firstAvailableProvider(): DataProvider | null {
    return this.providersInPriorityOrder()[0] ?? null;
  }

  private resolvePolicy(overrides: CachePolicyMap | undefined, key: keyof typeof DEFAULT_CACHE_POLICIES): CachePolicy {
    return overrides?.[key] ?? DEFAULT_CACHE_POLICIES[key]!;
  }

  private resolveProviderPolicy(key: keyof typeof DEFAULT_CACHE_POLICIES, provider: DataProvider): CachePolicy {
    return this.resolvePolicy(provider.cachePolicy, key);
  }

  private resolveBrokerPolicy(key: keyof typeof DEFAULT_CACHE_POLICIES, broker: BrokerAdapter): CachePolicy {
    return this.resolvePolicy(broker.cachePolicy, key);
  }

  private cacheResource<T>(kind: string, entityKey: string, variantKey: string, sourceKey: string, value: T, cachePolicy: CachePolicy): void {
    this.resources?.set(
      {
        namespace: MARKET_NAMESPACE,
        kind,
        entityKey,
        variantKey,
        sourceKey,
      },
      value,
      {
        cachePolicy,
      },
    );
  }

  private listCachedResources<T>(
    kind: string,
    entityKey: string,
    variantKeys: string[],
    sourceKeys: string[],
    allowExpired: boolean,
  ): CachedResourceRecord<T>[] {
    if (!this.resources) return [];
    const records = this.resources.list<T>({
      namespace: MARKET_NAMESPACE,
      kind,
      entityKey,
    }, {
      variantKeys,
      sourceKeys,
      allowExpired,
    });
    if (records.length === 0) return [];

    const sourceRank = new Map(sourceKeys.map((sourceKey, index) => [sourceKey, index]));
    const variantRank = new Map(variantKeys.map((variantKey, index) => [variantKey, index]));
    return [...records].sort((a, b) => {
      if (a.expired !== b.expired) return a.expired ? 1 : -1;
      if (a.stale !== b.stale) return a.stale ? 1 : -1;
      const sourceDelta = (sourceRank.get(a.sourceKey) ?? Number.MAX_SAFE_INTEGER) - (sourceRank.get(b.sourceKey) ?? Number.MAX_SAFE_INTEGER);
      if (sourceDelta !== 0) return sourceDelta;
      const variantDelta = (variantRank.get(a.variantKey ?? "") ?? Number.MAX_SAFE_INTEGER) - (variantRank.get(b.variantKey ?? "") ?? Number.MAX_SAFE_INTEGER);
      if (variantDelta !== 0) return variantDelta;
      return b.fetchedAt - a.fetchedAt;
    });
  }

  private selectCachedResource<T>(
    kind: string,
    entityKey: string,
    variantKeys: string[],
    sourceKeys: string[],
    allowExpired: boolean,
  ): CachedResourceRecord<T> | null {
    return this.listCachedResources(kind, entityKey, variantKeys, sourceKeys, allowExpired)[0] ?? null;
  }

  private selectCachedArrayResource<T>(
    kind: string,
    entityKey: string,
    variantKeys: string[],
    sourceKeys: string[],
    allowExpired: boolean,
  ): CachedResourceRecord<T[]> | null {
    const records = this.listCachedResources<T[]>(kind, entityKey, variantKeys, sourceKeys, allowExpired);
    return records.find((record) => record.value.length > 0) ?? records[0] ?? null;
  }

  private readCachedMergedFinancials(
    ticker: string,
    exchange?: string,
    context?: MarketDataRequestContext,
    allowExpired = false,
  ): TickerFinancials | null {
    return this.readCachedMergedFinancialsSelection(ticker, exchange, context, allowExpired).value;
  }

  private readCachedMergedFinancialsSelection(
    ticker: string,
    exchange?: string,
    context?: MarketDataRequestContext,
    allowExpired = false,
  ): CachedFinancialsSelection {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKeys = this.getTickerVariantCandidates(exchange);
    const brokerSourceKeys = this.getBrokerCandidatesForContext(context, false).map((candidate) => this.brokerSourceKey(candidate));
    const brokerRecord = brokerSourceKeys.length > 0
      ? this.selectCachedResource<TickerFinancials>("financials", entityKey, variantKeys, brokerSourceKeys, allowExpired)
      : null;
    const providerSelection = mergeCachedFinancialRecords(
      this.listCachedResources<TickerFinancials>(
        "financials",
        entityKey,
        variantKeys,
        this.getProviderSourceKeys(),
        allowExpired,
      ),
    );
    return {
      brokerRecord,
      providerValue: providerSelection.value,
      value: mergeFinancials(brokerRecord?.value ?? null, providerSelection.value),
      stale: (brokerRecord?.stale ?? false) || providerSelection.stale,
    };
  }

  private readCachedExchangeRate(currency: string, allowExpired = false): number | null {
    const normalizedCurrency = currency.toUpperCase();
    if (normalizedCurrency === "USD") return 1;
    const entityKey = `${normalizedCurrency}/USD`;
    const cached = this.selectCachedResource<{ rate: number }>("exchange-rate", entityKey, [""], this.getProviderSourceKeys(), allowExpired);
    return cached?.value.rate ?? null;
  }

  private cacheExchangeRate(currency: string, rate: number, provider: DataProvider): void {
    const normalizedCurrency = currency.toUpperCase();
    if (normalizedCurrency === "USD") return;
    this.cacheResource(
      "exchange-rate",
      `${normalizedCurrency}/USD`,
      "",
      this.providerSourceKey(provider),
      { rate },
      this.resolveProviderPolicy("exchangeRate", provider),
    );
  }

  private getBrokerCandidates(
    preferredBrokerInstanceId?: string,
    preferredBrokerId?: string,
    includeFallbackInstances = true,
  ): BrokerCandidate[] {
    if (!this.registry) return [];
    const config = this.getConfigFn();
    const candidates: BrokerCandidate[] = [];

    const pushCandidate = (instance: AppConfig["brokerInstances"][number]) => {
      if (instance.enabled === false) return;
      if (preferredBrokerId && instance.brokerType !== preferredBrokerId && instance.id !== preferredBrokerInstanceId) return;
      const broker = this.registry?.brokers.get(instance.brokerType);
      if (!broker) return;
      candidates.push({
        brokerId: instance.brokerType,
        brokerInstanceId: instance.id,
        brokerLabel: instance.label,
        broker,
        instance,
      });
    };

    const preferredInstance = preferredBrokerInstanceId
      ? config.brokerInstances.find((instance) => instance.id === preferredBrokerInstanceId)
      : undefined;
    if (preferredInstance) {
      pushCandidate(preferredInstance);
    }

    if (!includeFallbackInstances && preferredInstance) {
      return candidates;
    }

    for (const instance of config.brokerInstances) {
      if (instance.id === preferredBrokerInstanceId) continue;
      pushCandidate(instance);
    }

    return candidates;
  }

  private getBrokerCandidatesForContext(
    context?: MarketDataRequestContext,
    includeFallbackInstances = true,
  ): BrokerCandidate[] {
    return this.getBrokerCandidates(
      context?.instrument?.brokerInstanceId ?? context?.brokerInstanceId,
      context?.instrument?.brokerId ?? context?.brokerId,
      includeFallbackInstances,
    );
  }

  private getStreamingBrokerCandidate(target: QuoteSubscriptionTarget): BrokerCandidate | null {
    const hasBrokerContext = !!(
      target.context?.brokerId
      || target.context?.brokerInstanceId
      || target.context?.instrument?.brokerId
      || target.context?.instrument?.brokerInstanceId
    );
    if (!hasBrokerContext) return null;
    return this.getBrokerCandidatesForContext(target.context, false)
      .find((candidate) => typeof candidate.broker.subscribeQuotes === "function") ?? null;
  }

  private annotateSearchResults(items: InstrumentSearchResult[], candidate: BrokerCandidate): InstrumentSearchResult[] {
    return items.map((item) => ({
      ...item,
      brokerInstanceId: item.brokerInstanceId ?? candidate.brokerInstanceId,
      brokerLabel: item.brokerLabel ?? candidate.brokerLabel,
      brokerContract: item.brokerContract
        ? {
          ...item.brokerContract,
          brokerId: item.brokerContract.brokerId || candidate.brokerId,
          brokerInstanceId: item.brokerContract.brokerInstanceId ?? candidate.brokerInstanceId,
        }
        : undefined,
    }));
  }

  private sortedProviders(): DataProvider[] {
    const providers = [...this.extraProviders];
    if (this.registry) {
      const registryProviders = typeof this.registry.getEnabledDataProviders === "function"
        ? this.registry.getEnabledDataProviders()
        : [...this.registry.dataProviders.values()];
      providers.push(...registryProviders);
    }
    return providers
      .filter((provider) => provider.id !== this.id && provider.id !== this.fallbackProvider?.id)
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  }

  private providersInPriorityOrder(): DataProvider[] {
    const providers = [...this.sortedProviders()];
    if (this.fallbackProvider && !providers.some((provider) => provider.id === this.fallbackProvider?.id)) {
      providers.push(this.fallbackProvider);
    }
    return providers;
  }

  private async firstProvider<T>(fn: (provider: DataProvider) => Promise<T | null | undefined>): Promise<SourceResult<T> | null> {
    for (const provider of this.providersInPriorityOrder()) {
      try {
        const result = await fn(provider);
        if (result != null) return { sourceKey: this.providerSourceKey(provider), value: result };
      } catch (err) {
        if (shouldLogProviderError(err)) {
          providerLog.error(`${provider.id} failed: ${err}`);
        }
      }
    }
    return null;
  }

  private async fetchBrokerFinancials(
    ticker: string,
    exchange?: string,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<TickerFinancials> | null> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKey = this.getTickerVariantCandidates(exchange)[0] ?? "";
    for (const candidate of this.getBrokerCandidatesForContext(context, false)) {
      if (!candidate.broker.getTickerFinancials) continue;
      try {
        const result = normalizeTickerFinancialsPriceHistory(await candidate.broker.getTickerFinancials(
          ticker,
          candidate.instance,
          exchange,
          context?.instrument ?? null,
        ));
        this.cacheResource(
          "financials",
          entityKey,
          variantKey,
          this.brokerSourceKey(candidate),
          result,
          this.resolveBrokerPolicy("financials", candidate.broker),
        );
        return { sourceKey: this.brokerSourceKey(candidate), value: result };
      } catch {
        // continue
      }
    }
    return null;
  }

  private async fetchProviderFinancials(
    ticker: string,
    exchange?: string,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<TickerFinancials> | null> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKey = this.getTickerVariantCandidates(exchange)[0] ?? "";
    let merged: TickerFinancials | null = null;
    let firstSourceKey: string | null = null;

    for (const provider of this.providersInPriorityOrder()) {
      try {
        const value = normalizeTickerFinancialsPriceHistory(await provider.getTickerFinancials(ticker, exchange, context));
        const sourceKey = this.providerSourceKey(provider);
        this.cacheResource(
          "financials",
          entityKey,
          variantKey,
          sourceKey,
          value,
          this.resolveProviderPolicy("financials", provider),
        );
        merged = mergeFinancials(merged, value);
        firstSourceKey ??= sourceKey;
      } catch (error) {
        if (shouldLogProviderError(error)) {
          providerLog.error(`${provider.id} failed: ${error}`);
        }
      }
    }

    return merged && firstSourceKey
      ? { sourceKey: firstSourceKey, value: merged }
      : null;
  }

  private async fetchBrokerQuote(
    ticker: string,
    exchange?: string,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<Quote> | null> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKey = this.getTickerVariantCandidates(exchange)[0] ?? "";
    for (const candidate of this.getBrokerCandidatesForContext(context, false)) {
      if (!candidate.broker.getQuote) continue;
      try {
        const result = await candidate.broker.getQuote(
          ticker,
          candidate.instance,
          exchange,
          context?.instrument ?? null,
        );
        this.cacheResource(
          "quote",
          entityKey,
          variantKey,
          this.brokerSourceKey(candidate),
          result,
          this.resolveBrokerPolicy("brokerQuote", candidate.broker),
        );
        return { sourceKey: this.brokerSourceKey(candidate), value: result };
      } catch {
        // continue
      }
    }
    return null;
  }

  private async fetchProviderQuote(
    ticker: string,
    exchange?: string,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<Quote> | null> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKey = this.getTickerVariantCandidates(exchange)[0] ?? "";
    const result = await this.firstProvider((provider) => provider.getQuote(ticker, exchange, context));
    if (!result) return null;
    const provider = this.resolveProviderBySourceKey(result.sourceKey);
    if (provider) {
      this.cacheResource("quote", entityKey, variantKey, result.sourceKey, result.value, this.resolveProviderPolicy("quote", provider));
    }
    return result;
  }

  private async fetchBrokerPriceHistory(
    ticker: string,
    exchange: string,
    range: TimeRange,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<PricePoint[]> | null> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKey = buildVariantKey([["exchange", normalizeExchange(exchange)], ["range", range]]);
    for (const candidate of this.getBrokerCandidatesForContext(context, false)) {
      if (!candidate.broker.getPriceHistory) continue;
      try {
        const result = normalizePriceHistory(await candidate.broker.getPriceHistory(
          ticker,
          candidate.instance,
          exchange,
          range,
          context?.instrument ?? null,
        ));
        this.cacheResource(
          "price-history",
          entityKey,
          variantKey,
          this.brokerSourceKey(candidate),
          result,
          this.resolveBrokerPolicy(isIntradayRange(range) ? "priceHistoryIntraday" : "priceHistoryDaily", candidate.broker),
        );
        return { sourceKey: this.brokerSourceKey(candidate), value: result };
      } catch {
        // continue
      }
    }
    return null;
  }

  private async fetchBrokerPriceHistoryForResolution(
    ticker: string,
    exchange: string,
    bufferRange: TimeRange,
    resolution: ManualChartResolution,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<PricePoint[]> | null> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKey = buildVariantKey([["exchange", normalizeExchange(exchange)], ["range", bufferRange], ["resolution", resolution]]);
    for (const candidate of this.getBrokerCandidatesForContext(context, false)) {
      if (!candidate.broker.getPriceHistoryForResolution) continue;
      try {
        const result = normalizePriceHistory(await candidate.broker.getPriceHistoryForResolution(
          ticker,
          candidate.instance,
          exchange,
          bufferRange,
          resolution,
          context?.instrument ?? null,
        ));
        this.cacheResource(
          "price-history",
          entityKey,
          variantKey,
          this.brokerSourceKey(candidate),
          result,
          this.resolveBrokerPolicy(isIntradayResolution(resolution) ? "priceHistoryIntraday" : "priceHistoryDaily", candidate.broker),
        );
        return { sourceKey: this.brokerSourceKey(candidate), value: result };
      } catch {
        // continue
      }
    }
    return null;
  }

  private async fetchProviderPriceHistory(
    ticker: string,
    exchange: string,
    range: TimeRange,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<PricePoint[]> | null> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKey = buildVariantKey([["exchange", normalizeExchange(exchange)], ["range", range]]);
    let firstEmptyResult: SourceResult<PricePoint[]> | null = null;

    for (const provider of this.providersInPriorityOrder()) {
      try {
        const value = normalizePriceHistory(await provider.getPriceHistory(ticker, exchange, range, context));
        const sourceKey = this.providerSourceKey(provider);
        this.cacheResource(
          "price-history",
          entityKey,
          variantKey,
          sourceKey,
          value,
          this.resolveProviderPolicy(isIntradayRange(range) ? "priceHistoryIntraday" : "priceHistoryDaily", provider),
        );
        if (value.length > 0) {
          return { sourceKey, value };
        }
        firstEmptyResult ??= { sourceKey, value };
      } catch (error) {
        if (shouldLogProviderError(error)) {
          providerLog.error(`${provider.id} failed: ${error}`);
        }
      }
    }

    return firstEmptyResult;
  }

  private async fetchProviderPriceHistoryForResolution(
    ticker: string,
    exchange: string,
    bufferRange: TimeRange,
    resolution: ManualChartResolution,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<PricePoint[]> | null> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKey = buildVariantKey([["exchange", normalizeExchange(exchange)], ["range", bufferRange], ["resolution", resolution]]);
    let firstEmptyResult: SourceResult<PricePoint[]> | null = null;

    for (const provider of this.providersInPriorityOrder()) {
      if (!provider.getPriceHistoryForResolution) continue;
      try {
        const value = normalizePriceHistory(await provider.getPriceHistoryForResolution(ticker, exchange, bufferRange, resolution, context));
        const sourceKey = this.providerSourceKey(provider);
        this.cacheResource(
          "price-history",
          entityKey,
          variantKey,
          sourceKey,
          value,
          this.resolveProviderPolicy(isIntradayResolution(resolution) ? "priceHistoryIntraday" : "priceHistoryDaily", provider),
        );
        if (value.length > 0) {
          return { sourceKey, value };
        }
        firstEmptyResult ??= { sourceKey, value };
      } catch (error) {
        if (shouldLogProviderError(error)) {
          providerLog.error(`${provider.id} failed: ${error}`);
        }
      }
    }

    return firstEmptyResult;
  }

  private async fetchBrokerChartResolutionSupport(
    ticker: string,
    exchange?: string,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<ChartResolutionSupport[]> | null> {
    for (const candidate of this.getBrokerCandidatesForContext(context, false)) {
      if (!candidate.broker.getChartResolutionSupport && !candidate.broker.getChartResolutionCapabilities) continue;
      try {
        const result = candidate.broker.getChartResolutionSupport
          ? normalizeChartResolutionSupport(await candidate.broker.getChartResolutionSupport(
            ticker,
            candidate.instance,
            exchange,
            context?.instrument ?? null,
          ))
          : normalizeChartResolutionSupport(
            (await candidate.broker.getChartResolutionCapabilities!(
              ticker,
              candidate.instance,
              exchange,
              context?.instrument ?? null,
            )).map((resolution) => ({ resolution, maxRange: "ALL" })),
          );
        if (result.length === 0) continue;
        return { sourceKey: this.brokerSourceKey(candidate), value: result };
      } catch {
        // continue
      }
    }
    return null;
  }

  private async fetchProviderChartResolutionSupport(
    ticker: string,
    exchange?: string,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<ChartResolutionSupport[]> | null> {
    for (const provider of this.providersInPriorityOrder()) {
      if (!provider.getChartResolutionSupport && !provider.getChartResolutionCapabilities) continue;
      try {
        const result = provider.getChartResolutionSupport
          ? normalizeChartResolutionSupport(await provider.getChartResolutionSupport(ticker, exchange, context))
          : normalizeChartResolutionSupport(
            (await provider.getChartResolutionCapabilities!(ticker, exchange, context)).map((resolution) => ({ resolution, maxRange: "ALL" })),
          );
        if (result.length === 0) continue;
        return { sourceKey: this.providerSourceKey(provider), value: result };
      } catch (error) {
        if (shouldLogProviderError(error)) {
          providerLog.error(`${provider.id} failed: ${error}`);
        }
      }
    }

    return null;
  }

  private async fetchBrokerDetailedPriceHistory(
    ticker: string,
    exchange: string,
    startDate: Date,
    endDate: Date,
    barSize: string,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<PricePoint[]> | null> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKey = buildVariantKey([["exchange", normalizeExchange(exchange)], ["start", compactDate(startDate)], ["end", compactDate(endDate)], ["bar", barSize]]);
    for (const candidate of this.getBrokerCandidatesForContext(context, false)) {
      if (!candidate.broker.getDetailedPriceHistory) continue;
      try {
        const result = normalizePriceHistory(await candidate.broker.getDetailedPriceHistory(
          ticker,
          candidate.instance,
          exchange,
          startDate,
          endDate,
          barSize,
          context?.instrument ?? null,
        ));
        this.cacheResource(
          "detailed-price-history",
          entityKey,
          variantKey,
          this.brokerSourceKey(candidate),
          result,
          this.resolveBrokerPolicy("priceHistoryIntraday", candidate.broker),
        );
        return { sourceKey: this.brokerSourceKey(candidate), value: result };
      } catch {
        // continue
      }
    }
    return null;
  }

  private async fetchProviderDetailedPriceHistory(
    ticker: string,
    exchange: string,
    startDate: Date,
    endDate: Date,
    barSize: string,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<PricePoint[]> | null> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKey = buildVariantKey([["exchange", normalizeExchange(exchange)], ["start", compactDate(startDate)], ["end", compactDate(endDate)], ["bar", barSize]]);
    let firstEmptyResult: SourceResult<PricePoint[]> | null = null;

    for (const provider of this.providersInPriorityOrder()) {
      if (!provider.getDetailedPriceHistory) continue;
      try {
        const value = normalizePriceHistory(await provider.getDetailedPriceHistory(ticker, exchange, startDate, endDate, barSize, context));
        const sourceKey = this.providerSourceKey(provider);
        this.cacheResource(
          "detailed-price-history",
          entityKey,
          variantKey,
          sourceKey,
          value,
          this.resolveProviderPolicy("priceHistoryIntraday", provider),
        );
        if (value.length > 0) {
          return { sourceKey, value };
        }
        firstEmptyResult ??= { sourceKey, value };
      } catch (error) {
        if (shouldLogProviderError(error)) {
          providerLog.error(`${provider.id} failed: ${error}`);
        }
      }
    }

    return firstEmptyResult;
  }

  private async fetchBrokerOptionsChain(
    ticker: string,
    exchange?: string,
    expirationDate?: number,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<OptionsChain> | null> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKey = buildVariantKey([["exchange", normalizeExchange(exchange)], ["expiration", expirationDate ?? "default"]]);
    for (const candidate of this.getBrokerCandidatesForContext(context, false)) {
      if (!candidate.broker.getOptionsChain) continue;
      try {
        const result = await candidate.broker.getOptionsChain(
          ticker,
          candidate.instance,
          exchange,
          expirationDate,
          context?.instrument ?? null,
        );
        this.cacheResource(
          "options-chain",
          entityKey,
          variantKey,
          this.brokerSourceKey(candidate),
          result,
          this.resolveBrokerPolicy("optionsChain", candidate.broker),
        );
        return { sourceKey: this.brokerSourceKey(candidate), value: result };
      } catch {
        // continue
      }
    }
    return null;
  }

  private async fetchProviderOptionsChain(
    ticker: string,
    exchange?: string,
    expirationDate?: number,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<OptionsChain> | null> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKey = buildVariantKey([["exchange", normalizeExchange(exchange)], ["expiration", expirationDate ?? "default"]]);
    const result = await this.firstProvider(async (provider) => {
      if (!provider.getOptionsChain) return null;
      return provider.getOptionsChain(ticker, exchange, expirationDate, context);
    });
    if (!result) return null;
    const provider = this.resolveProviderBySourceKey(result.sourceKey);
    if (provider) {
      this.cacheResource("options-chain", entityKey, variantKey, result.sourceKey, result.value, this.resolveProviderPolicy("optionsChain", provider));
    }
    return result;
  }

  private async fetchProviderSecFilings(
    ticker: string,
    count = 15,
    exchange?: string,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<SecFilingItem[]> | null> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKey = buildVariantKey([["exchange", normalizeExchange(exchange)], ["count", count]]);
    let lastError: unknown = null;

    for (const provider of this.providersInPriorityOrder()) {
      if (!provider.getSecFilings) continue;
      try {
        const value = await provider.getSecFilings(ticker, count, exchange, context);
        const sourceKey = this.providerSourceKey(provider);
        this.cacheResource("sec-filings", entityKey, variantKey, sourceKey, value, this.resolveProviderPolicy("secFilings", provider));
        return { sourceKey, value };
      } catch (error) {
        lastError = error;
        if (shouldLogProviderError(error)) {
          providerLog.error(`${provider.id} failed: ${error}`);
        }
      }
    }

    if (lastError) throw lastError;
    return null;
  }

  private async fetchProviderSecFilingContent(filing: SecFilingItem): Promise<SourceResult<string | null> | null> {
    const entityKey = compactUrl(filing.primaryDocumentUrl ?? filing.filingUrl);
    let lastError: unknown = null;

    for (const provider of this.providersInPriorityOrder()) {
      if (!provider.getSecFilingContent) continue;
      try {
        const value = await provider.getSecFilingContent(filing);
        const sourceKey = this.providerSourceKey(provider);
        this.cacheResource("sec-filing-content", entityKey, "", sourceKey, value, this.resolveProviderPolicy("secFilingContent", provider));
        return { sourceKey, value };
      } catch (error) {
        lastError = error;
        if (shouldLogProviderError(error)) {
          providerLog.error(`${provider.id} failed: ${error}`);
        }
      }
    }

    if (lastError) throw lastError;
    return null;
  }

  private resolveProviderBySourceKey(sourceKey: string): DataProvider | null {
    for (const provider of this.providersInPriorityOrder()) {
      if (this.providerSourceKey(provider) === sourceKey) return provider;
    }
    return null;
  }

  private async revalidateFinancials(ticker: string, exchange?: string, context?: MarketDataRequestContext): Promise<void> {
    const brokerResult = await withBrokerTimeout(this.fetchBrokerFinancials(ticker, exchange, context));
    const needsProvider = !brokerResult || !hasMeaningfulFundamentals(brokerResult.value) || !hasMeaningfulProfile(brokerResult.value);
    if (needsProvider) {
      await this.fetchProviderFinancials(ticker, exchange, context);
    }
  }

  private async revalidateQuote(ticker: string, exchange?: string, context?: MarketDataRequestContext): Promise<void> {
    const brokerQuote = await withBrokerTimeout(this.fetchBrokerQuote(ticker, exchange, context));
    if (!brokerQuote) {
      await this.fetchProviderQuote(ticker, exchange, context);
    }
  }

  private async revalidateExchangeRate(fromCurrency: string): Promise<void> {
    const result = await this.firstProvider(async (provider) => {
      const rate = await provider.getExchangeRate(fromCurrency);
      return { provider, rate };
    });
    if (!result) return;
    this.cacheExchangeRate(fromCurrency, result.value.rate, result.value.provider);
  }

  private async revalidateNews(ticker: string, count = 15, exchange?: string, context?: MarketDataRequestContext): Promise<void> {
    const result = await this.firstProvider((provider) => provider.getNews(ticker, count, exchange, context));
    if (!result) return;
    const provider = this.resolveProviderBySourceKey(result.sourceKey);
    if (!provider) return;
    this.cacheResource(
      "news",
      this.getEntityKey(ticker, exchange, context?.instrument),
      buildVariantKey([["exchange", normalizeExchange(exchange)], ["count", count]]),
      result.sourceKey,
      result.value,
      this.resolveProviderPolicy("news", provider),
    );
  }

  private async revalidateSecFilings(ticker: string, count = 15, exchange?: string, context?: MarketDataRequestContext): Promise<void> {
    await this.fetchProviderSecFilings(ticker, count, exchange, context);
  }

  private async revalidateSecFilingContent(filing: SecFilingItem): Promise<void> {
    await this.fetchProviderSecFilingContent(filing);
  }

  private async revalidateArticleSummary(url: string): Promise<void> {
    const result = await this.firstProvider((provider) => provider.getArticleSummary(url));
    if (!result || !result.value) return;
    const provider = this.resolveProviderBySourceKey(result.sourceKey);
    if (provider) {
      this.cacheResource("article-summary", compactUrl(url), "", result.sourceKey, result.value, this.resolveProviderPolicy("articleSummary", provider));
    }
  }

  private async revalidatePriceHistory(ticker: string, exchange: string, range: TimeRange, context?: MarketDataRequestContext): Promise<void> {
    const brokerHistory = await withBrokerTimeout(this.fetchBrokerPriceHistory(ticker, exchange, range, context));
    if (!brokerHistory || brokerHistory.value.length === 0) {
      await this.fetchProviderPriceHistory(ticker, exchange, range, context);
    }
  }

  private async revalidateDetailedPriceHistory(
    ticker: string,
    exchange: string,
    startDate: Date,
    endDate: Date,
    barSize: string,
    context?: MarketDataRequestContext,
  ): Promise<void> {
    const brokerHistory = await withBrokerTimeout(this.fetchBrokerDetailedPriceHistory(ticker, exchange, startDate, endDate, barSize, context));
    if (!brokerHistory || brokerHistory.value.length === 0) {
      await this.fetchProviderDetailedPriceHistory(ticker, exchange, startDate, endDate, barSize, context);
    }
  }

  private async revalidateOptionsChain(
    ticker: string,
    exchange?: string,
    expirationDate?: number,
    context?: MarketDataRequestContext,
  ): Promise<void> {
    const brokerChain = await withBrokerTimeout(this.fetchBrokerOptionsChain(ticker, exchange, expirationDate, context));
    if (!brokerChain) {
      await this.fetchProviderOptionsChain(ticker, exchange, expirationDate, context);
    }
  }

  subscribeQuotes(
    targets: QuoteSubscriptionTarget[],
    onQuote: (target: QuoteSubscriptionTarget, quote: Quote) => void,
  ): () => void {
    const streamingProvider = this.providersInPriorityOrder().find((provider) => typeof provider.subscribeQuotes === "function") ?? null;
    const brokerGroups = new Map<string, { candidate: BrokerCandidate; targets: QuoteSubscriptionTarget[] }>();
    const providerTargets: QuoteSubscriptionTarget[] = [];
    const addBrokerTarget = (brokerCandidate: BrokerCandidate, target: QuoteSubscriptionTarget) => {
      const key = this.brokerSourceKey(brokerCandidate);
      const group = brokerGroups.get(key) ?? { candidate: brokerCandidate, targets: [] };
      group.targets.push(target);
      brokerGroups.set(key, group);
    };

    for (const target of targets) {
      if (target.route === "provider") {
        const brokerCandidate = this.getStreamingBrokerCandidate(target);
        if (streamingProvider) {
          providerTargets.push(target);
        } else if (brokerCandidate) {
          addBrokerTarget(brokerCandidate, target);
        }
        continue;
      }
      const brokerCandidate = this.getStreamingBrokerCandidate(target);
      if (target.route === "broker" && brokerCandidate) {
        addBrokerTarget(brokerCandidate, target);
        continue;
      }
      if (!brokerCandidate || streamingProvider) {
        providerTargets.push(target);
        continue;
      }

      addBrokerTarget(brokerCandidate, target);
    }

    const unsubscribers: Array<() => void> = [];

    for (const { candidate, targets: brokerTargets } of brokerGroups.values()) {
      providerLog.info("Delegating broker quote stream", {
        brokerId: candidate.brokerId,
        brokerInstanceId: candidate.brokerInstanceId,
        targetCount: brokerTargets.length,
      });
      unsubscribers.push(candidate.broker.subscribeQuotes!(candidate.instance, brokerTargets, onQuote));
    }

    if (providerTargets.length > 0 && streamingProvider?.subscribeQuotes) {
      providerLog.info("Delegating provider quote stream", {
        providerId: streamingProvider.id,
        targetCount: providerTargets.length,
      });
      unsubscribers.push(streamingProvider.subscribeQuotes(providerTargets, onQuote));
    }

    if (unsubscribers.length === 0) {
      providerLog.warn("No provider supports quote streaming", {
        targetCount: targets.length,
      });
      return () => {};
    }

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }
}
