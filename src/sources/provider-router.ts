import type { PluginRegistry } from "../plugins/registry";
import type { BrokerAdapter } from "../types/broker";
import type { DataProvider, MarketDataRequestContext, NewsItem, SearchRequestContext } from "../types/data-provider";
import type { AppConfig } from "../types/config";
import type { TickerFinancials, Quote, PricePoint, OptionsChain } from "../types/financials";
import type { TimeRange } from "../components/chart/chart-types";
import type { InstrumentSearchResult } from "../types/instrument";
import { cloneLayout, CURRENT_CONFIG_VERSION, DEFAULT_LAYOUT } from "../types/config";

/** Cap total time spent attempting broker data before falling back to other providers. */
const BROKER_ATTEMPT_TIMEOUT = 10_000;

function withBrokerTimeout<T>(promise: Promise<T>): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), BROKER_ATTEMPT_TIMEOUT);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });
}

interface BrokerCandidate {
  brokerId: string;
  brokerInstanceId: string;
  brokerLabel: string;
  broker: BrokerAdapter;
  instance: AppConfig["brokerInstances"][number];
}

export class ProviderRouter implements DataProvider {
  readonly id = "provider-router";
  readonly name = "Provider Router";
  readonly priority = Number.MAX_SAFE_INTEGER;

  private registry: PluginRegistry | null = null;
  private getConfigFn: () => AppConfig = () => ({
    dataDir: "",
    configVersion: CURRENT_CONFIG_VERSION,
    baseCurrency: "USD",
    refreshIntervalMinutes: 30,
    portfolios: [],
    watchlists: [],
    columns: [],
    layout: cloneLayout(DEFAULT_LAYOUT),
    layouts: [{ name: "Default", layout: cloneLayout(DEFAULT_LAYOUT) }],
    activeLayoutIndex: 0,
    brokerInstances: [],
    plugins: [],
    disabledPlugins: [],
    theme: "amber",
    recentTickers: [],
  });

  constructor(
    private readonly fallbackProvider: DataProvider,
    private readonly extraProviders: DataProvider[] = [],
  ) {}

  attachRegistry(registry: PluginRegistry): void {
    this.registry = registry;
  }

  setConfigAccessor(getConfig: () => AppConfig): void {
    this.getConfigFn = getConfig;
  }

  async canProvide(ticker: string, exchange?: string, context?: MarketDataRequestContext): Promise<boolean> {
    const brokerQuote = await withBrokerTimeout(this.tryBrokerQuote(ticker, exchange, context));
    if (brokerQuote) return true;
    if (this.fallbackProvider.canProvide) {
      return this.fallbackProvider.canProvide(ticker, exchange, context);
    }
    return true;
  }

  async getTickerFinancials(ticker: string, exchange?: string, context?: MarketDataRequestContext): Promise<TickerFinancials> {
    const brokerResult = await withBrokerTimeout(this.tryBrokerTickerFinancials(ticker, exchange, context));
    if (brokerResult) return brokerResult;

    const base = await this.firstProvider((provider) => provider.getTickerFinancials(ticker, exchange, context));
    if (!base) {
      throw new Error(`No provider available for ${ticker}`);
    }

    return base;
  }

  async getQuote(ticker: string, exchange?: string, context?: MarketDataRequestContext): Promise<Quote> {
    const brokerQuote = await withBrokerTimeout(this.tryBrokerQuote(ticker, exchange, context));
    if (brokerQuote) return brokerQuote;

    const providerQuote = await this.firstProvider((provider) => provider.getQuote(ticker, exchange, context));
    if (!providerQuote) {
      throw new Error(`No quote provider available for ${ticker}`);
    }
    return providerQuote;
  }

  async getExchangeRate(fromCurrency: string): Promise<number> {
    const provider = [...this.sortedProviders(), this.fallbackProvider][0] ?? this.fallbackProvider;
    return provider.getExchangeRate(fromCurrency);
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

    // Run broker and provider searches in parallel so a slow broker doesn't block fallback results.
    // Use a deadline: return whatever results are available after 5s even if some providers are still pending.
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

    // Wait for all searches, but time out after 5 seconds so slow providers don't block results
    const deadline = new Promise<void>((resolve) => setTimeout(resolve, 5_000));
    await Promise.race([Promise.all(searchPromises), deadline]);
    return results;
  }

  async getNews(ticker: string, count?: number, exchange?: string, context?: MarketDataRequestContext): Promise<NewsItem[]> {
    const provider = [...this.sortedProviders(), this.fallbackProvider][0] ?? this.fallbackProvider;
    return provider.getNews(ticker, count, exchange, context);
  }

  async getArticleSummary(url: string): Promise<string | null> {
    const provider = [...this.sortedProviders(), this.fallbackProvider][0] ?? this.fallbackProvider;
    return provider.getArticleSummary(url);
  }

