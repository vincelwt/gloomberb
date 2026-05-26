import type { MarketDataRequestContext } from "../../types/data-provider";
import type { PricePoint } from "../../types/financials";
import type { TimeRange } from "../../components/chart/core/types";
import {
  isIntradayResolution,
  normalizeChartResolutionSupport,
  type ChartResolutionSupport,
  type ManualChartResolution,
} from "../../components/chart/core/resolution";
import { canonicalExchange } from "../../utils/exchanges";
import { resolvePriceHistoryCurrencyUnit } from "../../utils/currency-units";
import { isPriceHistoryStaleForCurrentWindow, normalizePriceHistory } from "../../utils/price-history";
import {
  buildVariantKey,
  compactDate,
  isCurrentHistoryWindow,
  isIntradayRange,
  isStaleIntradayHistory,
  selectCachedArrayResource,
} from "./cache";
import { shouldLogProviderError } from "../provider-errors";
import { withBrokerTimeout } from "./brokers";
import type { ProviderRouterCoreDeps, SourceResult } from "./route-types";

function buildPriceHistoryVariantKey(
  parts: Array<[string, string | number | undefined | null]>,
  exchange: string,
): string {
  const unit = resolvePriceHistoryCurrencyUnit(null, exchange);
  const unitPart: Array<[string, string]> = unit.divisor === 1 ? [] : [["unit", unit.currency]];
  return buildVariantKey([...parts, ...unitPart]);
}

export class ProviderRouterHistoryRoutes {
  constructor(private readonly deps: ProviderRouterCoreDeps) {}

