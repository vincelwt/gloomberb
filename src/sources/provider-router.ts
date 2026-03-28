import type { CachedResourceRecord, ResourceStore } from "../data/resource-store";
import type { PluginRegistry } from "../plugins/registry";
import type { BrokerAdapter } from "../types/broker";
import type { AppConfig } from "../types/config";
import { createDefaultConfig } from "../types/config";
import type { DataProvider, MarketDataRequestContext, NewsItem, SearchRequestContext } from "../types/data-provider";
import type { OptionsChain, PricePoint, Quote, TickerFinancials } from "../types/financials";
import type { BrokerContractRef, InstrumentSearchResult } from "../types/instrument";
import type { CachePolicy, CachePolicyMap } from "../types/persistence";
import type { TimeRange } from "../components/chart/chart-types";
import type { HydrationTarget } from "../state/session-persistence";

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

function buildVariantKey(parts: Array<[string, string | number | undefined | null]>): string {
  return parts
    .filter(([, value]) => value !== undefined && value !== null && String(value).length > 0)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(";");
}

function isIntradayRange(range: TimeRange): boolean {
  return range === "1W" || range === "1M" || range === "3M";
}

function hasMeaningfulFundamentals(data: TickerFinancials | null | undefined): boolean {
  return !!data && Object.keys(data.fundamentals ?? {}).length > 0;
}