  async getPriceHistory(ticker: string, exchange: string, range: TimeRange, context?: MarketDataRequestContext): Promise<PricePoint[]> {
    const brokerHistory = await withBrokerTimeout(this.tryBrokerPriceHistory(ticker, exchange, range, context));
    if (brokerHistory && brokerHistory.length > 0) return brokerHistory;

    const providerHistory = await this.firstProvider((provider) => provider.getPriceHistory(ticker, exchange, range, context));
    if (!providerHistory) {
      throw new Error(`No history provider available for ${ticker}`);
    }
    return providerHistory;
  }

  async getOptionsChain(ticker: string, exchange?: string, expirationDate?: number, context?: MarketDataRequestContext): Promise<OptionsChain> {
    const brokerChain = await withBrokerTimeout(this.tryBrokerOptionsChain(ticker, exchange, expirationDate, context));
    if (brokerChain) return brokerChain;

    const providerChain = await this.firstProvider(async (provider) => {
      if (!provider.getOptionsChain) return null;
      return provider.getOptionsChain(ticker, exchange, expirationDate, context);
    });
    if (!providerChain) {
      throw new Error(`No options provider available for ${ticker}`);
    }
    return providerChain;
  }

  private getBrokerCandidates(preferredBrokerInstanceId?: string, preferredBrokerId?: string): BrokerCandidate[] {
    if (!this.registry) return [];
    const config = this.getConfigFn();
    const candidates: BrokerCandidate[] = [];

    const pushCandidate = (instance: AppConfig["brokerInstances"][number]) => {
      if (instance.enabled === false) return;
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

  private async firstProvider<T>(fn: (provider: DataProvider) => Promise<T | null | undefined>): Promise<T | null> {
    for (const provider of [...this.sortedProviders(), this.fallbackProvider]) {
      try {
        const result = await fn(provider);
        if (result != null) return result;
      } catch {
        // continue to the next provider
      }
    }
    return null;
  }

  private async tryBrokerTickerFinancials(
    ticker: string,
    exchange?: string,
    context?: MarketDataRequestContext,
  ): Promise<TickerFinancials | null> {
    const preferredBrokerInstanceId = context?.instrument?.brokerInstanceId ?? context?.brokerInstanceId;
    const preferredBrokerId = context?.instrument?.brokerId ?? context?.brokerId;
    for (const candidate of this.getBrokerCandidates(preferredBrokerInstanceId, preferredBrokerId)) {
      if (!candidate.broker.getTickerFinancials) continue;
      try {
        return await candidate.broker.getTickerFinancials(
          ticker,
          candidate.instance,
          exchange,
          context?.instrument ?? null,
        );
      } catch {
        // continue
      }
    }
    return null;
  }

  private async tryBrokerQuote(
    ticker: string,
    exchange?: string,
    context?: MarketDataRequestContext,
  ): Promise<Quote | null> {
    const preferredBrokerInstanceId = context?.instrument?.brokerInstanceId ?? context?.brokerInstanceId;
    const preferredBrokerId = context?.instrument?.brokerId ?? context?.brokerId;
    for (const candidate of this.getBrokerCandidates(preferredBrokerInstanceId, preferredBrokerId)) {
      if (!candidate.broker.getQuote) continue;
      try {
        return await candidate.broker.getQuote(
          ticker,
          candidate.instance,
          exchange,
          context?.instrument ?? null,
        );
      } catch {
        // continue
      }
    }
    return null;
  }

  private async tryBrokerPriceHistory(
    ticker: string,
    exchange: string,
    range: TimeRange,
    context?: MarketDataRequestContext,
  ): Promise<PricePoint[] | null> {
    const preferredBrokerInstanceId = context?.instrument?.brokerInstanceId ?? context?.brokerInstanceId;
    const preferredBrokerId = context?.instrument?.brokerId ?? context?.brokerId;
    for (const candidate of this.getBrokerCandidates(preferredBrokerInstanceId, preferredBrokerId)) {
      if (!candidate.broker.getPriceHistory) continue;
      try {
        return await candidate.broker.getPriceHistory(
          ticker,
          candidate.instance,
          exchange,
          range,
          context?.instrument ?? null,
        );
      } catch {
        // continue
      }
    }
    return null;
  }

  private async tryBrokerOptionsChain(
    ticker: string,
    exchange?: string,
    expirationDate?: number,
    context?: MarketDataRequestContext,
  ): Promise<OptionsChain | null> {
    const preferredBrokerInstanceId = context?.instrument?.brokerInstanceId ?? context?.brokerInstanceId;
    const preferredBrokerId = context?.instrument?.brokerId ?? context?.brokerId;
    for (const candidate of this.getBrokerCandidates(preferredBrokerInstanceId, preferredBrokerId)) {
      if (!candidate.broker.getOptionsChain) continue;
      try {
        return await candidate.broker.getOptionsChain(
          ticker,
          candidate.instance,
          exchange,
          expirationDate,
          context?.instrument ?? null,
        );
      } catch {
        // continue
      }
    }
    return null;
  }
}
