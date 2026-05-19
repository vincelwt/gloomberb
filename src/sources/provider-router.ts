import type { CachedResourceRecord, ResourceStore } from "../data/resource-store";
import type { PluginRegistry } from "../plugins/registry";
import type { AssetDataCapability, NewsCapability } from "../capabilities";
import type { BrokerAdapter } from "../types/broker";
import type { AppConfig } from "../types/config";
import { createDefaultConfig } from "../types/config";
import type {
  CachedFinancialsTarget,
  DataProvider,
  MarketDataRequestContext,
  QuoteBatchResult,
  QuoteSubscriptionTarget,
  SearchRequestContext,
  SecFilingItem,
  TickerFinancialsBatchResult,
} from "../types/data-provider";
import type { CapabilityRouteSource } from "../types/capability-route-source";
import { routeSourcePriority } from "../types/capability-route-source";
import type { AnalystResearchData, CorporateActionsData, FinancialStatement, HolderData, OptionsChain, PricePoint, Quote, TickerFinancials } from "../types/financials";
import type { NewsArticle, NewsQuery } from "../news/types";
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
import { canonicalExchange } from "../utils/exchanges";
import { isPriceHistoryStaleForCurrentWindow, normalizePriceHistory, normalizeTickerFinancialsPriceHistory } from "../utils/price-history";
import { parseOptionSymbol } from "../utils/options";
import { isQuoteStaleForCurrentSession } from "../utils/quote-freshness";
import {
  mergeQuoteContributionMaps,
  resolveCanonicalQuote,
  resolveTickerFinancialsQuoteState,
  seedQuoteContributions,
} from "../utils/quote-resolution";
import { isProviderMiss } from "./provider-errors";

const providerLog = debugLog.createLogger("asset-data-router");

const BROKER_ATTEMPT_TIMEOUT = 10_000;
const EXPECTED_PROVIDER_MISS = /No data found|symbol may be delisted|"code":"Not Found"|No history for /i;
const MARKET_NAMESPACE = "market";
const SEARCH_CACHE_TTL_MS = 30_000;
const SEARCH_PROVIDER_TIMEOUT_MS = 5_000;

const DEFAULT_CACHE_POLICIES: Record<string, CachePolicy> = {
  brokerQuote: { staleMs: 15_000, expireMs: 15 * 60_000 },
  quote: { staleMs: 5 * 60_000, expireMs: 24 * 60 * 60_000 },
  financials: { staleMs: 60 * 60_000, expireMs: 7 * 24 * 60 * 60_000 },
  priceHistoryIntraday: { staleMs: 5 * 60_000, expireMs: 2 * 24 * 60 * 60_000 },
  priceHistoryDaily: { staleMs: 24 * 60 * 60_000, expireMs: 30 * 24 * 60 * 60_000 },
  news: { staleMs: 15 * 60_000, expireMs: 2 * 24 * 60 * 60_000 },
  holders: { staleMs: 24 * 60 * 60_000, expireMs: 7 * 24 * 60 * 60_000 },
  analystResearch: { staleMs: 24 * 60 * 60_000, expireMs: 7 * 24 * 60 * 60_000 },
  corporateActions: { staleMs: 24 * 60 * 60_000, expireMs: 14 * 24 * 60 * 60_000 },
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

function withSearchTimeout<T>(promise: Promise<T>): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), SEARCH_PROVIDER_TIMEOUT_MS);
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

function deriveMarketCapFromShares(
  financials: TickerFinancials,
  options: { replaceExisting?: boolean } = {},
): TickerFinancials {
  const quote = financials.quote;
  const sharesOutstanding = financials.fundamentals?.sharesOutstanding;
  if (
    !quote
    || (quote.marketCap != null && !options.replaceExisting)
    || !Number.isFinite(quote.price)
    || !Number.isFinite(sharesOutstanding)
    || quote.price <= 0
    || !sharesOutstanding
    || sharesOutstanding <= 0
  ) {
    return financials;
  }

  return {
    ...financials,
    quote: {
      ...quote,
      marketCap: quote.price * sharesOutstanding,
    },
  };
}

function sanitizeCachedFinancials(
  financials: TickerFinancials,
  options: { includeStaleQuotes?: boolean } = {},
): TickerFinancials {
  const enriched = deriveMarketCapFromShares(financials);
  if (options.includeStaleQuotes || !isQuoteStaleForCurrentSession(enriched.quote)) return enriched;
  return {
    ...enriched,
    quote: undefined,
    quoteContributions: undefined,
  };
}

function sanitizeCachedQuote(
  quote: Quote,
  exchange: string | undefined,
  options: { includeStaleQuotes?: boolean } = {},
): Quote | null {
  const normalized = quoteWithFreshnessExchange(quote, exchange);
  return options.includeStaleQuotes || !isQuoteStaleForCurrentSession(normalized)
    ? normalized
    : null;
}

