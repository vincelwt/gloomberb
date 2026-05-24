import type {
  CachedFinancialsTarget,
  MarketDataRequestContext,
} from "../types/data-provider";
import type {
  Quote,
  TickerFinancials,
} from "../types/financials";
import { parseOptionSymbol } from "../utils/options";
import { isQuoteStaleForCurrentSession } from "../utils/quote-freshness";
import { resolveTickerFinancialsQuoteState } from "../utils/quote-resolution";
import {
  listCachedResources,
  normalizeTicker,
  selectCachedResource,
  sortCachedRecords,
} from "./provider-router-cache";
import { withBrokerTimeout } from "./provider-router-brokers";
import {
  deriveMarketCapFromShares,
  hasMeaningfulProfile,
  mergeCachedFinancialRecords,
  mergeFinancials,
  quoteWithFreshnessExchange,
  sanitizeCachedFinancials,
  selectCachedQuoteRecord,
  type CachedFinancialsReadOptions,
  type CachedFinancialsSelection,
} from "./provider-router-financials";
import type { ProviderRouterPrimaryRoutes } from "./provider-router-primary";
import type { ProviderRouterCoreDeps } from "./provider-router-route-types";

export interface ProviderRouterFinancialRouteDeps extends Pick<
  ProviderRouterCoreDeps,
  | "resources"
  | "getEntityKey"
  | "getTickerVariantCandidates"
  | "getBrokerCandidatesForContext"
  | "getProviderSourceKeys"
  | "brokerSourceKey"
> {
  primaryRoutes: ProviderRouterPrimaryRoutes;
}

export class ProviderRouterFinancialRoutes {
  constructor(private readonly deps: ProviderRouterFinancialRouteDeps) {}

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

  async getTickerFinancials(
    ticker: string,
    exchange?: string,
    context?: MarketDataRequestContext,
  ): Promise<TickerFinancials> {
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
        const providerResult = await this.deps.primaryRoutes.fetchProviderFinancials(ticker, exchange, context);
        return mergeFinancials(cached.value, providerResult?.value ?? null) ?? cached.value;
      }
    }

    if (cached.value) {
      const brokerResult = await withBrokerTimeout(this.deps.primaryRoutes.fetchBrokerFinancials(ticker, exchange, context));
      const providerResult = await this.deps.primaryRoutes.fetchProviderFinancials(ticker, exchange, context);
      const merged = mergeFinancials(
        brokerResult?.value ?? cached.brokerRecord?.value ?? null,
        providerResult?.value ?? cached.providerValue ?? null,
      );
      if (isOptionTicker && !merged?.quote) {
        return quoteOnlyFinancials(merged ?? cached.value);
      }
      return merged ?? cached.value;
    }

    const brokerResult = await withBrokerTimeout(this.deps.primaryRoutes.fetchBrokerFinancials(ticker, exchange, context));
    const fallback = await this.deps.primaryRoutes.fetchProviderFinancials(ticker, exchange, context);
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
    const entityKey = this.deps.getEntityKey(ticker, context?.instrument);
    const variantKeys = this.deps.getTickerVariantCandidates(exchange);
    const sourceKeys = [
      ...this.deps.getBrokerCandidatesForContext(context, false).map((candidate) => this.deps.brokerSourceKey(candidate)),
      ...this.deps.getProviderSourceKeys(),
    ];
    const rawCached = selectCachedResource<Quote>(this.deps.resources, "quote", entityKey, variantKeys, sourceKeys, false);
    const cached = rawCached && !isQuoteStaleForCurrentSession(quoteWithFreshnessExchange(rawCached.value, exchange))
      ? rawCached
      : null;
    const forceRefresh = context?.cacheMode === "refresh";
    if (cached && !forceRefresh && !cached.stale) {
      return cached.value;
    }

    const brokerQuote = await withBrokerTimeout(this.deps.primaryRoutes.fetchBrokerQuote(ticker, exchange, context));
    if (brokerQuote && !isQuoteStaleForCurrentSession(quoteWithFreshnessExchange(brokerQuote.value, exchange))) {
      return brokerQuote.value;
    }

    const providerQuote = await this.deps.primaryRoutes.fetchProviderQuote(ticker, exchange, context);
    if (providerQuote) {
      return providerQuote.value;
    }
    if (cached) return cached.value;
    throw new Error(`No quote provider available for ${ticker}`);
  }

  readCachedMergedFinancialsSelection(
    ticker: string,
    exchange?: string,
    context?: MarketDataRequestContext,
    allowExpired = false,
    options: CachedFinancialsReadOptions = {},
  ): CachedFinancialsSelection {
    const entityKey = this.deps.getEntityKey(ticker, context?.instrument);
    const variantKeys = this.deps.getTickerVariantCandidates(exchange);
    const brokerSourceKeys = this.deps.getBrokerCandidatesForContext(context, false).map((candidate) => this.deps.brokerSourceKey(candidate));
    const brokerRecord = brokerSourceKeys.length > 0
      ? selectCachedResource<TickerFinancials>(this.deps.resources, "financials", entityKey, variantKeys, brokerSourceKeys, allowExpired)
      : null;
    const sanitizedBrokerRecord = brokerRecord
      ? { ...brokerRecord, value: sanitizeCachedFinancials(brokerRecord.value, options) }
      : null;
    const providerSourceKeys = this.deps.getProviderSourceKeys();
    const providerEntityKeys = options.includeSymbolProviderFallback
      ? [...new Set([entityKey, normalizeTicker(ticker)])]
      : [entityKey];
    const providerRecords = sortCachedRecords(
      providerEntityKeys.flatMap((providerEntityKey) => listCachedResources<TickerFinancials>(
        this.deps.resources,
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
    const quoteRecords = sortCachedRecords(
      providerEntityKeys.flatMap((quoteEntityKey) => listCachedResources<Quote>(
        this.deps.resources,
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

  private readCachedMergedFinancials(
    ticker: string,
    exchange?: string,
    context?: MarketDataRequestContext,
    allowExpired = false,
    options: CachedFinancialsReadOptions = {},
  ): TickerFinancials | null {
    return this.readCachedMergedFinancialsSelection(ticker, exchange, context, allowExpired, options).value;
  }
}
