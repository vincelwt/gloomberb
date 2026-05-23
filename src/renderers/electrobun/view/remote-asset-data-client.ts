import type { CapabilityManifest } from "../../../capabilities";
import type { NewsArticle, NewsQuery } from "../../../news/types";
import type { DataProvider, QuoteSubscriptionTarget } from "../../../types/data-provider";
import type { Quote, TickerFinancials } from "../../../types/financials";
import { backendRequest, getElectrobunBackendInitSnapshot, onCapabilityEvent } from "./backend-rpc";

const ASSET_DATA_CAPABILITY_ID = "asset-data.asset-data-router";
const NEWS_CAPABILITY_ID = "news.core";

export type RemoteAssetDataClient = DataProvider & {
  getNews(query: NewsQuery): Promise<NewsArticle[]>;
};

interface RemoteAssetDataClientBase {
  id: string;
  name: string;
  getCachedFinancialsForTargets: NonNullable<DataProvider["getCachedFinancialsForTargets"]>;
  getNews(query: NewsQuery): Promise<NewsArticle[]>;
  subscribeQuotes: NonNullable<DataProvider["subscribeQuotes"]>;
}

type PayloadBuilder = (...args: unknown[]) => Record<string, unknown>;

const assetDataPayloads: Record<string, PayloadBuilder> = {
  canProvide: (ticker, exchange, context) => ({ ticker, exchange, context }),
  getCachedFinancialsForTargets: (targets, options) => ({ targets, options }),
  getQuotesBatch: (targets, options) => ({ targets, options }),
  getTickerFinancialsBatch: (targets, options) => ({ targets, options }),
  getTickerFinancials: (ticker, exchange, context) => ({ ticker, exchange, context }),
  getQuote: (ticker, exchange, context) => ({ ticker, exchange, context }),
  getExchangeRate: (fromCurrency) => ({ fromCurrency }),
  search: (query, context) => ({ query, context }),
  getSecFilings: (ticker, count, exchange, context) => ({ ticker, count, exchange, context }),
  getHolders: (ticker, exchange, context) => ({ ticker, exchange, context }),
  getAnalystResearch: (ticker, exchange, context) => ({ ticker, exchange, context }),
  getCorporateActions: (ticker, exchange, context) => ({ ticker, exchange, context }),
  getSecFilingContent: (filing) => ({ filing }),
  getEarningsCalendar: (symbols, context) => ({ symbols, context }),
  getArticleSummary: (url) => ({ url }),
  getPriceHistory: (ticker, exchange, range, context) => ({ ticker, exchange, range, context }),
  getPriceHistoryForResolution: (ticker, exchange, bufferRange, resolution, context) => ({ ticker, exchange, bufferRange, resolution, context }),
  getDetailedPriceHistory: (ticker, exchange, startDate, endDate, barSize, context) => ({ ticker, exchange, startDate, endDate, barSize, context }),
  getChartResolutionSupport: (ticker, exchange, context) => ({ ticker, exchange, context }),
  getChartResolutionCapabilities: (ticker, exchange, context) => ({ ticker, exchange, context }),
  getOptionsChain: (ticker, exchange, expirationDate, context) => ({ ticker, exchange, expirationDate, context }),
};

function findCapabilityManifest(capabilityId: string): CapabilityManifest | null {
  return getElectrobunBackendInitSnapshot()?.capabilityManifests.find((manifest) => manifest.id === capabilityId) ?? null;
}

function getRendererOperationIds(capabilityId: string): Set<string> | null {
  const manifest = findCapabilityManifest(capabilityId);
  if (!manifest) return null;
  return new Set(
    manifest.operations
      .filter((operation) => operation.rendererSafe)
      .map((operation) => operation.id),
  );
}

function hasRendererOperation(operations: Set<string> | null, operationId: string): boolean {
  return operations === null || operations.has(operationId);
}

function createCapabilityInvoker() {
  const inFlightRequests = new Map<string, Promise<unknown>>();
  return function invoke<T>(capabilityId: string, operationId: string, payload: unknown): Promise<T> {
    const requestPayload = { capabilityId, operationId, payload };
    const key = JSON.stringify(requestPayload);
    const inFlight = inFlightRequests.get(key);
    if (inFlight) return inFlight as Promise<T>;
    const promise = backendRequest<T>("capability.invoke", requestPayload).finally(() => {
      inFlightRequests.delete(key);
    });
    inFlightRequests.set(key, promise);
    return promise;
  };
}