function mergeFinancials(primary: TickerFinancials | null, fallback: TickerFinancials | null): TickerFinancials | null {
  if (primary && hasMeaningfulFundamentals(primary)) return primary;
  if (primary && fallback) {
    return {
      ...fallback,
      ...primary,
      quote: primary.quote ?? fallback.quote,
      priceHistory: primary.priceHistory.length > 0 ? primary.priceHistory : fallback.priceHistory,
      fundamentals: fallback.fundamentals ?? primary.fundamentals ?? {},
      annualStatements: fallback.annualStatements.length > 0 ? fallback.annualStatements : primary.annualStatements,
      quarterlyStatements: fallback.quarterlyStatements.length > 0 ? fallback.quarterlyStatements : primary.quarterlyStatements,
    };
  }
  return primary ?? fallback;
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
    private readonly fallbackProvider: DataProvider,
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
    if (this.fallbackProvider.canProvide) {
      return this.fallbackProvider.canProvide(ticker, exchange, context);
    }
    return true;
  }

  getCachedFinancialsForTargets(targets: HydrationTarget[], options: { allowExpired?: boolean } = {}): Map<string, TickerFinancials> {
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
    const cached = this.readCachedMergedFinancials(ticker, exchange, context, false);
    if (cached) {
      this.scheduleRevalidation(this.makeRevalidationKey("financials", ticker, exchange, context), async () => {
        await this.revalidateFinancials(ticker, exchange, context);
      });
      return cached;
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
      ...this.getBrokerCandidatesForContext(context).map((candidate) => this.brokerSourceKey(candidate)),
      ...this.getProviderSourceKeys(),
    ];
    const cached = this.selectCachedResource<Quote>("quote", entityKey, variantKeys, sourceKeys, false);
    if (cached) {
      this.scheduleRevalidation(this.makeRevalidationKey("quote", ticker, exchange, context), async () => {
        await this.revalidateQuote(ticker, exchange, context);
      });
      return cached.value;
    }

    const brokerQuote = await withBrokerTimeout(this.fetchBrokerQuote(ticker, exchange, context));
    if (brokerQuote) return brokerQuote.value;

    const providerQuote = await this.fetchProviderQuote(ticker, exchange, context);
    if (!providerQuote) {
      throw new Error(`No quote provider available for ${ticker}`);
    }
    return providerQuote.value;
  }

  async getExchangeRate(fromCurrency: string): Promise<number> {
    const cached = this.readCachedExchangeRate(fromCurrency, false);
    if (cached != null) {
      this.scheduleRevalidation(`exchange-rate:${fromCurrency.toUpperCase()}`, async () => {
        await this.revalidateExchangeRate(fromCurrency);
      });
      return cached;
    }

    const provider = [...this.sortedProviders(), this.fallbackProvider][0] ?? this.fallbackProvider;
    const rate = await provider.getExchangeRate(fromCurrency);
    this.cacheExchangeRate(fromCurrency, rate, provider);
    return rate;
  }

  async search(query: string, context?: SearchRequestContext): Promise<InstrumentSearchResult[]> {
    const results: InstrumentSearchResult[] = [];
    const seen = new Set<string>();

    const push = (items: InstrumentSearchResult[]) => {
      for (const item of items) {
        const key = `${item.symbol}|${item.exchange}|${item.type}|${item.providerId}|${item.brokerInstanceId ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(item);
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

    for (const provider of [...this.sortedProviders(), this.fallbackProvider]) {
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

    const provider = [...this.sortedProviders(), this.fallbackProvider][0] ?? this.fallbackProvider;
    const items = await provider.getNews(ticker, count, exchange, context);
    this.cacheResource("news", entityKey, variantKeys[0] ?? "", this.providerSourceKey(provider), items, this.resolveProviderPolicy("news", provider));
    return items;
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

    const provider = [...this.sortedProviders(), this.fallbackProvider][0] ?? this.fallbackProvider;
    const summary = await provider.getArticleSummary(url);
    if (summary) {
      this.cacheResource("article-summary", entityKey, "", this.providerSourceKey(provider), summary, this.resolveProviderPolicy("articleSummary", provider));
    }
    return summary;
  }

  async getPriceHistory(ticker: string, exchange: string, range: TimeRange, context?: MarketDataRequestContext): Promise<PricePoint[]> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKeys = [
      buildVariantKey([["exchange", normalizeExchange(exchange)], ["range", range]]),
      buildVariantKey([["range", range]]),
    ];
    const sourceKeys = [
      ...this.getBrokerCandidatesForContext(context).map((candidate) => this.brokerSourceKey(candidate)),
      ...this.getProviderSourceKeys(),
    ];
    const cached = this.selectCachedResource<PricePoint[]>("price-history", entityKey, variantKeys, sourceKeys, false);
    if (cached) {
      this.scheduleRevalidation(this.makeRevalidationKey("price-history", ticker, exchange, context, range), async () => {
        await this.revalidatePriceHistory(ticker, exchange, range, context);
      });
      return cached.value;
    }

    const brokerHistory = await withBrokerTimeout(this.fetchBrokerPriceHistory(ticker, exchange, range, context));
    if (brokerHistory && brokerHistory.value.length > 0) return brokerHistory.value;

    const providerHistory = await this.fetchProviderPriceHistory(ticker, exchange, range, context);
    if (!providerHistory) {
      throw new Error(`No history provider available for ${ticker}`);
    }
    return providerHistory.value;
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
      ...this.getBrokerCandidatesForContext(context).map((candidate) => this.brokerSourceKey(candidate)),
      ...this.getProviderSourceKeys(),
    ];
    const cached = this.selectCachedResource<PricePoint[]>("detailed-price-history", entityKey, variantKeys, sourceKeys, false);
    if (cached) {
      this.scheduleRevalidation(this.makeRevalidationKey("detailed-price-history", ticker, exchange, context, `${compactDate(startDate)}:${compactDate(endDate)}:${barSize}`), async () => {
        await this.revalidateDetailedPriceHistory(ticker, exchange, startDate, endDate, barSize, context);
      });
      return cached.value;
    }

    const brokerResult = await withBrokerTimeout(this.fetchBrokerDetailedPriceHistory(ticker, exchange, startDate, endDate, barSize, context));
    if (brokerResult && brokerResult.value.length > 0) return brokerResult.value;

    const providerResult = await this.fetchProviderDetailedPriceHistory(ticker, exchange, startDate, endDate, barSize, context);
    return providerResult?.value ?? [];
  }

  async getOptionsChain(ticker: string, exchange?: string, expirationDate?: number, context?: MarketDataRequestContext): Promise<OptionsChain> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKeys = [
      buildVariantKey([["exchange", normalizeExchange(exchange)], ["expiration", expirationDate ?? "default"]]),
      buildVariantKey([["expiration", expirationDate ?? "default"]]),
      "",
    ];
    const sourceKeys = [
      ...this.getBrokerCandidatesForContext(context).map((candidate) => this.brokerSourceKey(candidate)),
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
    return [...this.sortedProviders(), this.fallbackProvider].map((provider) => this.providerSourceKey(provider));
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

  private selectCachedResource<T>(
    kind: string,
    entityKey: string,
    variantKeys: string[],
    sourceKeys: string[],
    allowExpired: boolean,
  ): CachedResourceRecord<T> | null {
    if (!this.resources) return null;
    const records = this.resources.list<T>({
      namespace: MARKET_NAMESPACE,
      kind,
      entityKey,
    }, {
      variantKeys,
      sourceKeys,
      allowExpired,
    });
    if (records.length === 0) return null;

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
    })[0] ?? null;
  }

  private readCachedMergedFinancials(
    ticker: string,
    exchange?: string,
    context?: MarketDataRequestContext,
    allowExpired = false,
  ): TickerFinancials | null {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKeys = this.getTickerVariantCandidates(exchange);
    const brokerSourceKeys = this.getBrokerCandidatesForContext(context).map((candidate) => this.brokerSourceKey(candidate));
    const brokerRecord = brokerSourceKeys.length > 0
      ? this.selectCachedResource<TickerFinancials>("financials", entityKey, variantKeys, brokerSourceKeys, allowExpired)
      : null;
    const providerRecord = this.selectCachedResource<TickerFinancials>("financials", entityKey, variantKeys, this.getProviderSourceKeys(), allowExpired);
    return mergeFinancials(brokerRecord?.value ?? null, providerRecord?.value ?? null);
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

  private getBrokerCandidates(preferredBrokerInstanceId?: string, preferredBrokerId?: string): BrokerCandidate[] {
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

    for (const instance of config.brokerInstances) {
      if (instance.id === preferredBrokerInstanceId) continue;
      pushCandidate(instance);
    }

    return candidates;
  }

  private getBrokerCandidatesForContext(context?: MarketDataRequestContext): BrokerCandidate[] {
    return this.getBrokerCandidates(
      context?.instrument?.brokerInstanceId ?? context?.brokerInstanceId,
      context?.instrument?.brokerId ?? context?.brokerId,
    );
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
      providers.push(...this.registry.dataProviders.values());
    }
    return providers
      .filter((provider) => provider.id !== this.id && provider.id !== this.fallbackProvider.id)
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  }

  private async firstProvider<T>(fn: (provider: DataProvider) => Promise<T | null | undefined>): Promise<SourceResult<T> | null> {
    for (const provider of [...this.sortedProviders(), this.fallbackProvider]) {
      try {
        const result = await fn(provider);
        if (result != null) return { sourceKey: this.providerSourceKey(provider), value: result };
      } catch (err) {
        if (shouldLogProviderError(err)) {
          console.error(`[ProviderRouter] ${provider.id} failed:`, err);
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
    for (const candidate of this.getBrokerCandidatesForContext(context)) {
      if (!candidate.broker.getTickerFinancials) continue;
      try {
        const result = await candidate.broker.getTickerFinancials(
          ticker,
          candidate.instance,
          exchange,
          context?.instrument ?? null,
        );
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
    const result = await this.firstProvider((provider) => provider.getTickerFinancials(ticker, exchange, context));
    if (!result) return null;
    const provider = this.resolveProviderBySourceKey(result.sourceKey);
    if (provider) {
      this.cacheResource(
        "financials",
        entityKey,
        variantKey,
        result.sourceKey,
        result.value,
        this.resolveProviderPolicy("financials", provider),
      );
    }
    return result;
  }

  private async fetchBrokerQuote(
    ticker: string,
    exchange?: string,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<Quote> | null> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKey = this.getTickerVariantCandidates(exchange)[0] ?? "";
    for (const candidate of this.getBrokerCandidatesForContext(context)) {
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
    for (const candidate of this.getBrokerCandidatesForContext(context)) {
      if (!candidate.broker.getPriceHistory) continue;
      try {
        const result = await candidate.broker.getPriceHistory(
          ticker,
          candidate.instance,
          exchange,
          range,
          context?.instrument ?? null,
        );
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

  private async fetchProviderPriceHistory(
    ticker: string,
    exchange: string,
    range: TimeRange,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<PricePoint[]> | null> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKey = buildVariantKey([["exchange", normalizeExchange(exchange)], ["range", range]]);
    const result = await this.firstProvider((provider) => provider.getPriceHistory(ticker, exchange, range, context));
    if (!result) return null;
    const provider = this.resolveProviderBySourceKey(result.sourceKey);
    if (provider) {
      this.cacheResource(
        "price-history",
        entityKey,
        variantKey,
        result.sourceKey,
        result.value,
        this.resolveProviderPolicy(isIntradayRange(range) ? "priceHistoryIntraday" : "priceHistoryDaily", provider),
      );
    }
    return result;
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
    for (const candidate of this.getBrokerCandidatesForContext(context)) {
      if (!candidate.broker.getDetailedPriceHistory) continue;
      try {
        const result = await candidate.broker.getDetailedPriceHistory(
          ticker,
          candidate.instance,
          exchange,
          startDate,
          endDate,
          barSize,
          context?.instrument ?? null,
        );
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
    const result = await this.firstProvider(async (provider) => {
      if (!provider.getDetailedPriceHistory) return null;
      return provider.getDetailedPriceHistory(ticker, exchange, startDate, endDate, barSize, context);
    });
    if (!result) return null;
    const provider = this.resolveProviderBySourceKey(result.sourceKey);
    if (provider) {
      this.cacheResource(
        "detailed-price-history",
        entityKey,
        variantKey,
        result.sourceKey,
        result.value,
        this.resolveProviderPolicy("priceHistoryIntraday", provider),
      );
    }
    return result;
  }

  private async fetchBrokerOptionsChain(
    ticker: string,
    exchange?: string,
    expirationDate?: number,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<OptionsChain> | null> {
    const entityKey = this.getEntityKey(ticker, exchange, context?.instrument);
    const variantKey = buildVariantKey([["exchange", normalizeExchange(exchange)], ["expiration", expirationDate ?? "default"]]);
    for (const candidate of this.getBrokerCandidatesForContext(context)) {
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

  private resolveProviderBySourceKey(sourceKey: string): DataProvider | null {
    for (const provider of [...this.sortedProviders(), this.fallbackProvider]) {
      if (this.providerSourceKey(provider) === sourceKey) return provider;
    }
    return null;
  }

  private async revalidateFinancials(ticker: string, exchange?: string, context?: MarketDataRequestContext): Promise<void> {
    const brokerResult = await withBrokerTimeout(this.fetchBrokerFinancials(ticker, exchange, context));
    const needsProvider = !brokerResult || !hasMeaningfulFundamentals(brokerResult.value);
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
    const provider = [...this.sortedProviders(), this.fallbackProvider][0] ?? this.fallbackProvider;
    const rate = await provider.getExchangeRate(fromCurrency);
    this.cacheExchangeRate(fromCurrency, rate, provider);
  }

  private async revalidateNews(ticker: string, count = 15, exchange?: string, context?: MarketDataRequestContext): Promise<void> {
    const provider = [...this.sortedProviders(), this.fallbackProvider][0] ?? this.fallbackProvider;
    const items = await provider.getNews(ticker, count, exchange, context);
    this.cacheResource(
      "news",
      this.getEntityKey(ticker, exchange, context?.instrument),
      buildVariantKey([["exchange", normalizeExchange(exchange)], ["count", count]]),
      this.providerSourceKey(provider),
      items,
      this.resolveProviderPolicy("news", provider),
    );
  }

  private async revalidateArticleSummary(url: string): Promise<void> {
    const provider = [...this.sortedProviders(), this.fallbackProvider][0] ?? this.fallbackProvider;
    const summary = await provider.getArticleSummary(url);
    if (summary) {
      this.cacheResource("article-summary", compactUrl(url), "", this.providerSourceKey(provider), summary, this.resolveProviderPolicy("articleSummary", provider));
    }
  }

  private async revalidatePriceHistory(ticker: string, exchange: string, range: TimeRange, context?: MarketDataRequestContext): Promise<void> {
    const brokerHistory = await withBrokerTimeout(this.fetchBrokerPriceHistory(ticker, exchange, range, context));
    if (!brokerHistory) {
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
    if (!brokerHistory) {
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
}
