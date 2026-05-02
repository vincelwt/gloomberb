import { join } from "path";
import { existsSync } from "fs";
import { getDataDir, loadConfig } from "../data/config-store";
import { AppPersistence } from "../data/app-persistence";
import { TickerRepository } from "../data/ticker-repository";
import { AssetDataRouter } from "../sources/provider-router";
import type { PluginCapability } from "../capabilities";
import type { AppConfig } from "../types/config";
import type { GloomPlugin } from "../types/plugin";
import { getLoadablePlugins } from "../plugins/catalog";
import { fail } from "./errors";
import type { ConfigContext, MarketContext } from "./types";

interface CliContextOptions {
  plugins?: GloomPlugin[];
}

function resolveCliCapabilities(config: AppConfig, plugins: GloomPlugin[]): PluginCapability[] {
  const disabledPlugins = new Set(config.disabledPlugins ?? []);
  const disabledSources = new Set(config.disabledSources ?? []);
  return plugins
    .filter((plugin) => !disabledPlugins.has(plugin.id))
    .flatMap((plugin) => (
      (plugin.capabilities ?? [])
        .filter((capability) => {
          if (capability.kind !== "asset-data" && capability.kind !== "news") return false;
          const sourceId = capability.sourceId ?? capability.id;
          return !disabledSources.has(sourceId);
        })
    ));
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
  const capabilities = resolveCliCapabilities(context.config, plugins);
  const dataProvider = new AssetDataRouter(null, [], context.persistence.resources);
  dataProvider.attachRegistry({
    brokers: new Map(),
    getEnabledCapabilities: (kind?: string) => capabilities.filter((capability) => !kind || capability.kind === kind),
  } as any);
  return { ...context, dataProvider };
}
