import type {
  DataProvider,
  MarketDataRequestContext,
} from "../types/data-provider";
import type {
  AnalystResearchData,
  CorporateActionsData,
  HolderData,
  OptionsChain,
} from "../types/financials";
import { canonicalExchange } from "../utils/exchanges";
import {
  buildVariantKey,
  listCachedResources,
  selectCachedResource,
} from "./provider-router-cache";
import { shouldLogProviderError } from "./provider-errors";
import { withBrokerTimeout } from "./provider-router-brokers";
import {
  hasAnalystResearchValue,
  hasCorporateActionsValue,
  isAnalystResearchMissingRatingTargets,
} from "./provider-router-financials";
import type { ProviderRouterCoreDeps, SourceResult } from "./provider-router-route-types";

export class ProviderRouterSupplementalRoutes {
  private readonly revalidationInFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: ProviderRouterCoreDeps) {}

  getCachedExchangeRates(currencies: string[], options: { allowExpired?: boolean } = {}): Map<string, number> {
    const results = new Map<string, number>();
    for (const currency of currencies) {
      const cached = this.readCachedExchangeRate(currency, options.allowExpired ?? true);
      if (cached != null) results.set(currency, cached);
    }
    return results;
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

  async getHolders(ticker: string, exchange?: string, context?: MarketDataRequestContext): Promise<HolderData> {
    const entityKey = this.deps.getEntityKey(ticker, context?.instrument);
    const variantKeys = this.deps.getTickerVariantCandidates(exchange);
    const cached = selectCachedResource<HolderData>(this.deps.resources, "holders", entityKey, variantKeys, this.deps.getProviderSourceKeys(), false);
    const forceRefresh = context?.cacheMode === "refresh";
    if (cached && !forceRefresh) {
      this.scheduleRevalidation(this.makeRevalidationKey("holders", ticker, context), async () => {
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
    const entityKey = this.deps.getEntityKey(ticker, context?.instrument);
    const variantKeys = this.deps.getTickerVariantCandidates(exchange);
    const cached = this.selectCachedAnalystResearch(entityKey, variantKeys, this.deps.getProviderSourceKeys(), false);
    const forceRefresh = context?.cacheMode === "refresh";
    if (cached && !forceRefresh && !isAnalystResearchMissingRatingTargets(cached.value)) {
      this.scheduleRevalidation(this.makeRevalidationKey("analystResearch", ticker, context), async () => {
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
    const entityKey = this.deps.getEntityKey(ticker, context?.instrument);
    const variantKeys = this.deps.getTickerVariantCandidates(exchange);
    const cached = selectCachedResource<CorporateActionsData>(this.deps.resources, "corporateActions", entityKey, variantKeys, this.deps.getProviderSourceKeys(), false);
    const forceRefresh = context?.cacheMode === "refresh";
    if (cached && !forceRefresh) {
      this.scheduleRevalidation(this.makeRevalidationKey("corporateActions", ticker, context), async () => {
        await this.revalidateCorporateActions(ticker, exchange, context);
      });
      return cached.value;
    }

    const result = await this.fetchProviderCorporateActions(ticker, exchange, context);
    if (result) return result.value;
    if (cached) return cached.value;
    throw new Error(`No corporate actions provider available for ${ticker}`);
  }

  async getOptionsChain(ticker: string, exchange?: string, expirationDate?: number, context?: MarketDataRequestContext): Promise<OptionsChain> {
    const entityKey = this.deps.getEntityKey(ticker, context?.instrument);
    const variantKeys = [
      buildVariantKey([["exchange", canonicalExchange(exchange)], ["expiration", expirationDate ?? "default"]]),
      buildVariantKey([["expiration", expirationDate ?? "default"]]),
      "",
    ];
    const sourceKeys = [
      ...this.deps.getBrokerCandidatesForContext(context, false).map((candidate) => this.deps.brokerSourceKey(candidate)),
      ...this.deps.getProviderSourceKeys(),
    ];
    const cached = selectCachedResource<OptionsChain>(this.deps.resources, "options-chain", entityKey, variantKeys, sourceKeys, false);
    if (cached) {
      this.scheduleRevalidation(this.makeRevalidationKey("options-chain", ticker, context, expirationDate ?? "default"), async () => {
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

  private makeRevalidationKey(kind: string, ticker: string, context?: MarketDataRequestContext, extra?: string | number): string {
    return [
      kind,
      this.deps.getEntityKey(ticker, context?.instrument),
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

  private selectCachedAnalystResearch(
    entityKey: string,
    variantKeys: string[],
    sourceKeys: string[],
    allowExpired: boolean,
  ) {
    const records = listCachedResources<AnalystResearchData>(this.deps.resources, "analystResearch", entityKey, variantKeys, sourceKeys, allowExpired);
    return records.find((record) => !isAnalystResearchMissingRatingTargets(record.value)) ?? records[0] ?? null;
  }

  private readCachedExchangeRate(currency: string, allowExpired = false): number | null {
    const normalizedCurrency = currency.toUpperCase();
    if (normalizedCurrency === "USD") return 1;
    const entityKey = `${normalizedCurrency}/USD`;
    const cached = selectCachedResource<{ rate: number }>(this.deps.resources, "exchange-rate", entityKey, [""], this.deps.getProviderSourceKeys(), allowExpired);
    return cached?.value.rate ?? null;
  }

  private cacheExchangeRate(currency: string, rate: number, provider: DataProvider): void {
    const normalizedCurrency = currency.toUpperCase();
    if (normalizedCurrency === "USD") return;
    this.deps.cacheResource(
      "exchange-rate",
      `${normalizedCurrency}/USD`,
      "",
      this.deps.providerSourceKey(provider),
      { rate },
      this.deps.resolveProviderPolicy("exchangeRate", provider),
    );
  }

  private async firstProvider<T>(fn: (provider: DataProvider) => Promise<T | null | undefined>): Promise<SourceResult<T> | null> {
    for (const provider of this.deps.providersInPriorityOrder()) {
      try {
        const result = await fn(provider);
        if (result != null) return { sourceKey: this.deps.providerSourceKey(provider), value: result };
      } catch (err) {
        if (shouldLogProviderError(err)) {
          this.deps.logProviderError(`${provider.id} failed: ${err}`);
        }
      }
    }
    return null;
  }

  private async fetchBrokerOptionsChain(
    ticker: string,
    exchange?: string,
    expirationDate?: number,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<OptionsChain> | null> {
    const entityKey = this.deps.getEntityKey(ticker, context?.instrument);
    const variantKey = buildVariantKey([["exchange", canonicalExchange(exchange)], ["expiration", expirationDate ?? "default"]]);
    for (const candidate of this.deps.getBrokerCandidatesForContext(context, false)) {
      if (!candidate.broker.getOptionsChain) continue;
      try {
        const result = await candidate.broker.getOptionsChain(
          ticker,
          candidate.instance,
          exchange,
          expirationDate,
          context?.instrument ?? null,
        );
        this.deps.cacheResource(
          "options-chain",
          entityKey,
          variantKey,
          this.deps.brokerSourceKey(candidate),
          result,
          this.deps.resolveBrokerPolicy("optionsChain", candidate.broker),
        );
        return { sourceKey: this.deps.brokerSourceKey(candidate), value: result };
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
    const entityKey = this.deps.getEntityKey(ticker, context?.instrument);
    const variantKey = buildVariantKey([["exchange", canonicalExchange(exchange)], ["expiration", expirationDate ?? "default"]]);
    const result = await this.firstProvider(async (provider) => {
      if (!provider.getOptionsChain) return null;
      return provider.getOptionsChain(ticker, exchange, expirationDate, context);
    });
    if (!result) return null;
    const provider = this.resolveProviderBySourceKey(result.sourceKey);
    if (provider) {
      this.deps.cacheResource("options-chain", entityKey, variantKey, result.sourceKey, result.value, this.deps.resolveProviderPolicy("optionsChain", provider));
    }
    return result;
  }

  private async fetchProviderHolders(
    ticker: string,
    exchange?: string,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<HolderData> | null> {
    const entityKey = this.deps.getEntityKey(ticker, context?.instrument);
    const variantKey = this.deps.getTickerVariantCandidates(exchange)[0] ?? "";
    let firstEmptyResult: SourceResult<HolderData> | null = null;
    let lastError: unknown = null;

    for (const provider of this.deps.providersInPriorityOrder()) {
      if (!provider.getHolders) continue;
      try {
        const value = await provider.getHolders(ticker, exchange, context);
        const sourceKey = this.deps.providerSourceKey(provider);
        this.deps.cacheResource("holders", entityKey, variantKey, sourceKey, value, this.deps.resolveProviderPolicy("holders", provider));
        if (value.holders.length > 0) return { sourceKey, value };
        firstEmptyResult ??= { sourceKey, value };
      } catch (error) {
        lastError = error;
        if (shouldLogProviderError(error)) {
          this.deps.logProviderError(`${provider.id} failed: ${error}`);
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
    const entityKey = this.deps.getEntityKey(ticker, context?.instrument);
    const variantKey = this.deps.getTickerVariantCandidates(exchange)[0] ?? "";
    let firstEmptyResult: SourceResult<AnalystResearchData> | null = null;
    let firstIncompleteResult: SourceResult<AnalystResearchData> | null = null;
    let lastError: unknown = null;

    for (const provider of this.deps.providersInPriorityOrder()) {
      if (!provider.getAnalystResearch) continue;
      try {
        const value = await provider.getAnalystResearch(ticker, exchange, context);
        const sourceKey = this.deps.providerSourceKey(provider);
        this.deps.cacheResource("analystResearch", entityKey, variantKey, sourceKey, value, this.deps.resolveProviderPolicy("analystResearch", provider));
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
          this.deps.logProviderError(`${provider.id} failed: ${error}`);
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
    const entityKey = this.deps.getEntityKey(ticker, context?.instrument);
    const variantKey = this.deps.getTickerVariantCandidates(exchange)[0] ?? "";
    let firstEmptyResult: SourceResult<CorporateActionsData> | null = null;
    let lastError: unknown = null;

    for (const provider of this.deps.providersInPriorityOrder()) {
      if (!provider.getCorporateActions) continue;
      try {
        const value = await provider.getCorporateActions(ticker, exchange, context);
        const sourceKey = this.deps.providerSourceKey(provider);
        this.deps.cacheResource("corporateActions", entityKey, variantKey, sourceKey, value, this.deps.resolveProviderPolicy("corporateActions", provider));
        if (hasCorporateActionsValue(value)) return { sourceKey, value };
        firstEmptyResult ??= { sourceKey, value };
      } catch (error) {
        lastError = error;
        if (shouldLogProviderError(error)) {
          this.deps.logProviderError(`${provider.id} failed: ${error}`);
        }
      }
    }

    if (firstEmptyResult) return firstEmptyResult;
    if (lastError) throw lastError;
    return null;
  }

  private resolveProviderBySourceKey(sourceKey: string): DataProvider | null {
    for (const provider of this.deps.providersInPriorityOrder()) {
      if (this.deps.providerSourceKey(provider) === sourceKey) return provider;
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

  private async revalidateHolders(ticker: string, exchange?: string, context?: MarketDataRequestContext): Promise<void> {
    await this.fetchProviderHolders(ticker, exchange, context);
  }

  private async revalidateAnalystResearch(ticker: string, exchange?: string, context?: MarketDataRequestContext): Promise<void> {
    await this.fetchProviderAnalystResearch(ticker, exchange, context);
  }

  private async revalidateCorporateActions(ticker: string, exchange?: string, context?: MarketDataRequestContext): Promise<void> {
    await this.fetchProviderCorporateActions(ticker, exchange, context);
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
