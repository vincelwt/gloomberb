import type {
  MarketDataRequestContext,
  SecFilingItem,
} from "../types/data-provider";
import { canonicalExchange } from "../utils/exchanges";
import {
  buildVariantKey,
  compactUrl,
  selectCachedResource,
} from "./provider-router-cache";
import { shouldLogProviderError } from "./provider-errors";
import type { ProviderRouterCoreDeps, SourceResult } from "./provider-router-route-types";
import {
  firstProviderResult,
  makeRouterRevalidationKey,
  resolveProviderBySourceKey,
  scheduleRouterRevalidation,
} from "./provider-router-routing";

export class ProviderRouterDocumentRoutes {
  private readonly revalidationInFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: ProviderRouterCoreDeps) {}

  async getSecFilings(ticker: string, count = 15, exchange?: string, context?: MarketDataRequestContext): Promise<SecFilingItem[]> {
    const entityKey = this.deps.getEntityKey(ticker, context?.instrument);
    const variantKeys = [
      buildVariantKey([["exchange", canonicalExchange(exchange)], ["count", count]]),
      buildVariantKey([["count", count]]),
      "",
    ];
    const cached = selectCachedResource<SecFilingItem[]>(this.deps.resources, "sec-filings", entityKey, variantKeys, this.deps.getProviderSourceKeys(), false);
    if (cached) {
      scheduleRouterRevalidation(this.revalidationInFlight, makeRouterRevalidationKey(this.deps, "sec-filings", ticker, context, count), async () => {
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
      scheduleRouterRevalidation(this.revalidationInFlight, `sec-filing-content:${entityKey}`, async () => {
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
      scheduleRouterRevalidation(this.revalidationInFlight, `article-summary:${entityKey}`, async () => {
        await this.revalidateArticleSummary(url);
      });
      return cached.value;
    }

    const result = await firstProviderResult(this.deps, (provider) => provider.getArticleSummary(url));
    if (!result) {
      return null;
    }
    const provider = resolveProviderBySourceKey(this.deps, result.sourceKey);
    if (provider && result.value) {
      this.deps.cacheResource("article-summary", entityKey, "", result.sourceKey, result.value, this.deps.resolveProviderPolicy("articleSummary", provider));
    }
    return result.value;
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

  private async revalidateSecFilings(ticker: string, count = 15, exchange?: string, context?: MarketDataRequestContext): Promise<void> {
    await this.fetchProviderSecFilings(ticker, count, exchange, context);
  }

  private async revalidateSecFilingContent(filing: SecFilingItem): Promise<void> {
    await this.fetchProviderSecFilingContent(filing);
  }

  private async revalidateArticleSummary(url: string): Promise<void> {
    const result = await firstProviderResult(this.deps, (provider) => provider.getArticleSummary(url));
    if (!result || !result.value) return;
    const provider = resolveProviderBySourceKey(this.deps, result.sourceKey);
    if (provider) {
      this.deps.cacheResource("article-summary", compactUrl(url), "", result.sourceKey, result.value, this.deps.resolveProviderPolicy("articleSummary", provider));
    }
  }
}