function quoteWithFreshnessExchange(quote: Quote, exchange?: string): Quote {
  if (!exchange || quote.listingExchangeName || quote.exchangeName) return quote;
  return {
    ...quote,
    listingExchangeName: exchange,
    exchangeName: exchange,
  };
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

function isStaleIntradayHistory(points: PricePoint[], enabled: boolean, exchange?: string): boolean {
  return enabled && isPriceHistoryStaleForCurrentWindow(points, Date.now(), { exchange });
}

function isCurrentHistoryWindow(endDate?: Date): boolean {
  if (!endDate) return true;
  const endMs = endDate.getTime();
  return Number.isFinite(endMs) && Date.now() - endMs < 60 * 60_000;
}

function hasMeaningfulProfile(data: TickerFinancials | null | undefined): boolean {
  return !!data && !!(
    data.profile?.description
    || data.profile?.sector
    || data.profile?.industry
  );
}

function hasStatementRows(data: TickerFinancials | null | undefined): boolean {
  return !!data && (
    data.annualStatements.length > 0 ||
    data.quarterlyStatements.length > 0
  );
}

const DETAILED_STATEMENT_KEYS: Array<keyof FinancialStatement> = [
  "accountsReceivable",
  "inventory",
  "stockBasedCompensation",
  "purchaseOfPPE",
  "cashFlowFromContinuingOperatingActivities",
  "interestPaidSupplementalData",
  "accountsPayable",
  "currentDeferredRevenue",
  "additionalPaidInCapital",
  "totalNonCurrentAssets",
  "totalNonCurrentLiabilities",
];

function hasDetailedStatementRows(data: TickerFinancials | null | undefined): boolean {
  if (!data) return false;
  const rows = [...data.annualStatements, ...data.quarterlyStatements];
  return rows.some((row) => DETAILED_STATEMENT_KEYS.some((key) => typeof row[key] === "number"));
}

function mergeStatementRows(
  primaryRows: FinancialStatement[],
  fallbackRows: FinancialStatement[],
): FinancialStatement[] {
  if (primaryRows.length === 0) return fallbackRows;
  if (fallbackRows.length === 0) return primaryRows;

  const fallbackByDate = new Map(fallbackRows.map((row) => [row.date, row]));
  const primaryDates = new Set(primaryRows.map((row) => row.date));
  const mergedRows = primaryRows.map((row) => ({
    ...fallbackByDate.get(row.date),
    ...row,
    date: row.date,
  }));

  for (const row of fallbackRows) {
    if (!primaryDates.has(row.date)) mergedRows.push(row);
  }

  return mergedRows.sort((left, right) => left.date.localeCompare(right.date));
}

function mergeMissingStatementArrays(primary: TickerFinancials, fallback: TickerFinancials): TickerFinancials {
  return {
    ...primary,
    annualStatements: mergeStatementRows(primary.annualStatements, fallback.annualStatements),
    quarterlyStatements: mergeStatementRows(primary.quarterlyStatements, fallback.quarterlyStatements),
  };
}

function hasAnalystResearchValue(data: AnalystResearchData): boolean {
  return !!data.priceTarget
    || data.recommendations.length > 0
    || data.ratings.length > 0
    || data.earningsEstimates.length > 0
    || data.revenueEstimates.length > 0;
}

function hasAnalystRatingPriceTargets(data: AnalystResearchData): boolean {
  return data.ratings.some((rating) => (
    rating.currentPriceTarget != null || rating.priorPriceTarget != null
  ));
}

function isAnalystResearchMissingRatingTargets(data: AnalystResearchData): boolean {
  return data.ratings.length > 0 && !hasAnalystRatingPriceTargets(data);
}

function hasCorporateActionsValue(data: CorporateActionsData): boolean {
  return data.dividends.length > 0
    || data.splits.length > 0
    || data.earnings.length > 0;
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
    const resolved = single ? resolveTickerFinancialsQuoteState(normalizeTickerFinancialsPriceHistory(single)) : null;
    return resolved ? deriveMarketCapFromShares(resolved) : null;
  }

  const preferFallbackPriceData = hasLikelyPriceUnitMismatch(primary, fallback);
  const dominant = preferFallbackPriceData ? fallback : primary;
  const secondary = preferFallbackPriceData ? primary : fallback;
  const quoteContributions = mergeQuoteContributionMaps(
    seedQuoteContributions(primary),
    seedQuoteContributions(fallback),
  );
  const resolvedQuote = resolveCanonicalQuote(quoteContributions).quote;

  return deriveMarketCapFromShares({
    ...fallback,
    ...primary,
    quote: resolvedQuote,
    quoteContributions,
    profile: mergeDefinedObject(primary.profile, fallback.profile),
    fundamentals: mergeDefinedObject(primary.fundamentals, fallback.fundamentals),
    priceHistory: normalizePriceHistory(dominant.priceHistory.length > 0 ? dominant.priceHistory : secondary.priceHistory),
    annualStatements: mergeStatementRows(primary.annualStatements, fallback.annualStatements),
    quarterlyStatements: mergeStatementRows(primary.quarterlyStatements, fallback.quarterlyStatements),
  });
}

function mergeCachedFinancialRecords(
  records: CachedResourceRecord<TickerFinancials>[],
  options: { includeStaleQuotes?: boolean } = {},
): {
  value: TickerFinancials | null;
  stale: boolean;
} {
  const seenSources = new Set<string>();
  let merged: TickerFinancials | null = null;
  let stale = false;

  for (const record of records) {
    if (seenSources.has(record.sourceKey)) continue;
    seenSources.add(record.sourceKey);
    merged = mergeFinancials(merged, sanitizeCachedFinancials(record.value, options));
    stale = stale || record.stale === true;
  }

  return { value: merged, stale };
}

function selectCachedQuoteRecord(
  records: CachedResourceRecord<Quote>[],
  exchange: string | undefined,
  options: { includeStaleQuotes?: boolean } = {},
): CachedQuoteSelection {
  let stale = false;

  for (const record of records) {
    stale ||= record.stale === true;
    const quote = sanitizeCachedQuote(record.value, exchange, options);
    if (quote) return { quote, stale };
  }

  return { quote: null, stale };
}

interface CachedFinancialsSelection {
  brokerRecord: CachedResourceRecord<TickerFinancials> | null;
  providerValue: TickerFinancials | null;
  value: TickerFinancials | null;
  stale: boolean;
}

interface CachedFinancialsReadOptions {
  includeStaleQuotes?: boolean;
  includeSymbolProviderFallback?: boolean;
}

interface CachedQuoteSelection {
  quote: Quote | null;
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

type RouteSourceCapability = AssetDataCapability | NewsCapability;

function routeSourceFromMarketProvider(provider: DataProvider): CapabilityRouteSource {
  return {
    id: provider.id,
    name: provider.name,
    priority: provider.priority,
    cachePolicy: provider.cachePolicy,
    market: provider,
  };
}

function normalizeRouteSource(source: CapabilityRouteSource | DataProvider): CapabilityRouteSource {
  return "market" in source || "news" in source
    ? source as CapabilityRouteSource
    : routeSourceFromMarketProvider(source as DataProvider);
}

function capabilityRouteSourceId(capability: RouteSourceCapability): string {
  return capability.sourceId ?? capability.id;
}

function mergeCapabilityRouteSource(current: CapabilityRouteSource | undefined, capability: RouteSourceCapability): CapabilityRouteSource {
  const priority = Math.min(
    current?.priority ?? Number.MAX_SAFE_INTEGER,
    capability.priority ?? 1000,
  );
  return {
    id: capabilityRouteSourceId(capability),
    name: current?.name ?? capability.name,
    priority,
    cachePolicy: capability.cachePolicy ?? current?.cachePolicy,
    isEnabled: capability.isEnabled ?? current?.isEnabled,
    market: capability.kind === "asset-data" ? capability.provider : current?.market,
    news: capability.kind === "news" ? capability.provider : current?.news,
  };
}

export class AssetDataRouter implements DataProvider {
  readonly id = "asset-data-router";
  readonly name = "Asset Data Router";
  readonly priority = Number.MAX_SAFE_INTEGER;

