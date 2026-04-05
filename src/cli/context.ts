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

export function createBaseConverter(dataProvider: Pick<DataProvider, "getExchangeRate">, baseCurrency: string) {
  const rateCache = new Map<string, number>([["USD", 1]]);

  const getRate = async (currency: string): Promise<number> => {
    const normalizedCurrency = currency.toUpperCase();
    const cached = rateCache.get(normalizedCurrency);
    if (cached != null) return cached;
    try {
      const rate = await dataProvider.getExchangeRate(normalizedCurrency);
      rateCache.set(normalizedCurrency, rate);
      return rate;
    } catch {
      return 1;
    }
  };

  return async (value: number, fromCurrency: string): Promise<number> => {
    const normalizedFrom = fromCurrency.toUpperCase();
    const normalizedBase = baseCurrency.toUpperCase();
    if (normalizedFrom === normalizedBase) return value;

    const [fromRate, baseRate] = await Promise.all([
      getRate(normalizedFrom),
      getRate(normalizedBase),
    ]);
    if (baseRate === 0) return value;
    return (value * fromRate) / baseRate;
  };
}
