import type { ResourceStore } from "../data/resource-store";
import type {
  DataProvider,
  MarketDataRequestContext,
  SecFilingItem,
} from "../types/data-provider";
import type { BrokerContractRef } from "../types/instrument";
import type { CachePolicy } from "../types/persistence";
import { canonicalExchange } from "../utils/exchanges";
import {
  buildVariantKey,
  compactUrl,
  selectCachedResource,
  type ProviderRouterCachePolicyKey,
} from "./provider-router-cache";
import { shouldLogProviderError } from "./provider-errors";

interface SourceResult<T> {
  sourceKey: string;
  value: T;
}

export interface ProviderRouterDocumentDeps {
  resources?: ResourceStore;
  getEntityKey(ticker: string, instrument?: BrokerContractRef | null): string;
  getProviderSourceKeys(): string[];
  providersInPriorityOrder(): DataProvider[];
  providerSourceKey(provider: DataProvider): string;
  resolveProviderPolicy(key: ProviderRouterCachePolicyKey, provider: DataProvider): CachePolicy;
  cacheResource<T>(
    kind: string,
    entityKey: string,
    variantKey: string,
    sourceKey: string,
    value: T,
    cachePolicy: CachePolicy,
  ): void;
  logProviderError(message: string): void;
}

export class ProviderRouterDocumentRoutes {
  private readonly revalidationInFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: ProviderRouterDocumentDeps) {}

  async getSecFilings(ticker: string, count = 15, exchange?: string, context?: MarketDataRequestContext): Promise<SecFilingItem[]> {
    const entityKey = this.deps.getEntityKey(ticker, context?.instrument);
    const variantKeys = [
      buildVariantKey([["exchange", canonicalExchange(exchange)], ["count", count]]),
      buildVariantKey([["count", count]]),
      "",
    ];
    const cached = selectCachedResource<SecFilingItem[]>(this.deps.resources, "sec-filings", entityKey, variantKeys, this.deps.getProviderSourceKeys(), false);
    if (cached) {
      this.scheduleRevalidation(this.makeRevalidationKey("sec-filings", ticker, context, count), async () => {
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
    const cached = selectCachedResource<string | null>(this.deps.resources, "sec-filing-content", entityKey, [""], this.deps.getProviderSourceKeys(), false);
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
    const cached = selectCachedResource<string>(this.deps.resources, "article-summary", entityKey, [""], this.deps.getProviderSourceKeys(), false);
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
      this.deps.cacheResource("article-summary", entityKey, "", result.sourceKey, result.value, this.deps.resolveProviderPolicy("articleSummary", provider));
    }
    return result.value;
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

  private async fetchProviderSecFilings(
    ticker: string,
    count = 15,
    exchange?: string,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<SecFilingItem[]> | null> {
    const entityKey = this.deps.getEntityKey(ticker, context?.instrument);
    const variantKey = buildVariantKey([["exchange", canonicalExchange(exchange)], ["count", count]]);
    let lastError: unknown = null;

    for (const provider of this.deps.providersInPriorityOrder()) {
      if (!provider.getSecFilings) continue;
      try {
        const value = await provider.getSecFilings(ticker, count, exchange, context);
        const sourceKey = this.deps.providerSourceKey(provider);
        this.deps.cacheResource("sec-filings", entityKey, variantKey, sourceKey, value, this.deps.resolveProviderPolicy("secFilings", provider));
        return { sourceKey, value };
      } catch (error) {
        lastError = error;
        if (shouldLogProviderError(error)) {
          this.deps.logProviderError(`${provider.id} failed: ${error}`);
        }
      }
    }

    if (lastError) throw lastError;
    return null;
  }

  private async fetchProviderSecFilingContent(filing: SecFilingItem): Promise<SourceResult<string | null> | null> {
    const entityKey = compactUrl(filing.primaryDocumentUrl ?? filing.filingUrl);
    let lastError: unknown = null;

    for (const provider of this.deps.providersInPriorityOrder()) {
      if (!provider.getSecFilingContent) continue;
      try {
        const value = await provider.getSecFilingContent(filing);
        const sourceKey = this.deps.providerSourceKey(provider);
        this.deps.cacheResource("sec-filing-content", entityKey, "", sourceKey, value, this.deps.resolveProviderPolicy("secFilingContent", provider));
        return { sourceKey, value };
      } catch (error) {
        lastError = error;
        if (shouldLogProviderError(error)) {
          this.deps.logProviderError(`${provider.id} failed: ${error}`);
        }
      }
    }

    if (lastError) throw lastError;
    return null;
  }

  private resolveProviderBySourceKey(sourceKey: string): DataProvider | null {
    for (const provider of this.deps.providersInPriorityOrder()) {
      if (this.deps.providerSourceKey(provider) === sourceKey) return provider;
    }
    return null;
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
      this.deps.cacheResource("article-summary", compactUrl(url), "", result.sourceKey, result.value, this.deps.resolveProviderPolicy("articleSummary", provider));
    }
  }
}
