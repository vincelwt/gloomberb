import { MarketDataCoordinator, setSharedMarketDataCoordinator } from "../../../market-data/coordinator";
import { createRemoteBrokerAdapter } from "../../../brokers/remote-broker-adapter";
import { NewsService } from "../../../news/aggregator";
import { setSharedNewsService } from "../../../news/hooks";
import { PluginRegistry } from "../../../plugins/registry";
import type { AppServices } from "../../../core/app-services";
import type { AppConfig } from "../../../types/config";
import type { DataProvider, QuoteSubscriptionTarget } from "../../../types/data-provider";
import type { Quote, TickerFinancials } from "../../../types/financials";
import type { NewsArticle, NewsQuery } from "../../../news/types";
import type { TickerRecord, TickerMetadata } from "../../../types/ticker";
import { newsProvider, type CapabilityManifest } from "../../../capabilities";
import {
  createPersistScheduler,
  PLUGIN_STATE_SAVE_DEBOUNCE_MS,
  SESSION_SAVE_DEBOUNCE_MS,
} from "../../../state/persist-scheduler";
import { backendRequest, getElectrobunBackendInitSnapshot, onCapabilityEvent } from "./backend-rpc";
import { DesktopMemoryResourceStore } from "./resource-store";
import { debugLog } from "../../../utils/debug-log";
import { measurePerf } from "../../../utils/perf-marks";
import { getRendererBuiltinPlugins } from "../../../plugins/catalog-ui";

const servicesLog = debugLog.createLogger("services");
const ASSET_DATA_CAPABILITY_ID = "asset-data.asset-data-router";
const NEWS_CAPABILITY_ID = "news.core";
const PLUGIN_STATE_BACKEND_FLUSH_DELAY_MS = 25;

class RemoteTickerRepository {
  async loadAllTickers(): Promise<TickerRecord[]> {
    return backendRequest<TickerRecord[]>("ticker.loadAll");
  }

  async loadTicker(symbol: string): Promise<TickerRecord | null> {
    return backendRequest<TickerRecord | null>("ticker.load", { symbol });
  }

  async saveTicker(ticker: TickerRecord): Promise<void> {
    await backendRequest("ticker.save", { ticker });
  }

  async createTicker(metadata: TickerMetadata): Promise<TickerRecord> {
    const ticker: TickerRecord = { metadata };
    await this.saveTicker(ticker);
    return ticker;
  }

  async deleteTicker(symbol: string): Promise<void> {
    await backendRequest("ticker.delete", { symbol });
  }
}

type RemoteAssetDataClient = DataProvider & {
  getNews(query: NewsQuery): Promise<NewsArticle[]>;
};

type PayloadBuilder = (...args: any[]) => Record<string, unknown>;

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

