import { MarketDataCoordinator, setSharedMarketDataCoordinator } from "../../../market-data/coordinator";
import { NewsService } from "../../../news/aggregator";
import { setSharedNewsService } from "../../../news/hooks";
import { uiBuiltinPlugins } from "../../../plugins/catalog-ui";
import { PluginRegistry } from "../../../plugins/registry";
import type { AppServices } from "../../../core/app-services";
import type { AppConfig } from "../../../types/config";
import type { DataProvider, MarketDataRequestContext, SearchRequestContext, QuoteSubscriptionTarget } from "../../../types/data-provider";
import type { TickerFinancials, Quote } from "../../../types/financials";
import type { BrokerContractRef, InstrumentSearchResult } from "../../../types/instrument";
import type { TickerRecord, TickerMetadata } from "../../../types/ticker";
import type { TimeRange } from "../../../components/chart/chart-types";
import type { ManualChartResolution } from "../../../components/chart/chart-resolution";
import {
  createPersistScheduler,
  PLUGIN_STATE_SAVE_DEBOUNCE_MS,
  SESSION_SAVE_DEBOUNCE_MS,
} from "../../../state/persist-scheduler";
import { backendRequest, getTauriBackendInitSnapshot } from "./backend-rpc";
import { TauriMemoryResourceStore } from "./resource-store";
import { debugLog } from "../../../utils/debug-log";
import { measurePerf } from "../../../utils/perf-marks";

const REMOTE_DATA_REQUEST_CACHE_LIMIT = 150;
const servicesLog = debugLog.createLogger("services");

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

class RemoteDataProvider implements DataProvider {
  readonly id = "tauri-backend";
  readonly name = "Gloomberb Backend";
  private readonly requestCache = new Map<string, Promise<unknown>>();

  private cachedRequest<T>(method: string, payload: unknown): Promise<T> {
    const key = `${method}:${JSON.stringify(payload)}`;
    const cached = this.requestCache.get(key);
    if (cached) return cached as Promise<T>;
    const promise = backendRequest<T>(method, payload).catch((error) => {
      this.requestCache.delete(key);
      throw error;
    });
    this.requestCache.set(key, promise);
    if (this.requestCache.size > REMOTE_DATA_REQUEST_CACHE_LIMIT) {
      const oldestKey = this.requestCache.keys().next().value;
      if (oldestKey) this.requestCache.delete(oldestKey);
    }
    return promise;
  }

  getCachedFinancialsForTargets(): Map<string, TickerFinancials> {
    return new Map();
  }

  getTickerFinancials(ticker: string, exchange?: string, context?: MarketDataRequestContext): Promise<TickerFinancials> {
    return backendRequest("data.getTickerFinancials", { ticker, exchange, context });
  }

  getQuote(ticker: string, exchange?: string, context?: MarketDataRequestContext): Promise<Quote> {
    return backendRequest("data.getQuote", { ticker, exchange, context });
  }

  getExchangeRate(fromCurrency: string): Promise<number> {
    return backendRequest("data.getExchangeRate", { fromCurrency });
  }

  search(query: string, context?: SearchRequestContext): Promise<InstrumentSearchResult[]> {
    return backendRequest("data.search", { query, context });
  }

  getNews(ticker: string, count?: number, exchange?: string, context?: MarketDataRequestContext) {
    return this.cachedRequest("data.getNews", { ticker, count, exchange, context });
  }

  getSecFilings(ticker: string, count?: number, exchange?: string, context?: MarketDataRequestContext) {
    return this.cachedRequest("data.getSecFilings", { ticker, count, exchange, context });
  }

  getSecFilingContent(filing: unknown): Promise<string | null> {
    return this.cachedRequest("data.getSecFilingContent", { filing });
  }

  getEarningsCalendar(symbols: string[], context?: MarketDataRequestContext) {
    return backendRequest("data.getEarningsCalendar", { symbols, context });
  }

  getArticleSummary(url: string): Promise<string | null> {
    return this.cachedRequest("data.getArticleSummary", { url });
  }

  getPriceHistory(ticker: string, exchange: string, range: TimeRange, context?: MarketDataRequestContext) {
    return this.cachedRequest("data.getPriceHistory", { ticker, exchange, range, context });
  }

  getPriceHistoryForResolution(
    ticker: string,
    exchange: string,
    bufferRange: TimeRange,
    resolution: ManualChartResolution,
    context?: MarketDataRequestContext,
  ) {
    return this.cachedRequest("data.getPriceHistoryForResolution", { ticker, exchange, bufferRange, resolution, context });
  }

  getDetailedPriceHistory(
    ticker: string,
    exchange: string,
    startDate: Date,
    endDate: Date,
    barSize: string,
    context?: MarketDataRequestContext,
  ) {
    return this.cachedRequest("data.getDetailedPriceHistory", { ticker, exchange, startDate, endDate, barSize, context });
  }

  getChartResolutionSupport(ticker: string, exchange?: string, context?: MarketDataRequestContext) {
    return this.cachedRequest("data.getChartResolutionSupport", { ticker, exchange, context });
  }

  getOptionsChain(ticker: string, exchange?: string, expirationDate?: number, context?: MarketDataRequestContext) {
    return this.cachedRequest("data.getOptionsChain", { ticker, exchange, expirationDate, context });
  }

  subscribeQuotes(
    _targets: QuoteSubscriptionTarget[],
    _onQuote: (target: QuoteSubscriptionTarget, quote: Quote) => void,
  ): () => void {
    return () => {};
  }
}

class RemoteSessionStore {
  private snapshot = getTauriBackendInitSnapshot()?.sessionSnapshot ?? null;
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
  readonly resources = new TauriMemoryResourceStore();
  readonly pluginState = new RemotePluginStateStore(getTauriBackendInitSnapshot()?.pluginState ?? {});
  readonly sessions = new RemoteSessionStore();
  close(): void {
    void this.sessions.flush();
    void this.pluginState.flush();
  }
}

export function createAppServices({ config }: { config: AppConfig }): AppServices {
  servicesLog.info("create tauri web services start", {
    brokerInstanceCount: config.brokerInstances.length,
  });
  const persistence = measurePerf("startup.services.persistence", () => new RemotePersistence());
  const tickerRepository = measurePerf("startup.services.ticker-repository", () => new RemoteTickerRepository());
  const dataProvider = measurePerf("startup.services.data-provider", () => new RemoteDataProvider());
  const marketData = new MarketDataCoordinator(dataProvider);
  const pluginRegistry = new PluginRegistry(dataProvider, tickerRepository as never, persistence as never);
  const newsService = new NewsService();

  pluginRegistry.getConfigFn = () => config;
  pluginRegistry.getLayoutFn = () => config.layout;
  pluginRegistry.registerNewsSourceFn = (source) => newsService.register(source);

  setSharedMarketDataCoordinator(marketData);
  setSharedNewsService(newsService);

  for (const plugin of uiBuiltinPlugins) {
    measurePerf("startup.services.register-plugin", () => {
      void pluginRegistry.register(plugin);
    }, { pluginId: plugin.id });
  }
  measurePerf("startup.services.news-start", () => {
    newsService.start();
  });
  servicesLog.info("create tauri web services complete", { pluginCount: uiBuiltinPlugins.length });

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