  async getPriceHistory(ticker: string, exchange: string, range: TimeRange, context?: MarketDataRequestContext): Promise<PricePoint[]> {
    const entityKey = this.deps.getEntityKey(ticker, context?.instrument);
    const variantKeys = [
      buildPriceHistoryVariantKey([["exchange", canonicalExchange(exchange)], ["range", range]], exchange),
      buildPriceHistoryVariantKey([["range", range]], exchange),
    ];
    const sourceKeys = [
      ...this.deps.getBrokerCandidatesForContext(context, false).map((candidate) => this.deps.brokerSourceKey(candidate)),
      ...this.deps.getProviderSourceKeys(),
    ];
    const cached = selectCachedArrayResource<PricePoint>(this.deps.resources, "price-history", entityKey, variantKeys, sourceKeys, false);
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
    const entityKey = this.deps.getEntityKey(ticker, context?.instrument);
    const variantKeys = [
      buildPriceHistoryVariantKey([["exchange", canonicalExchange(exchange)], ["range", bufferRange], ["resolution", resolution]], exchange),
      buildPriceHistoryVariantKey([["range", bufferRange], ["resolution", resolution]], exchange),
    ];
    const sourceKeys = [
      ...this.deps.getBrokerCandidatesForContext(context, false).map((candidate) => this.deps.brokerSourceKey(candidate)),
      ...this.deps.getProviderSourceKeys(),
    ];
    const cached = selectCachedArrayResource<PricePoint>(this.deps.resources, "price-history", entityKey, variantKeys, sourceKeys, false);
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
    const entityKey = this.deps.getEntityKey(ticker, context?.instrument);
    const variantKeys = [
      buildPriceHistoryVariantKey([["exchange", canonicalExchange(exchange)], ["start", compactDate(startDate)], ["end", compactDate(endDate)], ["bar", barSize]], exchange),
      buildPriceHistoryVariantKey([["start", compactDate(startDate)], ["end", compactDate(endDate)], ["bar", barSize]], exchange),
    ];
    const sourceKeys = [
      ...this.deps.getBrokerCandidatesForContext(context, false).map((candidate) => this.deps.brokerSourceKey(candidate)),
      ...this.deps.getProviderSourceKeys(),
    ];
    const cached = selectCachedArrayResource<PricePoint>(this.deps.resources, "detailed-price-history", entityKey, variantKeys, sourceKeys, false);
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

  private async fetchBrokerPriceHistory(
    ticker: string,
    exchange: string,
    range: TimeRange,
    context?: MarketDataRequestContext,
  ): Promise<SourceResult<PricePoint[]> | null> {
    const entityKey = this.deps.getEntityKey(ticker, context?.instrument);
    const variantKey = buildPriceHistoryVariantKey([["exchange", canonicalExchange(exchange)], ["range", range]], exchange);
    for (const candidate of this.deps.getBrokerCandidatesForContext(context, false)) {
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
        this.deps.cacheResource(
          "price-history",
          entityKey,
          variantKey,
          this.deps.brokerSourceKey(candidate),
          result,
          this.deps.resolveBrokerPolicy(isIntradayRange(range) ? "priceHistoryIntraday" : "priceHistoryDaily", candidate.broker),
        );
        return { sourceKey: this.deps.brokerSourceKey(candidate), value: result };
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
    const entityKey = this.deps.getEntityKey(ticker, context?.instrument);
    const variantKey = buildPriceHistoryVariantKey([["exchange", canonicalExchange(exchange)], ["range", bufferRange], ["resolution", resolution]], exchange);
    for (const candidate of this.deps.getBrokerCandidatesForContext(context, false)) {
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
        this.deps.cacheResource(
          "price-history",
          entityKey,
          variantKey,
          this.deps.brokerSourceKey(candidate),
          result,
          this.deps.resolveBrokerPolicy(isIntradayResolution(resolution) ? "priceHistoryIntraday" : "priceHistoryDaily", candidate.broker),
        );
        return { sourceKey: this.deps.brokerSourceKey(candidate), value: result };
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
    const entityKey = this.deps.getEntityKey(ticker, context?.instrument);
    const variantKey = buildPriceHistoryVariantKey([["exchange", canonicalExchange(exchange)], ["range", range]], exchange);
    let firstEmptyResult: SourceResult<PricePoint[]> | null = null;

    for (const provider of this.deps.providersInPriorityOrder()) {
      try {
        const value = normalizePriceHistory(await provider.getPriceHistory(ticker, exchange, range, context));
        if (isStaleIntradayHistory(value, isIntradayRange(range), exchange)) continue;
        const sourceKey = this.deps.providerSourceKey(provider);
        this.deps.cacheResource(
          "price-history",
          entityKey,
          variantKey,
          sourceKey,
          value,
          this.deps.resolveProviderPolicy(isIntradayRange(range) ? "priceHistoryIntraday" : "priceHistoryDaily", provider),
        );
        if (value.length > 0) {
          return { sourceKey, value };
        }
        firstEmptyResult ??= { sourceKey, value };
      } catch (error) {
        if (shouldLogProviderError(error)) {
          this.deps.logProviderError(`${provider.id} failed: ${error}`);
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
    const entityKey = this.deps.getEntityKey(ticker, context?.instrument);
    const variantKey = buildPriceHistoryVariantKey([["exchange", canonicalExchange(exchange)], ["range", bufferRange], ["resolution", resolution]], exchange);
    let firstEmptyResult: SourceResult<PricePoint[]> | null = null;

    for (const provider of this.deps.providersInPriorityOrder()) {
      if (!provider.getPriceHistoryForResolution) continue;
      try {
        const value = normalizePriceHistory(await provider.getPriceHistoryForResolution(ticker, exchange, bufferRange, resolution, context));
        if (isStaleIntradayHistory(value, isIntradayResolution(resolution), exchange)) continue;
        const sourceKey = this.deps.providerSourceKey(provider);
        this.deps.cacheResource(
          "price-history",
          entityKey,
          variantKey,
          sourceKey,
          value,
          this.deps.resolveProviderPolicy(isIntradayResolution(resolution) ? "priceHistoryIntraday" : "priceHistoryDaily", provider),
        );
        if (value.length > 0) {
          return { sourceKey, value };
        }
        firstEmptyResult ??= { sourceKey, value };
      } catch (error) {
        if (shouldLogProviderError(error)) {
          this.deps.logProviderError(`${provider.id} failed: ${error}`);
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
    for (const candidate of this.deps.getBrokerCandidatesForContext(context, false)) {
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
        return { sourceKey: this.deps.brokerSourceKey(candidate), value: result };
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
    for (const provider of this.deps.providersInPriorityOrder()) {
      if (!provider.getChartResolutionSupport && !provider.getChartResolutionCapabilities) continue;
      try {
        const result = provider.getChartResolutionSupport
          ? normalizeChartResolutionSupport(await provider.getChartResolutionSupport(ticker, exchange, context))
          : normalizeChartResolutionSupport(
            (await provider.getChartResolutionCapabilities!(ticker, exchange, context)).map((resolution) => ({ resolution, maxRange: "ALL" })),
          );
        if (result.length === 0) continue;
        return { sourceKey: this.deps.providerSourceKey(provider), value: result };
      } catch (error) {
        if (shouldLogProviderError(error)) {
          this.deps.logProviderError(`${provider.id} failed: ${error}`);
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
    const entityKey = this.deps.getEntityKey(ticker, context?.instrument);
    const variantKey = buildPriceHistoryVariantKey([["exchange", canonicalExchange(exchange)], ["start", compactDate(startDate)], ["end", compactDate(endDate)], ["bar", barSize]], exchange);
    for (const candidate of this.deps.getBrokerCandidatesForContext(context, false)) {
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
        this.deps.cacheResource(
          "detailed-price-history",
          entityKey,
          variantKey,
          this.deps.brokerSourceKey(candidate),
          result,
          this.deps.resolveBrokerPolicy("priceHistoryIntraday", candidate.broker),
        );
        return { sourceKey: this.deps.brokerSourceKey(candidate), value: result };
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
    const entityKey = this.deps.getEntityKey(ticker, context?.instrument);
    const variantKey = buildPriceHistoryVariantKey([["exchange", canonicalExchange(exchange)], ["start", compactDate(startDate)], ["end", compactDate(endDate)], ["bar", barSize]], exchange);
    let firstEmptyResult: SourceResult<PricePoint[]> | null = null;

    for (const provider of this.deps.providersInPriorityOrder()) {
      if (!provider.getDetailedPriceHistory) continue;
      try {
        const value = normalizePriceHistory(await provider.getDetailedPriceHistory(ticker, exchange, startDate, endDate, barSize, context));
        if (isCurrentHistoryWindow(endDate) && isPriceHistoryStaleForCurrentWindow(value, Date.now(), { exchange })) continue;
        const sourceKey = this.deps.providerSourceKey(provider);
        this.deps.cacheResource(
          "detailed-price-history",
          entityKey,
          variantKey,
          sourceKey,
          value,
          this.deps.resolveProviderPolicy("priceHistoryIntraday", provider),
        );
        if (value.length > 0) {
          return { sourceKey, value };
        }
        firstEmptyResult ??= { sourceKey, value };
      } catch (error) {
        if (shouldLogProviderError(error)) {
          this.deps.logProviderError(`${provider.id} failed: ${error}`);
        }
      }
    }

    return firstEmptyResult;
  }
}