export function createRemoteAssetDataClient(): RemoteAssetDataClient {
  const invoke = createCapabilityInvoker();
  const assetDataOperations = getRendererOperationIds(ASSET_DATA_CAPABILITY_ID);
  const newsOperations = getRendererOperationIds(NEWS_CAPABILITY_ID);
  let nextSubscriptionId = 1;
  const quoteListeners = new Map<string, {
    target: QuoteSubscriptionTarget;
    listeners: Set<(target: QuoteSubscriptionTarget, quote: Quote) => void>;
  }>();
  let quoteBackendSubscriptionId: string | null = null;
  let disposeQuoteBackendMessages: (() => void) | null = null;
  let quoteBackendFlushTimer: ReturnType<typeof setTimeout> | null = null;

  const quoteTargetKey = (target: QuoteSubscriptionTarget) =>
    `${target.symbol}:${target.exchange ?? ""}:${target.context?.brokerId ?? ""}:${target.context?.brokerInstanceId ?? ""}:${target.context?.instrument?.conId ?? target.context?.instrument?.localSymbol ?? ""}`;

  const scheduleQuoteBackendSubscriptionFlush = () => {
    if (quoteBackendFlushTimer) return;
    quoteBackendFlushTimer = setTimeout(() => {
      quoteBackendFlushTimer = null;
      flushQuoteBackendSubscription();
    }, 25);
  };

  const flushQuoteBackendSubscription = () => {
    if (!hasRendererOperation(assetDataOperations, "subscribeQuotes")) return;
    const targets = [...quoteListeners.values()].map((entry) => entry.target);
    const previousSubscriptionId = quoteBackendSubscriptionId;
    if (previousSubscriptionId) {
      quoteBackendSubscriptionId = null;
      disposeQuoteBackendMessages?.();
      disposeQuoteBackendMessages = null;
      void backendRequest("capability.unsubscribe", { subscriptionId: previousSubscriptionId }).catch(() => {});
    }
    if (targets.length === 0) return;

    const subscriptionId = `quote:${nextSubscriptionId++}`;
    quoteBackendSubscriptionId = subscriptionId;
    disposeQuoteBackendMessages = onCapabilityEvent(subscriptionId, (message) => {
      const event = message.event as { target: QuoteSubscriptionTarget; quote: Quote };
      const key = quoteTargetKey(event.target);
      for (const listener of quoteListeners.get(key)?.listeners ?? []) {
        listener(event.target, event.quote);
      }
    });
    void backendRequest("capability.subscribe", {
      subscriptionId,
      capabilityId: ASSET_DATA_CAPABILITY_ID,
      operationId: "subscribeQuotes",
      payload: { targets },
    }).catch((error) => {
      if (quoteBackendSubscriptionId === subscriptionId) {
        quoteBackendSubscriptionId = null;
        disposeQuoteBackendMessages?.();
        disposeQuoteBackendMessages = null;
      }
      console.error("Failed to subscribe to backend quotes", error);
    });
  };

  const base: RemoteAssetDataClientBase = {
    id: "desktop-backend",
    name: "Gloomberb Backend",
    getCachedFinancialsForTargets: (targets, options) => (
      hasRendererOperation(assetDataOperations, "getCachedFinancialsForTargets")
        ? invoke<Map<string, TickerFinancials>>(ASSET_DATA_CAPABILITY_ID, "getCachedFinancialsForTargets", { targets, options })
        : new Map()
    ),
    getNews: (query) => (
      hasRendererOperation(newsOperations, "fetchNews")
        ? invoke<NewsArticle[]>(NEWS_CAPABILITY_ID, "fetchNews", { query })
        : Promise.resolve([])
    ),
    subscribeQuotes: (targets, onQuote) => {
      if (!hasRendererOperation(assetDataOperations, "subscribeQuotes")) return () => {};
      const uniqueTargets = [...new Map(
        targets.map((target) => [
          `${target.symbol}:${target.exchange ?? ""}:${target.context?.brokerId ?? ""}:${target.context?.brokerInstanceId ?? ""}`,
          target,
        ] as const),
      ).values()];
      if (uniqueTargets.length === 0) return () => {};

      let disposed = false;
      for (const target of uniqueTargets) {
        const key = quoteTargetKey(target);
        const entry = quoteListeners.get(key) ?? { target, listeners: new Set() };
        entry.target = target;
        entry.listeners.add(onQuote);
        quoteListeners.set(key, entry);
      }
      scheduleQuoteBackendSubscriptionFlush();

      return () => {
        if (disposed) return;
        disposed = true;
        for (const target of uniqueTargets) {
          const key = quoteTargetKey(target);
          const entry = quoteListeners.get(key);
          if (!entry) continue;
          entry.listeners.delete(onQuote);
          if (entry.listeners.size === 0) {
            quoteListeners.delete(key);
          }
        }
        scheduleQuoteBackendSubscriptionFlush();
      };
    },
  };

  return new Proxy(base, {
    get(target, prop, receiver) {
      if (typeof prop !== "string" || prop in target) {
        return Reflect.get(target, prop, receiver);
      }
      const buildPayload = assetDataPayloads[prop];
      if (!buildPayload || !hasRendererOperation(assetDataOperations, prop)) return undefined;
      return (...args: unknown[]) => invoke(ASSET_DATA_CAPABILITY_ID, prop, buildPayload(...args));
    },
  }) as RemoteAssetDataClient;
}