function createRemoteAssetDataClient(): RemoteAssetDataClient {
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

  const base = {
    id: "desktop-backend",
    name: "Gloomberb Backend",
    getCachedFinancialsForTargets: (targets, options) => (
      hasRendererOperation(assetDataOperations, "getCachedFinancialsForTargets")
        ? invoke<Map<string, TickerFinancials>>(ASSET_DATA_CAPABILITY_ID, "getCachedFinancialsForTargets", { targets, options })
        : new Map()
    ),
    getNews: (query: NewsQuery) => (
      hasRendererOperation(newsOperations, "fetchNews")
        ? invoke<NewsArticle[]>(NEWS_CAPABILITY_ID, "fetchNews", { query })
        : Promise.resolve([])
    ),
    subscribeQuotes: (
      targets: QuoteSubscriptionTarget[],
      onQuote: (target: QuoteSubscriptionTarget, quote: Quote) => void,
    ) => {
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

class RemoteSessionStore {
  private snapshot = getElectrobunBackendInitSnapshot()?.sessionSnapshot ?? null;
  private readonly scheduler = createPersistScheduler<{
    sessionId: string;
    value: unknown;
    schemaVersion: number;
  }>({
    delayMs: SESSION_SAVE_DEBOUNCE_MS,
    save: ({ sessionId, value, schemaVersion }) => backendRequest("session.set", { sessionId, value, schemaVersion }),
  });

  get<T>(sessionId = "app", schemaVersion = 1) {
    if (sessionId !== "app" || !this.snapshot) return null;
    return {
      sessionId,
      value: this.snapshot as T,
      schemaVersion,
      updatedAt: Date.now(),
    };
  }

  set(sessionId: string, value: unknown, schemaVersion = 1): void {
    if (sessionId === "app") this.snapshot = value as typeof this.snapshot;
    this.scheduler.schedule({ sessionId, value, schemaVersion });
  }

  delete(sessionId: string): void {
    if (sessionId === "app") this.snapshot = null;
    this.scheduler.cancel();
    void backendRequest("session.delete", { sessionId }).catch(() => {});
  }

  flush(): Promise<void> {
    return this.scheduler.flush();
  }
}

interface PluginStatePersistEntry {
  pluginId: string;
  key: string;
  value: unknown;
  schemaVersion: number;
}

class RemotePluginStateStore {
  private readonly state = new Map<string, Map<string, unknown>>();
  private readonly schedulers = new Map<string, ReturnType<typeof createPersistScheduler<PluginStatePersistEntry>>>();
  private readonly pendingBackendSaves = new Map<string, PluginStatePersistEntry>();
  private backendSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private backendSaveInFlight: Promise<void> = Promise.resolve();

  constructor(initial: Record<string, Record<string, unknown>>) {
    for (const [pluginId, values] of Object.entries(initial)) {
      this.state.set(pluginId, new Map(Object.entries(values)));
    }
  }

  get<T>(pluginId: string, key: string, schemaVersion = 1) {
    const value = this.state.get(pluginId)?.get(key);
    if (value == null) return null;
    return { value: value as T, schemaVersion, updatedAt: Date.now() };
  }

  set(pluginId: string, key: string, value: unknown, schemaVersion = 1): void {
    if (!this.state.has(pluginId)) this.state.set(pluginId, new Map());
    this.state.get(pluginId)!.set(key, value);
    this.getScheduler(pluginId, key).schedule({ pluginId, key, value, schemaVersion });
  }

  delete(pluginId: string, key: string): void {
    this.state.get(pluginId)?.delete(key);
    this.getScheduler(pluginId, key).cancel();
    this.pendingBackendSaves.delete(this.schedulerKey(pluginId, key));
    void this.backendSaveInFlight
      .catch(() => {})
      .then(() => backendRequest("pluginState.delete", { pluginId, key }))
      .catch(() => {});
  }

  keys(pluginId: string): string[] {
    return [...(this.state.get(pluginId)?.keys() ?? [])];
  }

  clear(pluginId: string): void {
    this.state.delete(pluginId);
  }

  async flush(): Promise<void> {
    await Promise.all([...this.schedulers.values()].map((scheduler) => scheduler.flush()));
    await this.flushBackendSaves();
  }

  private getScheduler(pluginId: string, key: string) {
    const schedulerKey = this.schedulerKey(pluginId, key);
    let scheduler = this.schedulers.get(schedulerKey);
    if (!scheduler) {
      scheduler = createPersistScheduler({
        delayMs: PLUGIN_STATE_SAVE_DEBOUNCE_MS,
        save: (entry) => {
          this.scheduleBackendSave(entry);
        },
      });
      this.schedulers.set(schedulerKey, scheduler);
    }
    return scheduler;
  }

  private schedulerKey(pluginId: string, key: string): string {
    return `${pluginId}\u0000${key}`;
  }

  private scheduleBackendSave(entry: PluginStatePersistEntry): void {
    this.pendingBackendSaves.set(this.schedulerKey(entry.pluginId, entry.key), entry);
    if (this.backendSaveTimer) return;
    this.backendSaveTimer = setTimeout(() => {
      void this.flushBackendSaves();
    }, PLUGIN_STATE_BACKEND_FLUSH_DELAY_MS);
  }

  private async flushBackendSaves(): Promise<void> {
    if (this.backendSaveTimer) {
      clearTimeout(this.backendSaveTimer);
      this.backendSaveTimer = null;
    }
    if (this.pendingBackendSaves.size === 0) return this.backendSaveInFlight;

    const entries = [...this.pendingBackendSaves.values()];
    this.pendingBackendSaves.clear();
    const save = this.backendSaveInFlight
      .catch(() => {})
      .then(() => backendRequest<void>("pluginState.setMany", { entries }))
      .catch(() => {});
    this.backendSaveInFlight = save;
    return save;
  }
}

class RemotePersistence {
  readonly tickers = {};
  readonly resources = new DesktopMemoryResourceStore();
  readonly pluginState = new RemotePluginStateStore(getElectrobunBackendInitSnapshot()?.pluginState ?? {});
  readonly sessions = new RemoteSessionStore();
  close(): void {
    void this.sessions.flush();
    void this.pluginState.flush();
  }
}

export function createAppServices({ config }: { config: AppConfig }): AppServices {
  servicesLog.info("create desktop web services start", {
    brokerInstanceCount: config.brokerInstances.length,
  });
  const persistence = measurePerf("startup.services.persistence", () => new RemotePersistence());
  const tickerRepository = measurePerf("startup.services.ticker-repository", () => new RemoteTickerRepository());
  const dataProvider = measurePerf("startup.services.data-provider", () => createRemoteAssetDataClient());
  const marketData = new MarketDataCoordinator(dataProvider);
  const pluginRegistry = new PluginRegistry(dataProvider, tickerRepository as never, persistence as never, {
    enableCapabilityHandlers: false,
    wrapBrokerAdapter: (broker) => createRemoteBrokerAdapter(broker),
  });
  const newsService = new NewsService();

  pluginRegistry.getConfigFn = () => config;
  pluginRegistry.getLayoutFn = () => config.layout;
  pluginRegistry.registerNewsCapabilityFn = () => () => {};
  pluginRegistry.watchNewsQueryFn = (query, listener) => newsService.watchQuery(query, listener);

  setSharedMarketDataCoordinator(marketData);
  setSharedNewsService(newsService);

  newsService.register(newsProvider({
    id: dataProvider.id,
    name: dataProvider.name,
    priority: 0,
    provider: {
      fetchNews: (query) => dataProvider.getNews(query),
    },
  }));

  const plugins = getRendererBuiltinPlugins();
  for (const plugin of plugins) {
    measurePerf("startup.services.register-plugin", () => {
      void pluginRegistry.register(plugin);
    }, { pluginId: plugin.id });
  }
  measurePerf("startup.services.news-start", () => {
    newsService.start();
  });
  servicesLog.info("create desktop web services complete", { pluginCount: plugins.length });

  return {
    persistence: persistence as never,
    tickerRepository: tickerRepository as never,
    providerRouter: dataProvider as never,
    dataProvider,
    marketData,
    pluginRegistry,
    newsService,
    destroy() {
      setSharedMarketDataCoordinator(null);
      setSharedNewsService(null);
      newsService.stop();
      pluginRegistry.destroy();
      persistence.close();
    },
  };
}