  private registry: PluginRegistry | null = null;
  private readonly revalidationInFlight = new Map<string, Promise<unknown>>();
  private readonly searchCache = new Map<string, { expiresAt: number; results: InstrumentSearchResult[] }>();
  private readonly searchInFlight = new Map<string, Promise<InstrumentSearchResult[]>>();
  private getConfigFn: () => AppConfig = () => createDefaultConfig("");
  private readonly fallbackSource: CapabilityRouteSource | null;
  private readonly extraSources: CapabilityRouteSource[];

  constructor(
    fallbackSource: CapabilityRouteSource | DataProvider | null = null,
    extraSources: Array<CapabilityRouteSource | DataProvider> = [],
    private readonly resources?: ResourceStore,
  ) {
    this.fallbackSource = fallbackSource ? normalizeRouteSource(fallbackSource) : null;
    this.extraSources = extraSources.map(normalizeRouteSource);
  }

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

  getCachedFinancialsForTargets(
    targets: CachedFinancialsTarget[],
    options: { allowExpired?: boolean; includeStaleQuotes?: boolean } = {},
  ): Map<string, TickerFinancials> {
    const results = new Map<string, TickerFinancials>();
    for (const target of targets) {
      const cached = this.readCachedMergedFinancials(target.symbol, target.exchange, {
        brokerId: target.brokerId,
        brokerInstanceId: target.brokerInstanceId,
        instrument: target.instrument ?? undefined,
      }, options.allowExpired ?? true, {
        includeStaleQuotes: options.includeStaleQuotes,
        includeSymbolProviderFallback: true,
      });
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

  async getQuotesBatch(
    targets: QuoteSubscriptionTarget[],
    options: { forceRefresh?: boolean } = {},
  ): Promise<QuoteBatchResult[]> {
    const forceRefresh = options.forceRefresh === true;
    const results = new Array<QuoteBatchResult | null>(targets.length).fill(null);
    const misses: Array<{ index: number; target: QuoteSubscriptionTarget }> = [];

    targets.forEach((target, index) => {
      const context = target.context;
      const entityKey = this.getEntityKey(target.symbol, target.exchange, context?.instrument);
      const variantKeys = this.getTickerVariantCandidates(target.exchange);
      const sourceKeys = [
        ...this.getBrokerCandidatesForContext(context, false).map((candidate) => this.brokerSourceKey(candidate)),
        ...this.getProviderSourceKeys(),
      ];
      const rawCached = this.selectCachedResource<Quote>("quote", entityKey, variantKeys, sourceKeys, false);
      const cached = rawCached && !isQuoteStaleForCurrentSession(quoteWithFreshnessExchange(rawCached.value, target.exchange))
        ? rawCached
        : null;
      if (cached && !forceRefresh && !cached.stale) {
        results[index] = { target, quote: cached.value };
        return;
      }
      misses.push({ index, target });
    });

    const batchProvider = this.providersInPriorityOrder().find((provider) => provider.getQuotesBatch);
    const providerMisses = misses.filter(({ target }) => !this.hasBrokerContext(target.context));
    const providerIndexes = new Map<string, Array<{ index: number; target: QuoteSubscriptionTarget }>>();
    if (batchProvider && providerMisses.length > 0) {
      for (const entry of providerMisses) {
        const key = this.quoteBatchKey(entry.target);
        const bucket = providerIndexes.get(key) ?? [];
        bucket.push(entry);
        providerIndexes.set(key, bucket);
      }
      const uniqueTargets = [...providerIndexes.values()].map((bucket) => bucket[0]!.target);
      const batchResults = await batchProvider.getQuotesBatch!(uniqueTargets, options).catch(() => []);
      for (const item of batchResults) {
        if (!item.quote || isQuoteStaleForCurrentSession(item.quote)) continue;
        const key = this.quoteBatchKey(item.target);
        const sourceKey = this.providerSourceKey(batchProvider);
        for (const entry of providerIndexes.get(key) ?? []) {
          const entityKey = this.getEntityKey(entry.target.symbol, entry.target.exchange, entry.target.context?.instrument);
          const variantKey = this.getTickerVariantCandidates(entry.target.exchange)[0] ?? "";
          this.cacheResource("quote", entityKey, variantKey, sourceKey, item.quote, this.resolveProviderPolicy("quote", batchProvider));
          results[entry.index] = { target: entry.target, quote: item.quote };
        }
      }
    }

    await Promise.all(misses.map(async ({ index, target }) => {
      if (results[index]) return;
      try {
        const quote = await this.getQuote(target.symbol, target.exchange, {
          ...target.context,
          cacheMode: forceRefresh ? "refresh" : "default",
        });
        results[index] = { target, quote };
      } catch (error) {
        results[index] = { target, quote: null, error };
      }
    }));

    return results.map((result, index) => result ?? { target: targets[index]!, quote: null });
  }

  async getTickerFinancialsBatch(
    targets: CachedFinancialsTarget[],
    options: { forceRefresh?: boolean } = {},
  ): Promise<TickerFinancialsBatchResult[]> {
    const forceRefresh = options.forceRefresh === true;
    const results = new Array<TickerFinancialsBatchResult | null>(targets.length).fill(null);
    const misses: Array<{ index: number; target: CachedFinancialsTarget }> = [];

    targets.forEach((target, index) => {
      const context = this.contextFromCachedTarget(target);
      const cached = this.readCachedMergedFinancialsSelection(target.symbol, target.exchange, context, true);
      if (cached.value && !forceRefresh) {
        results[index] = { target, financials: cached.value };
        return;
      }
      misses.push({ index, target });
    });

    const batchProvider = this.providersInPriorityOrder().find((provider) => provider.getTickerFinancialsBatch);
    const providerMisses = misses.filter(({ target }) => !this.hasCachedTargetBrokerContext(target));
    const providerIndexes = new Map<string, Array<{ index: number; target: CachedFinancialsTarget }>>();
    if (batchProvider && providerMisses.length > 0) {
      for (const entry of providerMisses) {
        const key = this.cachedFinancialsBatchKey(entry.target);
        const bucket = providerIndexes.get(key) ?? [];
        bucket.push(entry);
        providerIndexes.set(key, bucket);
      }
      const uniqueTargets = [...providerIndexes.values()].map((bucket) => bucket[0]!.target);
      const batchResults = await batchProvider.getTickerFinancialsBatch!(uniqueTargets, options).catch(() => []);
      for (const item of batchResults) {
        if (!item.financials) continue;
        const key = this.cachedFinancialsBatchKey(item.target);
        const value = resolveTickerFinancialsQuoteState(normalizeTickerFinancialsPriceHistory(item.financials));
        if (!value) continue;
        const sourceKey = this.providerSourceKey(batchProvider);
        for (const entry of providerIndexes.get(key) ?? []) {
          const entityKey = this.getEntityKey(entry.target.symbol, entry.target.exchange, entry.target.instrument ?? undefined);
          const variantKey = this.getTickerVariantCandidates(entry.target.exchange)[0] ?? "";
          this.cacheResource("financials", entityKey, variantKey, sourceKey, value, this.resolveProviderPolicy("financials", batchProvider));
          results[entry.index] = { target: entry.target, financials: value };
        }
      }
    }

    await Promise.all(misses.map(async ({ index, target }) => {
      if (results[index]) return;
      try {
        const financials = await this.getTickerFinancials(target.symbol, target.exchange, {
          ...this.contextFromCachedTarget(target),
          cacheMode: forceRefresh ? "refresh" : "default",
        });
        results[index] = { target, financials };
      } catch (error) {
        results[index] = { target, financials: null, error };
      }
    }));

    return results.map((result, index) => result ?? { target: targets[index]!, financials: null });
  }

  async getTickerFinancials(ticker: string, exchange?: string, context?: MarketDataRequestContext): Promise<TickerFinancials> {
    const isOptionTicker =
      parseOptionSymbol(ticker) != null ||
      parseOptionSymbol(context?.instrument?.localSymbol ?? "") != null ||
      context?.instrument?.secType === "OPT";
    const quoteOnlyFinancials = async (base?: TickerFinancials | null): Promise<TickerFinancials> => ({
      ...base,
      quote: await this.getQuote(ticker, exchange, context),
      annualStatements: base?.annualStatements ?? [],
      quarterlyStatements: base?.quarterlyStatements ?? [],
      priceHistory: base?.priceHistory ?? [],
    });
    const cached = this.readCachedMergedFinancialsSelection(ticker, exchange, context, false);
    const forceRefresh = context?.cacheMode === "refresh";
    if (cached.value && !forceRefresh) {
      if (isOptionTicker && !cached.value.quote) {
        return quoteOnlyFinancials(cached.value);
      }
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
      const merged = mergeFinancials(
        brokerResult?.value ?? cached.brokerRecord?.value ?? null,
        providerResult?.value ?? cached.providerValue ?? null,
      );
      if (isOptionTicker && !merged?.quote) {
        return quoteOnlyFinancials(merged ?? cached.value);
      }
      return merged ?? cached.value;
    }

    const brokerResult = await withBrokerTimeout(this.fetchBrokerFinancials(ticker, exchange, context));
    const fallback = await this.fetchProviderFinancials(ticker, exchange, context);
    const merged = mergeFinancials(brokerResult?.value ?? null, fallback?.value ?? null);
    if (isOptionTicker && !merged?.quote) {
      return quoteOnlyFinancials(merged);
    }
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
    const rawCached = this.selectCachedResource<Quote>("quote", entityKey, variantKeys, sourceKeys, false);
    const cached = rawCached && !isQuoteStaleForCurrentSession(quoteWithFreshnessExchange(rawCached.value, exchange))
      ? rawCached
      : null;
    const forceRefresh = context?.cacheMode === "refresh";
    if (cached && !forceRefresh && !cached.stale) {
      return cached.value;
    }

    const brokerQuote = await withBrokerTimeout(this.fetchBrokerQuote(ticker, exchange, context));
    if (brokerQuote && !isQuoteStaleForCurrentSession(quoteWithFreshnessExchange(brokerQuote.value, exchange))) {
      return brokerQuote.value;
    }

    const providerQuote = await this.fetchProviderQuote(ticker, exchange, context);
    if (providerQuote) {
      return providerQuote.value;
    }
    if (cached) return cached.value;
    throw new Error(`No quote provider available for ${ticker}`);
  }

  async getExchangeRate(fromCurrency: string): Promise<number> {
    const normalizedCurrency = fromCurrency.trim().toUpperCase();
    if (normalizedCurrency === "USD") return 1;

    const cached = this.readCachedExchangeRate(normalizedCurrency, false);
    if (cached != null) {
      this.scheduleRevalidation(`exchange-rate:${normalizedCurrency}`, async () => {
        await this.revalidateExchangeRate(normalizedCurrency);
      });
      return cached;
    }

    const result = await this.firstProvider(async (provider) => {
      const rate = await provider.getExchangeRate(normalizedCurrency);
      return { provider, rate };
    });
    if (!result) {
      throw new Error(`No exchange rate provider available for ${normalizedCurrency}`);
    }
    this.cacheExchangeRate(normalizedCurrency, result.value.rate, result.value.provider);
    return result.value.rate;
  }

  async search(query: string, context?: SearchRequestContext): Promise<InstrumentSearchResult[]> {
    const cacheKey = JSON.stringify([
      query.trim().toUpperCase(),
      context?.preferBroker ?? true,
      context?.brokerInstanceId ?? "",
      context?.brokerId ?? "",
    ]);
    const cached = this.searchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.results;
    const inFlight = this.searchInFlight.get(cacheKey);
    if (inFlight) return inFlight;

    const task = (async () => {
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

      if (context?.preferBroker !== false) {
        for (const candidate of this.getBrokerCandidates(
          context?.brokerInstanceId,
          context?.brokerId,
        )) {
          if (!candidate.broker.searchInstruments) continue;
          try {
            const items = await withSearchTimeout(candidate.broker.searchInstruments(query, candidate.instance));
            if (!items) continue;
            push(this.annotateSearchResults(items, candidate));
            if (results.length > 0) {
              this.searchCache.set(cacheKey, {
                expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
                results,
              });
              return results;
            }
          } catch {
            // continue through broker candidates
          }
        }
      }

      for (const provider of this.providersInPriorityOrder()) {
        try {
          const items = await withSearchTimeout(provider.search(query, context));
          if (!items) continue;
          push(items);
          if (results.length > 0) {
            this.searchCache.set(cacheKey, {
              expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
              results,
            });
            return results;
          }
        } catch (error) {
          if (shouldLogProviderError(error)) {
            providerLog.error(`${provider.id} failed: ${error}`);
          }
        }
      }

      this.searchCache.set(cacheKey, {
        expiresAt: Date.now() + Math.min(SEARCH_CACHE_TTL_MS, 5_000),
        results,
      });
      return results;
    })().finally(() => {
      this.searchInFlight.delete(cacheKey);
    });

    this.searchInFlight.set(cacheKey, task);
    return task;
  }

  async getNews(query: NewsQuery): Promise<NewsArticle[]> {
    const sources = this.newsSourcesInPriorityOrder()
      .filter((source) => source.news?.supports?.(query) ?? true);
    const feed = query.feed ?? (query.scope === "ticker" ? "ticker" : "latest");
    if (feed === "ticker") {
      let firstEmpty: NewsArticle[] | null = null;
      for (const source of sources) {
        try {
          const articles = await source.news!.fetchNews(query);
          if (articles.length > 0) return articles;
          firstEmpty ??= articles;
        } catch (error) {
          if (shouldLogProviderError(error)) {
            providerLog.error(`${source.id} failed: ${error}`);
          }
        }
      }
      return firstEmpty ?? [];
    }

    const settled = await Promise.allSettled(sources.map((source) => source.news!.fetchNews(query)));
    return settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  }

  async getHolders(ticker: string, exchange?: string, context?: MarketDataRequestContext): Promise<HolderData> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKeys = this.getTickerVariantCandidates(exchange);
    const cached = this.selectCachedResource<HolderData>("holders", entityKey, variantKeys, this.getProviderSourceKeys(), false);
    const forceRefresh = context?.cacheMode === "refresh";
    if (cached && !forceRefresh) {
      this.scheduleRevalidation(this.makeRevalidationKey("holders", ticker, exchange, context), async () => {
        await this.revalidateHolders(ticker, exchange, context);
      });
      return cached.value;
    }

    const result = await this.fetchProviderHolders(ticker, exchange, context);
    if (result) return result.value;
    if (cached) return cached.value;
    throw new Error(`No holder data provider available for ${ticker}`);
  }

  async getAnalystResearch(ticker: string, exchange?: string, context?: MarketDataRequestContext): Promise<AnalystResearchData> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKeys = this.getTickerVariantCandidates(exchange);
    const cached = this.selectCachedAnalystResearch(entityKey, variantKeys, this.getProviderSourceKeys(), false);
    const forceRefresh = context?.cacheMode === "refresh";
    if (cached && !forceRefresh && !isAnalystResearchMissingRatingTargets(cached.value)) {
      this.scheduleRevalidation(this.makeRevalidationKey("analystResearch", ticker, exchange, context), async () => {
        await this.revalidateAnalystResearch(ticker, exchange, context);
      });
      return cached.value;
    }

    const result = await this.fetchProviderAnalystResearch(ticker, exchange, context);
    if (result) return result.value;
    if (cached) return cached.value;
    throw new Error(`No analyst research provider available for ${ticker}`);
  }

