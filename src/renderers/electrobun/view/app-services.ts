import { MarketDataCoordinator, setSharedMarketDataCoordinator } from "../../../market-data/coordinator";
import { createRemoteBrokerAdapter } from "../../../brokers/remote-broker-adapter";
import { NewsService } from "../../../news/aggregator";
import { setSharedNewsService } from "../../../news/hooks";
import { PluginRegistry } from "../../../plugins/registry";
import type { AppServices } from "../../../core/app-services";
import type { AppConfig } from "../../../types/config";
import type { DataProvider, QuoteSubscriptionTarget } from "../../../types/data-provider";
import type { Quote } from "../../../types/financials";
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

const REMOTE_DATA_REQUEST_CACHE_LIMIT = 150;
const servicesLog = debugLog.createLogger("services");
const ASSET_DATA_CAPABILITY_ID = "asset-data.asset-data-router";
const NEWS_CAPABILITY_ID = "news.core";

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
  const requestCache = new Map<string, Promise<unknown>>();
  return function invoke<T>(capabilityId: string, operationId: string, payload: unknown): Promise<T> {
    const requestPayload = { capabilityId, operationId, payload };
    const key = JSON.stringify(requestPayload);
    const cached = requestCache.get(key);
    if (cached) return cached as Promise<T>;
    const promise = backendRequest<T>("capability.invoke", requestPayload).catch((error) => {
      requestCache.delete(key);
      throw error;
    });
    requestCache.set(key, promise);
    if (requestCache.size > REMOTE_DATA_REQUEST_CACHE_LIMIT) {
      const oldestKey = requestCache.keys().next().value;
      if (oldestKey) requestCache.delete(oldestKey);
    }
    return promise;
  };
}

function createRemoteAssetDataClient(): RemoteAssetDataClient {
  const invoke = createCapabilityInvoker();
  const assetDataOperations = getRendererOperationIds(ASSET_DATA_CAPABILITY_ID);
  const newsOperations = getRendererOperationIds(NEWS_CAPABILITY_ID);
  let nextSubscriptionId = 1;
  const base = {
    id: "desktop-backend",
    name: "Gloomberb Backend",
    getCachedFinancialsForTargets: () => new Map(),
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

      const subscriptionId = `quote:${nextSubscriptionId++}`;
      const disposeMessages = onCapabilityEvent(subscriptionId, (message) => {
        const event = message.event as { target: QuoteSubscriptionTarget; quote: Quote };
        onQuote(event.target, event.quote);
      });
      let disposed = false;

      void backendRequest("capability.subscribe", {
        subscriptionId,
        capabilityId: ASSET_DATA_CAPABILITY_ID,
        operationId: "subscribeQuotes",
        payload: { targets: uniqueTargets },
      }).catch((error) => {
        disposeMessages();
        console.error("Failed to subscribe to backend quotes", error);
      });

      return () => {
        if (disposed) return;
        disposed = true;
        disposeMessages();
        void backendRequest("capability.unsubscribe", { subscriptionId }).catch(() => {});
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

class RemotePluginStateStore {
  private readonly state = new Map<string, Map<string, unknown>>();
  private readonly schedulers = new Map<string, ReturnType<typeof createPersistScheduler<{
    pluginId: string;
    key: string;
    value: unknown;
    schemaVersion: number;
  }>>>();

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
    void backendRequest("pluginState.delete", { pluginId, key }).catch(() => {});
  }

  keys(pluginId: string): string[] {
    return [...(this.state.get(pluginId)?.keys() ?? [])];
  }

  clear(pluginId: string): void {
    this.state.delete(pluginId);
  }

  async flush(): Promise<void> {
    await Promise.all([...this.schedulers.values()].map((scheduler) => scheduler.flush()));
  }

  private getScheduler(pluginId: string, key: string) {
    const schedulerKey = `${pluginId}\u0000${key}`;
    let scheduler = this.schedulers.get(schedulerKey);
    if (!scheduler) {
      scheduler = createPersistScheduler({
        delayMs: PLUGIN_STATE_SAVE_DEBOUNCE_MS,
        save: (entry) => backendRequest("pluginState.set", entry),
      });
      this.schedulers.set(schedulerKey, scheduler);
    }
    return scheduler;
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
