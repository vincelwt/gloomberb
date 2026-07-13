import type { DataProvider, SearchRequestContext } from "../../types/data-provider";
import type { InstrumentSearchResult } from "../../types/instrument";
import type { BrokerCandidate } from "./brokers";
import { shouldLogProviderError } from "../provider-errors";

const SEARCH_CACHE_TTL_MS = 30_000;
const SEARCH_CACHE_MAX_ENTRIES = 100;

const SEARCH_PROVIDER_TIMEOUT_MS = 5_000;

interface BrokerSearchCandidate {
  brokerId: string;
  brokerInstanceId: string;
  brokerLabel: string;
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

function buildSearchCacheKey(query: string, context?: SearchRequestContext): string {
  return JSON.stringify([
    query.trim().toUpperCase(),
    context?.preferBroker ?? true,
    context?.brokerInstanceId ?? "",
    context?.brokerId ?? "",
  ]);
}

function mergeSearchResults(
  results: InstrumentSearchResult[],
  resultIndexByKey: Map<string, number>,
  items: InstrumentSearchResult[],
  context?: SearchRequestContext,
): void {
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
}

function annotateBrokerSearchResults(
  items: InstrumentSearchResult[],
  candidate: BrokerSearchCandidate,
): InstrumentSearchResult[] {
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

export interface ProviderRouterSearchDeps {
  getBrokerCandidates(preferredBrokerInstanceId?: string, preferredBrokerId?: string): BrokerCandidate[];
  providersInPriorityOrder(): DataProvider[];
  logProviderError(message: string): void;
}

export class ProviderRouterSearchRoutes {
  private readonly searchCache = new Map<string, { expiresAt: number; results: InstrumentSearchResult[] }>();
  private readonly searchInFlight = new Map<string, Promise<InstrumentSearchResult[]>>();

  constructor(private readonly deps: ProviderRouterSearchDeps) {}

  async search(query: string, context?: SearchRequestContext): Promise<InstrumentSearchResult[]> {
    const cacheKey = buildSearchCacheKey(query, context);
    const cached = this.searchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.results;
    if (cached) this.searchCache.delete(cacheKey);
    const inFlight = this.searchInFlight.get(cacheKey);
    if (inFlight) return inFlight;

    const task = this.fetchSearchResults(query, context, cacheKey).finally(() => {
      this.searchInFlight.delete(cacheKey);
    });

    this.searchInFlight.set(cacheKey, task);
    return task;
  }

  private async fetchSearchResults(
    query: string,
    context: SearchRequestContext | undefined,
    cacheKey: string,
  ): Promise<InstrumentSearchResult[]> {
    const results: InstrumentSearchResult[] = [];
    const resultIndexByKey = new Map<string, number>();
    const cacheResults = (ttl = SEARCH_CACHE_TTL_MS) => {
      this.searchCache.set(cacheKey, {
        expiresAt: Date.now() + ttl,
        results,
      });
      if (this.searchCache.size > SEARCH_CACHE_MAX_ENTRIES) {
        this.searchCache.delete(this.searchCache.keys().next().value!);
      }
    };
    const push = (items: InstrumentSearchResult[]) => {
      mergeSearchResults(results, resultIndexByKey, items, context);
    };

    if (context?.preferBroker !== false) {
      for (const candidate of this.deps.getBrokerCandidates(
        context?.brokerInstanceId,
        context?.brokerId,
      )) {
        if (!candidate.broker.searchInstruments) continue;
        try {
          const items = await withSearchTimeout(candidate.broker.searchInstruments(query, candidate.instance));
          if (!items) continue;
          push(annotateBrokerSearchResults(items, candidate));
          if (results.length > 0) {
            cacheResults();
            return results;
          }
        } catch {
          // continue through broker candidates
        }
      }
    }

    for (const provider of this.deps.providersInPriorityOrder()) {
      try {
        const items = await withSearchTimeout(provider.search(query, context));
        if (!items) continue;
        push(items);
        if (results.length > 0) {
          cacheResults();
          return results;
        }
      } catch (error) {
        if (shouldLogProviderError(error)) {
          this.deps.logProviderError(`${provider.id} failed: ${error}`);
        }
      }
    }

    cacheResults(Math.min(SEARCH_CACHE_TTL_MS, 5_000));
    return results;
  }
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
