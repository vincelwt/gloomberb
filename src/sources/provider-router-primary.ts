import type { BrokerAdapter } from "../types/broker";
import type { DataProvider, MarketDataRequestContext } from "../types/data-provider";
import type { BrokerContractRef } from "../types/instrument";
import type { Quote, TickerFinancials } from "../types/financials";
import { normalizeTickerFinancialsPriceHistory } from "../utils/price-history";
import { isQuoteStaleForCurrentSession } from "../utils/quote-freshness";
import { resolveTickerFinancialsQuoteState } from "../utils/quote-resolution";
import { shouldLogProviderError } from "./provider-errors";
import type { BrokerCandidate } from "./provider-router-brokers";
import type { ProviderRouterCachePolicyKey } from "./provider-router-cache";
import { type resolveCachePolicy } from "./provider-router-cache";
import {
  hasDetailedStatementRows,
  hasStatementRows,
  mergeMissingStatementArrays,
} from "./provider-router-financials";

export interface SourceResult<T> {
  sourceKey: string;
  value: T;
}

interface ProviderRouterPrimaryRoutesOptions {
  getEntityKey: (ticker: string, instrument?: BrokerContractRef | null) => string;
  getTickerVariantCandidates: (exchange?: string) => string[];
  getBrokerCandidatesForContext: (
    context?: MarketDataRequestContext,
    includeFallbackInstances?: boolean,
  ) => BrokerCandidate[];
  providersInPriorityOrder: () => DataProvider[];
  brokerSourceKey: (candidate: BrokerCandidate) => string;
  providerSourceKey: (provider: DataProvider) => string;
  resolveBrokerPolicy: (key: ProviderRouterCachePolicyKey, broker: BrokerAdapter) => ReturnType<typeof resolveCachePolicy>;
  resolveProviderPolicy: (key: ProviderRouterCachePolicyKey, provider: DataProvider) => ReturnType<typeof resolveCachePolicy>;
  cacheResource: <T>(
    kind: string,
    entityKey: string,
    variantKey: string,
    sourceKey: string,
    value: T,
    cachePolicy: ReturnType<typeof resolveCachePolicy>,
  ) => void;
  logProviderError: (message: string) => void;
}

export class ProviderRouterPrimaryRoutes {
  constructor(private readonly options: ProviderRouterPrimaryRoutesOptions) {}

  async fetchBrokerFinancials(
    ticker: string,
    exchange?: string,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<TickerFinancials> | null> {
    const entityKey = this.options.getEntityKey(ticker, context?.instrument);
    const variantKey = this.options.getTickerVariantCandidates(exchange)[0] ?? "";
    for (const candidate of this.options.getBrokerCandidatesForContext(context, false)) {
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
        this.options.cacheResource(
          "financials",
          entityKey,
          variantKey,
          this.options.brokerSourceKey(candidate),
          result,
          this.options.resolveBrokerPolicy("financials", candidate.broker),
        );
        return { sourceKey: this.options.brokerSourceKey(candidate), value: result };
      } catch {
        // continue
      }
    }
    return null;
  }

  async fetchProviderFinancials(
    ticker: string,
    exchange?: string,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<TickerFinancials> | null> {
    const entityKey = this.options.getEntityKey(ticker, context?.instrument);
    const variantKey = this.options.getTickerVariantCandidates(exchange)[0] ?? "";
    let primaryResult: SourceResult<TickerFinancials> | null = null;

    for (const provider of this.options.providersInPriorityOrder()) {
      try {
        const rawValue = await provider.getTickerFinancials(ticker, exchange, context);
        const value = resolveTickerFinancialsQuoteState(normalizeTickerFinancialsPriceHistory(rawValue));
        if (!value) continue;
        const sourceKey = this.options.providerSourceKey(provider);
        const cacheValue = primaryResult
          ? {
            annualStatements: value.annualStatements,
            quarterlyStatements: value.quarterlyStatements,
            priceHistory: [],
          }
          : value;
        this.options.cacheResource(
          "financials",
          entityKey,
          variantKey,
          sourceKey,
          cacheValue,
          this.options.resolveProviderPolicy("financials", provider),
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
          this.options.logProviderError(`${provider.id} failed: ${error}`);
        }
      }
    }

    return primaryResult;
  }

  async fetchBrokerQuote(
    ticker: string,
    exchange?: string,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<Quote> | null> {
    const entityKey = this.options.getEntityKey(ticker, context?.instrument);
    const variantKey = this.options.getTickerVariantCandidates(exchange)[0] ?? "";
    for (const candidate of this.options.getBrokerCandidatesForContext(context, false)) {
      if (!candidate.broker.getQuote) continue;
      try {
        const result = await candidate.broker.getQuote(
          ticker,
          candidate.instance,
          exchange,
          context?.instrument ?? null,
        );
        this.options.cacheResource(
          "quote",
          entityKey,
          variantKey,
          this.options.brokerSourceKey(candidate),
          result,
          this.options.resolveBrokerPolicy("brokerQuote", candidate.broker),
        );
        return { sourceKey: this.options.brokerSourceKey(candidate), value: result };
      } catch {
        // continue
      }
    }
    return null;
  }

  async fetchProviderQuote(
    ticker: string,
    exchange?: string,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<Quote> | null> {
    const entityKey = this.options.getEntityKey(ticker, context?.instrument);
    const variantKey = this.options.getTickerVariantCandidates(exchange)[0] ?? "";
    for (const provider of this.options.providersInPriorityOrder()) {
      try {
        const quote = await provider.getQuote(ticker, exchange, context);
        if (quote == null || isQuoteStaleForCurrentSession(quote)) continue;
        const sourceKey = this.options.providerSourceKey(provider);
        this.options.cacheResource(
          "quote",
          entityKey,
          variantKey,
          sourceKey,
          quote,
          this.options.resolveProviderPolicy("quote", provider),
        );
        return { sourceKey, value: quote };
      } catch (error) {
        if (shouldLogProviderError(error)) {
          this.options.logProviderError(`${provider.id} failed: ${error}`);
        }
      }
    }
    return null;
  }
}
