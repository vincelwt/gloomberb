import { join } from "path";
import { existsSync } from "fs";
import { getDataDir, loadConfig } from "../data/config-store";
import { AppPersistence } from "../data/app-persistence";
import { TickerRepository } from "../data/ticker-repository";
import { ProviderRouter } from "../sources/provider-router";
import type { DataProvider } from "../types/data-provider";
import type { AppConfig } from "../types/config";
import type { GloomPlugin } from "../types/plugin";
import { getLoadablePlugins } from "../plugins/catalog";
import { createBaseConverter } from "./base-converter";
import { fail } from "./errors";
import type { ConfigContext, MarketContext } from "./types";

interface CliContextOptions {
  plugins?: GloomPlugin[];
}

function resolveCliDataProviders(config: AppConfig, plugins: GloomPlugin[]): DataProvider[] {
  const disabledPlugins = new Set(config.disabledPlugins ?? []);
  return plugins
    .filter((plugin) => !disabledPlugins.has(plugin.id) && !!plugin.dataProvider)
    .map((plugin) => plugin.dataProvider as DataProvider);
}

export async function loadCliConfigIfAvailable(): Promise<AppConfig | null> {
  const dataDir = await getDataDir();
  if (!dataDir || !existsSync(dataDir)) {
    return null;
  }
  return loadConfig(dataDir);
}

export async function initConfigData(): Promise<ConfigContext> {
  const dataDir = await getDataDir();
  if (!dataDir || !existsSync(dataDir)) {
    fail("No data directory configured.", "Run gloomberb once to initialize your local data.");
  }

  const config = await loadConfig(dataDir);
  const persistence = new AppPersistence(join(dataDir, ".gloomberb-cache.db"));
  const store = new TickerRepository(persistence.tickers);
  return { config, persistence, store, dataDir };
}

export async function initMarketData(options: CliContextOptions = {}): Promise<MarketContext> {
  const context = await initConfigData();
  const plugins = options.plugins ?? getLoadablePlugins();
  const dataProvider = new ProviderRouter(
    null,
    resolveCliDataProviders(context.config, plugins),
    context.persistence.resources,
  );
  return { ...context, dataProvider };
}

export { createBaseConverter };
