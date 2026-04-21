import { join } from "path";
import { AppPersistence } from "../data/app-persistence";
import { TickerRepository } from "../data/ticker-repository";
import { MarketDataCoordinator, setSharedMarketDataCoordinator } from "../market-data/coordinator";
import { NewsService } from "../news/aggregator";
import { setSharedNewsService } from "../news/hooks";
import { getLoadablePlugins } from "../plugins/catalog";
import type { LoadedExternalPlugin } from "../plugins/loader";
import { PluginRegistry } from "../plugins/registry";
import { ProviderRouter } from "../sources/provider-router";
import type { AppConfig } from "../types/config";
import type { DataProvider } from "../types/data-provider";
import { debugLog } from "../utils/debug-log";
import { measurePerf } from "../utils/perf-marks";

const servicesLog = debugLog.createLogger("services");

export interface AppServices {
  persistence: AppPersistence;
  tickerRepository: TickerRepository;
  providerRouter: ProviderRouter;
  dataProvider: DataProvider;
  marketData: MarketDataCoordinator;
  pluginRegistry: PluginRegistry;
  newsService: NewsService;
  destroy(): void;
}

export function createAppServices({
  config,
  externalPlugins,
}: {
  config: AppConfig;
  externalPlugins: LoadedExternalPlugin[];
}): AppServices {
  servicesLog.info("create services start", {
    externalPluginCount: externalPlugins.length,
    brokerInstanceCount: config.brokerInstances.length,
  });
  const dbPath = join(config.dataDir, ".gloomberb-cache.db");
  const persistence = measurePerf("startup.services.persistence", () => new AppPersistence(dbPath));
  const tickerRepository = measurePerf("startup.services.ticker-repository", () => new TickerRepository(persistence.tickers));
  const providerRouter = measurePerf("startup.services.provider-router", () => new ProviderRouter(null, [], persistence.resources));
  const dataProvider: DataProvider = providerRouter;
  const marketData = new MarketDataCoordinator(dataProvider);
  const pluginRegistry = new PluginRegistry(dataProvider, tickerRepository, persistence);
  const newsService = new NewsService();

  providerRouter.attachRegistry(pluginRegistry);
  pluginRegistry.getConfigFn = () => config;
  pluginRegistry.getLayoutFn = () => config.layout;
  pluginRegistry.registerNewsSourceFn = (source) => newsService.register(source);
  pluginRegistry.watchNewsQueryFn = (query, listener) => newsService.watchQuery(query, listener);

  setSharedNewsService(newsService);
  setSharedMarketDataCoordinator(marketData);

  const plugins = getLoadablePlugins(externalPlugins);
  for (const plugin of plugins) {
    measurePerf("startup.services.register-plugin", () => {
      void pluginRegistry.register(plugin);
    }, { pluginId: plugin.id });
  }
  measurePerf("startup.services.news-start", () => {
    newsService.start();
  });
  servicesLog.info("create services complete", { pluginCount: plugins.length });

  return {
    persistence,
    tickerRepository,
    providerRouter,
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
