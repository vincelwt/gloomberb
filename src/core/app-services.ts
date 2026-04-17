import { join } from "path";
import { AppPersistence } from "../data/app-persistence";
import { TickerRepository } from "../data/ticker-repository";
import { MarketDataCoordinator, setSharedMarketDataCoordinator } from "../market-data/coordinator";
import { NewsAggregator } from "../news/aggregator";
import { setSharedNewsAggregator } from "../news/hooks";
import { getLoadablePlugins } from "../plugins/catalog";
import type { LoadedExternalPlugin } from "../plugins/loader";
import { PluginRegistry } from "../plugins/registry";
import { ProviderRouter } from "../sources/provider-router";
import type { AppConfig } from "../types/config";
import type { DataProvider } from "../types/data-provider";

export interface AppServices {
  persistence: AppPersistence;
  tickerRepository: TickerRepository;
  providerRouter: ProviderRouter;
  dataProvider: DataProvider;
  marketData: MarketDataCoordinator;
  pluginRegistry: PluginRegistry;
  newsAggregator: NewsAggregator;
  destroy(): void;
}

export function createAppServices({
  config,
  externalPlugins,
}: {
  config: AppConfig;
  externalPlugins: LoadedExternalPlugin[];
}): AppServices {
  const dbPath = join(config.dataDir, ".gloomberb-cache.db");
  const persistence = new AppPersistence(dbPath);
  const tickerRepository = new TickerRepository(persistence.tickers);
  const providerRouter = new ProviderRouter(null, [], persistence.resources);
  const dataProvider: DataProvider = providerRouter;
  const marketData = new MarketDataCoordinator(dataProvider);
  const pluginRegistry = new PluginRegistry(dataProvider, tickerRepository, persistence);
  const newsAggregator = new NewsAggregator();

  providerRouter.attachRegistry(pluginRegistry);
  pluginRegistry.getConfigFn = () => config;
  pluginRegistry.getLayoutFn = () => config.layout;
  pluginRegistry.registerNewsSourceFn = (source) => newsAggregator.register(source);

  setSharedNewsAggregator(newsAggregator);
  setSharedMarketDataCoordinator(marketData);

  for (const plugin of getLoadablePlugins(externalPlugins)) {
    pluginRegistry.register(plugin);
  }
  newsAggregator.start();

  return {
    persistence,
    tickerRepository,
    providerRouter,
    dataProvider,
    marketData,
    pluginRegistry,
    newsAggregator,
    destroy() {
      setSharedMarketDataCoordinator(null);
      newsAggregator.stop();
      pluginRegistry.destroy();
      persistence.close();
    },
  };
}