  async getCorporateActions(ticker: string, exchange?: string, context?: MarketDataRequestContext): Promise<CorporateActionsData> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKeys = this.getTickerVariantCandidates(exchange);
    const cached = this.selectCachedResource<CorporateActionsData>("corporateActions", entityKey, variantKeys, this.getProviderSourceKeys(), false);
    const forceRefresh = context?.cacheMode === "refresh";
    if (cached && !forceRefresh) {
      this.scheduleRevalidation(this.makeRevalidationKey("corporateActions", ticker, exchange, context), async () => {
        await this.revalidateCorporateActions(ticker, exchange, context);
      });
      return cached.value;
    }

    const result = await this.fetchProviderCorporateActions(ticker, exchange, context);
    if (result) return result.value;
    if (cached) return cached.value;
    throw new Error(`No corporate actions provider available for ${ticker}`);
  }

  async getSecFilings(ticker: string, count = 15, exchange?: string, context?: MarketDataRequestContext): Promise<SecFilingItem[]> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKeys = [
      buildVariantKey([["exchange", canonicalExchange(exchange)], ["count", count]]),
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
      buildVariantKey([["exchange", canonicalExchange(exchange)], ["range", range]]),
      buildVariantKey([["range", range]]),
    ];
    const sourceKeys = [
      ...this.getBrokerCandidatesForContext(context, false).map((candidate) => this.brokerSourceKey(candidate)),
      ...this.getProviderSourceKeys(),
    ];
    const cached = this.selectCachedArrayResource<PricePoint>("price-history", entityKey, variantKeys, sourceKeys, false);
    const cachedValue = cached ? normalizePriceHistory(cached.value) : [];
    const cachedHistoryStale = isStaleIntradayHistory(cachedValue, isIntradayRange(range), exchange);
    const forceRefresh = context?.cacheMode === "refresh";
    if (cachedValue.length > 0 && !forceRefresh && cached && !cached.stale && !cachedHistoryStale) {
      return cachedValue;
    }

