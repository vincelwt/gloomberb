import { join } from "path";
import { existsSync } from "fs";
import { getDataDir, loadConfig } from "../data/config-store";
import { AppPersistence } from "../data/app-persistence";
import { TickerRepository } from "../data/ticker-repository";
import { SourceRouter } from "../sources/provider-router";
import type { DataSource } from "../types/data-source";
import type { AppConfig } from "../types/config";
import type { GloomPlugin } from "../types/plugin";
import { getLoadablePlugins } from "../plugins/catalog";
import { fail } from "./errors";
import type { ConfigContext, MarketContext } from "./types";

interface CliContextOptions {
  plugins?: GloomPlugin[];
}

function resolveCliDataSources(config: AppConfig, plugins: GloomPlugin[]): DataSource[] {
  const disabledPlugins = new Set(config.disabledPlugins ?? []);
  const disabledSources = new Set(config.disabledSources ?? []);
  return plugins
    .filter((plugin) => !disabledPlugins.has(plugin.id))
    .flatMap((plugin) => plugin.dataSources ?? [])
    .filter((source) => !disabledSources.has(source.id));
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
  const dataProvider = new SourceRouter(
    null,
    resolveCliDataSources(context.config, plugins),
    context.persistence.resources,
  );
  return { ...context, dataProvider };
}