    const brokerHistory = await withBrokerTimeout(this.fetchBrokerPriceHistory(ticker, exchange, range, context));
    if (brokerHistory && brokerHistory.value.length > 0) return brokerHistory.value;

    const providerHistory = await this.fetchProviderPriceHistory(ticker, exchange, range, context);
    if (providerHistory && providerHistory.value.length > 0) {
      return providerHistory.value;
    }
    if (cachedValue.length > 0 && !cachedHistoryStale) return cachedValue;
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
      buildVariantKey([["exchange", canonicalExchange(exchange)], ["range", bufferRange], ["resolution", resolution]]),
      buildVariantKey([["range", bufferRange], ["resolution", resolution]]),
    ];
    const sourceKeys = [
      ...this.getBrokerCandidatesForContext(context, false).map((candidate) => this.brokerSourceKey(candidate)),
      ...this.getProviderSourceKeys(),
    ];
    const cached = this.selectCachedArrayResource<PricePoint>("price-history", entityKey, variantKeys, sourceKeys, false);
    const cachedValue = cached ? normalizePriceHistory(cached.value) : [];
    const cachedHistoryStale = isStaleIntradayHistory(cachedValue, isIntradayResolution(resolution), exchange);
    const forceRefresh = context?.cacheMode === "refresh";
    if (cachedValue.length > 0 && !forceRefresh && cached && !cached.stale && !cachedHistoryStale) {
      return cachedValue;
    }

    const brokerHistory = await withBrokerTimeout(this.fetchBrokerPriceHistoryForResolution(ticker, exchange, bufferRange, resolution, context));
    if (brokerHistory && brokerHistory.value.length > 0) return brokerHistory.value;

    const providerHistory = await this.fetchProviderPriceHistoryForResolution(ticker, exchange, bufferRange, resolution, context);
    if (providerHistory && providerHistory.value.length > 0) {
      return providerHistory.value;
    }
    if (cachedValue.length > 0 && !cachedHistoryStale) return cachedValue;
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
      buildVariantKey([["exchange", canonicalExchange(exchange)], ["start", compactDate(startDate)], ["end", compactDate(endDate)], ["bar", barSize]]),
      buildVariantKey([["start", compactDate(startDate)], ["end", compactDate(endDate)], ["bar", barSize]]),
    ];
    const sourceKeys = [
      ...this.getBrokerCandidatesForContext(context, false).map((candidate) => this.brokerSourceKey(candidate)),
      ...this.getProviderSourceKeys(),
    ];
    const cached = this.selectCachedArrayResource<PricePoint>("detailed-price-history", entityKey, variantKeys, sourceKeys, false);
    const cachedValue = cached ? normalizePriceHistory(cached.value) : [];
    const isCurrentWindow = isCurrentHistoryWindow(endDate);
    const cachedHistoryStale = isCurrentWindow && isPriceHistoryStaleForCurrentWindow(cachedValue, Date.now(), { exchange });
    const forceRefresh = context?.cacheMode === "refresh";
    if (cachedValue.length > 0 && !forceRefresh && cached && !cached.stale && !cachedHistoryStale) {
      return cachedValue;
    }

    const brokerResult = await withBrokerTimeout(this.fetchBrokerDetailedPriceHistory(ticker, exchange, startDate, endDate, barSize, context));
    if (brokerResult && brokerResult.value.length > 0) return brokerResult.value;

    const providerResult = await this.fetchProviderDetailedPriceHistory(ticker, exchange, startDate, endDate, barSize, context);
    if (providerResult && providerResult.value.length > 0) {
      return providerResult.value;
    }
    return cachedValue.length > 0 && !cachedHistoryStale ? cachedValue : (providerResult?.value ?? []);
  }

  async getOptionsChain(ticker: string, exchange?: string, expirationDate?: number, context?: MarketDataRequestContext): Promise<OptionsChain> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKeys = [
      buildVariantKey([["exchange", canonicalExchange(exchange)], ["expiration", expirationDate ?? "default"]]),
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
    const normalizedExchange = canonicalExchange(exchange);
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

    return this.sortCachedRecords(records, variantKeys, sourceKeys);
  }

  private sortCachedRecords<T>(
    records: CachedResourceRecord<T>[],
    variantKeys: string[],
    sourceKeys: string[],
  ): CachedResourceRecord<T>[] {
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
    return this.listCachedResources<T>(kind, entityKey, variantKeys, sourceKeys, allowExpired)[0] ?? null;
  }

  private selectCachedAnalystResearch(
    entityKey: string,
    variantKeys: string[],
    sourceKeys: string[],
    allowExpired: boolean,
  ): CachedResourceRecord<AnalystResearchData> | null {
    const records = this.listCachedResources<AnalystResearchData>("analystResearch", entityKey, variantKeys, sourceKeys, allowExpired);
    return records.find((record) => !isAnalystResearchMissingRatingTargets(record.value)) ?? records[0] ?? null;
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
    options: CachedFinancialsReadOptions = {},
  ): TickerFinancials | null {
    return this.readCachedMergedFinancialsSelection(ticker, exchange, context, allowExpired, options).value;
  }

  private readCachedMergedFinancialsSelection(
    ticker: string,
    exchange?: string,
    context?: MarketDataRequestContext,
    allowExpired = false,
    options: CachedFinancialsReadOptions = {},
  ): CachedFinancialsSelection {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKeys = this.getTickerVariantCandidates(exchange);
    const brokerSourceKeys = this.getBrokerCandidatesForContext(context, false).map((candidate) => this.brokerSourceKey(candidate));
    const brokerRecord = brokerSourceKeys.length > 0
      ? this.selectCachedResource<TickerFinancials>("financials", entityKey, variantKeys, brokerSourceKeys, allowExpired)
      : null;
    const sanitizedBrokerRecord = brokerRecord
      ? { ...brokerRecord, value: sanitizeCachedFinancials(brokerRecord.value, options) }
      : null;
    const providerSourceKeys = this.getProviderSourceKeys();
    const providerEntityKeys = options.includeSymbolProviderFallback
      ? [...new Set([entityKey, normalizeTicker(ticker)])]
      : [entityKey];
    const providerRecords = this.sortCachedRecords(
      providerEntityKeys.flatMap((providerEntityKey) => this.listCachedResources<TickerFinancials>(
        "financials",
        providerEntityKey,
        variantKeys,
        providerSourceKeys,
        allowExpired,
      )),
      variantKeys,
      providerSourceKeys,
    );
    const providerSelection = mergeCachedFinancialRecords(
      providerRecords,
      options,
    );
    const quoteSourceKeys = [...brokerSourceKeys, ...providerSourceKeys];
    const quoteRecords = this.sortCachedRecords(
      providerEntityKeys.flatMap((quoteEntityKey) => this.listCachedResources<Quote>(
        "quote",
        quoteEntityKey,
        variantKeys,
        quoteSourceKeys,
        allowExpired,
      )),
      variantKeys,
      quoteSourceKeys,
    );
    const quoteSelection = selectCachedQuoteRecord(quoteRecords, exchange, options);
    const mergedValue = mergeFinancials(sanitizedBrokerRecord?.value ?? null, providerSelection.value);
    const value = quoteSelection.quote
      ? resolveTickerFinancialsQuoteState(mergedValue, quoteSelection.quote)
      : mergedValue;
    return {
      brokerRecord: sanitizedBrokerRecord,
      providerValue: providerSelection.value,
      value: value
        ? deriveMarketCapFromShares(value, { replaceExisting: !!quoteSelection.quote && quoteSelection.quote.marketCap == null })
        : null,
      stale: (sanitizedBrokerRecord?.stale ?? false) || providerSelection.stale || quoteSelection.stale,
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

  private hasBrokerContext(context?: MarketDataRequestContext): boolean {
    return !!(
      context?.brokerId ||
      context?.brokerInstanceId ||
      context?.instrument?.brokerId ||
      context?.instrument?.brokerInstanceId
    );
  }

  private hasCachedTargetBrokerContext(target: CachedFinancialsTarget): boolean {
    return !!(
      target.brokerId ||
      target.brokerInstanceId ||
      target.instrument?.brokerId ||
      target.instrument?.brokerInstanceId
    );
  }

  private contextFromCachedTarget(target: CachedFinancialsTarget): MarketDataRequestContext {
    return {
      brokerId: target.brokerId,
      brokerInstanceId: target.brokerInstanceId,
      instrument: target.instrument ?? null,
    };
  }

  private quoteBatchKey(target: QuoteSubscriptionTarget): string {
    return `${target.symbol.trim().toUpperCase()}:${canonicalExchange(target.exchange ?? "")}`;
  }

  private cachedFinancialsBatchKey(target: CachedFinancialsTarget): string {
    return `${target.symbol.trim().toUpperCase()}:${canonicalExchange(target.exchange ?? "")}`;
  }

  private getStreamingBrokerCandidate(target: QuoteSubscriptionTarget): BrokerCandidate | null {
    if (!this.hasBrokerContext(target.context)) return null;
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

  private sortedSources(): CapabilityRouteSource[] {
    const sources = [...this.extraSources];
    if (this.registry) {
      const capabilitySources = new Map<string, CapabilityRouteSource>();
      for (const capability of this.registry.getEnabledCapabilities("asset-data") as AssetDataCapability[]) {
        const sourceId = capabilityRouteSourceId(capability);
        capabilitySources.set(sourceId, mergeCapabilityRouteSource(capabilitySources.get(sourceId), capability));
      }
      for (const capability of this.registry.getEnabledCapabilities("news") as NewsCapability[]) {
        const sourceId = capabilityRouteSourceId(capability);
        capabilitySources.set(sourceId, mergeCapabilityRouteSource(capabilitySources.get(sourceId), capability));
      }
      sources.push(...capabilitySources.values());
    }
    return sources
      .filter((source) => source.id !== this.id && source.id !== this.fallbackSource?.id)
      .sort((a, b) => routeSourcePriority(a) - routeSourcePriority(b));
  }

  private sortedProviders(): DataProvider[] {
    return this.sortedSources()
      .map((source) => source.market)
      .filter((provider): provider is DataProvider => !!provider);
  }

  private providersInPriorityOrder(): DataProvider[] {
    const providers = [...this.sortedProviders()];
    const fallbackProvider = this.fallbackSource?.market ?? null;
    if (fallbackProvider && !providers.some((provider) => provider.id === fallbackProvider.id)) {
      providers.push(fallbackProvider);
    }
    return providers;
  }

  private newsSourcesInPriorityOrder(): CapabilityRouteSource[] {
    const sources = this.sortedSources().filter((source) => !!source.news);
    if (this.fallbackSource?.news && !sources.some((source) => source.id === this.fallbackSource?.id)) {
      sources.push(this.fallbackSource);
    }
    return sources;
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
        const rawResult = await candidate.broker.getTickerFinancials(
          ticker,
          candidate.instance,
          exchange,
          context?.instrument ?? null,
        );
        const result = resolveTickerFinancialsQuoteState(normalizeTickerFinancialsPriceHistory(rawResult));
        if (!result) continue;
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
    let primaryResult: SourceResult<TickerFinancials> | null = null;

    for (const provider of this.providersInPriorityOrder()) {
      try {
        const rawValue = await provider.getTickerFinancials(ticker, exchange, context);
        const value = resolveTickerFinancialsQuoteState(normalizeTickerFinancialsPriceHistory(rawValue));
        if (!value) continue;
        const sourceKey = this.providerSourceKey(provider);
        const cacheValue = primaryResult
          ? {
            annualStatements: value.annualStatements,
            quarterlyStatements: value.quarterlyStatements,
            priceHistory: [],
          }
          : value;
        this.cacheResource(
          "financials",
          entityKey,
          variantKey,
          sourceKey,
          cacheValue,
          this.resolveProviderPolicy("financials", provider),
        );
        if (!primaryResult) {
          primaryResult = { sourceKey, value };
          if (hasDetailedStatementRows(value)) return primaryResult;
          continue;
        }
        if (hasStatementRows(value)) {
          primaryResult = {
            sourceKey: primaryResult.sourceKey,
            value: mergeMissingStatementArrays(primaryResult.value, value),
          };
          if (hasDetailedStatementRows(primaryResult.value)) return primaryResult;
        }
      } catch (error) {
        if (shouldLogProviderError(error)) {
          providerLog.error(`${provider.id} failed: ${error}`);
        }
      }
    }

    return primaryResult;
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
    for (const provider of this.providersInPriorityOrder()) {
      try {
        const quote = await provider.getQuote(ticker, exchange, context);
        if (quote == null || isQuoteStaleForCurrentSession(quote)) continue;
        const sourceKey = this.providerSourceKey(provider);
        this.cacheResource("quote", entityKey, variantKey, sourceKey, quote, this.resolveProviderPolicy("quote", provider));
        return { sourceKey, value: quote };
      } catch (err) {
        if (shouldLogProviderError(err)) {
          providerLog.error(`${provider.id} failed: ${err}`);
        }
      }
    }
    return null;
  }

  private async fetchBrokerPriceHistory(
    ticker: string,
    exchange: string,
    range: TimeRange,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<PricePoint[]> | null> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKey = buildVariantKey([["exchange", canonicalExchange(exchange)], ["range", range]]);
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
        if (isStaleIntradayHistory(result, isIntradayRange(range), exchange)) continue;
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
    const variantKey = buildVariantKey([["exchange", canonicalExchange(exchange)], ["range", bufferRange], ["resolution", resolution]]);
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
        if (isStaleIntradayHistory(result, isIntradayResolution(resolution), exchange)) continue;
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
    const variantKey = buildVariantKey([["exchange", canonicalExchange(exchange)], ["range", range]]);
    let firstEmptyResult: SourceResult<PricePoint[]> | null = null;

    for (const provider of this.providersInPriorityOrder()) {
      try {
        const value = normalizePriceHistory(await provider.getPriceHistory(ticker, exchange, range, context));
        if (isStaleIntradayHistory(value, isIntradayRange(range), exchange)) continue;
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
    const variantKey = buildVariantKey([["exchange", canonicalExchange(exchange)], ["range", bufferRange], ["resolution", resolution]]);
    let firstEmptyResult: SourceResult<PricePoint[]> | null = null;

    for (const provider of this.providersInPriorityOrder()) {
      if (!provider.getPriceHistoryForResolution) continue;
      try {
        const value = normalizePriceHistory(await provider.getPriceHistoryForResolution(ticker, exchange, bufferRange, resolution, context));
        if (isStaleIntradayHistory(value, isIntradayResolution(resolution), exchange)) continue;
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
    const variantKey = buildVariantKey([["exchange", canonicalExchange(exchange)], ["start", compactDate(startDate)], ["end", compactDate(endDate)], ["bar", barSize]]);
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
        if (isCurrentHistoryWindow(endDate) && isPriceHistoryStaleForCurrentWindow(result, Date.now(), { exchange })) continue;
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
    const variantKey = buildVariantKey([["exchange", canonicalExchange(exchange)], ["start", compactDate(startDate)], ["end", compactDate(endDate)], ["bar", barSize]]);
    let firstEmptyResult: SourceResult<PricePoint[]> | null = null;

    for (const provider of this.providersInPriorityOrder()) {
      if (!provider.getDetailedPriceHistory) continue;
      try {
        const value = normalizePriceHistory(await provider.getDetailedPriceHistory(ticker, exchange, startDate, endDate, barSize, context));
        if (isCurrentHistoryWindow(endDate) && isPriceHistoryStaleForCurrentWindow(value, Date.now(), { exchange })) continue;
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
    const variantKey = buildVariantKey([["exchange", canonicalExchange(exchange)], ["expiration", expirationDate ?? "default"]]);
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
    const variantKey = buildVariantKey([["exchange", canonicalExchange(exchange)], ["expiration", expirationDate ?? "default"]]);
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

  private async fetchProviderHolders(
    ticker: string,
    exchange?: string,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<HolderData> | null> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKey = this.getTickerVariantCandidates(exchange)[0] ?? "";
    let firstEmptyResult: SourceResult<HolderData> | null = null;
    let lastError: unknown = null;

    for (const provider of this.providersInPriorityOrder()) {
      if (!provider.getHolders) continue;
      try {
        const value = await provider.getHolders(ticker, exchange, context);
        const sourceKey = this.providerSourceKey(provider);
        this.cacheResource("holders", entityKey, variantKey, sourceKey, value, this.resolveProviderPolicy("holders", provider));
        if (value.holders.length > 0) return { sourceKey, value };
        firstEmptyResult ??= { sourceKey, value };
      } catch (error) {
        lastError = error;
        if (shouldLogProviderError(error)) {
          providerLog.error(`${provider.id} failed: ${error}`);
        }
      }
    }

    if (firstEmptyResult) return firstEmptyResult;
    if (lastError) throw lastError;
    return null;
  }

  private async fetchProviderAnalystResearch(
    ticker: string,
    exchange?: string,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<AnalystResearchData> | null> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKey = this.getTickerVariantCandidates(exchange)[0] ?? "";
    let firstEmptyResult: SourceResult<AnalystResearchData> | null = null;
    let firstIncompleteResult: SourceResult<AnalystResearchData> | null = null;
    let lastError: unknown = null;

    for (const provider of this.providersInPriorityOrder()) {
      if (!provider.getAnalystResearch) continue;
      try {
        const value = await provider.getAnalystResearch(ticker, exchange, context);
        const sourceKey = this.providerSourceKey(provider);
        this.cacheResource("analystResearch", entityKey, variantKey, sourceKey, value, this.resolveProviderPolicy("analystResearch", provider));
        if (hasAnalystResearchValue(value)) {
          if (isAnalystResearchMissingRatingTargets(value)) {
            firstIncompleteResult ??= { sourceKey, value };
            continue;
          }
          return { sourceKey, value };
        }
        firstEmptyResult ??= { sourceKey, value };
      } catch (error) {
        lastError = error;
        if (shouldLogProviderError(error)) {
          providerLog.error(`${provider.id} failed: ${error}`);
        }
      }
    }

    if (firstIncompleteResult) return firstIncompleteResult;
    if (firstEmptyResult) return firstEmptyResult;
    if (lastError) throw lastError;
    return null;
  }

  private async fetchProviderCorporateActions(
    ticker: string,
    exchange?: string,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<CorporateActionsData> | null> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKey = this.getTickerVariantCandidates(exchange)[0] ?? "";
    let firstEmptyResult: SourceResult<CorporateActionsData> | null = null;
    let lastError: unknown = null;

    for (const provider of this.providersInPriorityOrder()) {
      if (!provider.getCorporateActions) continue;
      try {
        const value = await provider.getCorporateActions(ticker, exchange, context);
        const sourceKey = this.providerSourceKey(provider);
        this.cacheResource("corporateActions", entityKey, variantKey, sourceKey, value, this.resolveProviderPolicy("corporateActions", provider));
        if (hasCorporateActionsValue(value)) return { sourceKey, value };
        firstEmptyResult ??= { sourceKey, value };
      } catch (error) {
        lastError = error;
        if (shouldLogProviderError(error)) {
          providerLog.error(`${provider.id} failed: ${error}`);
        }
      }
    }

    if (firstEmptyResult) return firstEmptyResult;
    if (lastError) throw lastError;
    return null;
  }

  private async fetchProviderSecFilings(
    ticker: string,
    count = 15,
    exchange?: string,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<SecFilingItem[]> | null> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKey = buildVariantKey([["exchange", canonicalExchange(exchange)], ["count", count]]);
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

  private async revalidateExchangeRate(fromCurrency: string): Promise<void> {
    const normalizedCurrency = fromCurrency.trim().toUpperCase();
    if (normalizedCurrency === "USD") return;

    const result = await this.firstProvider(async (provider) => {
      const rate = await provider.getExchangeRate(normalizedCurrency);
      return { provider, rate };
    });
    if (!result) return;
    this.cacheExchangeRate(normalizedCurrency, result.value.rate, result.value.provider);
  }

  private async revalidateSecFilings(ticker: string, count = 15, exchange?: string, context?: MarketDataRequestContext): Promise<void> {
    await this.fetchProviderSecFilings(ticker, count, exchange, context);
  }

  private async revalidateHolders(ticker: string, exchange?: string, context?: MarketDataRequestContext): Promise<void> {
    await this.fetchProviderHolders(ticker, exchange, context);
  }

  private async revalidateAnalystResearch(ticker: string, exchange?: string, context?: MarketDataRequestContext): Promise<void> {
    await this.fetchProviderAnalystResearch(ticker, exchange, context);
  }

  private async revalidateCorporateActions(ticker: string, exchange?: string, context?: MarketDataRequestContext): Promise<void> {
    await this.fetchProviderCorporateActions(ticker, exchange, context);
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
