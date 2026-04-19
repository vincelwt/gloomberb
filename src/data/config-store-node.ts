import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { dirname, join } from "path";
import type {
  AppConfig,
  BrokerInstanceConfig,
  ChartPreferences,
  LayoutConfig,
  SavedLayout,
} from "../types/config";
import {
  cloneLayout,
  createDefaultConfig,
  CURRENT_CONFIG_VERSION,
  DEFAULT_COLUMNS,
  DEFAULT_PORTFOLIO_COLUMN_IDS,
} from "../types/config";
import type { Portfolio, Watchlist } from "../types/ticker";
import { debugLog } from "../utils/debug-log";
import { isLayoutConfig, sanitizeLayout } from "./config-layout";

const configLog = debugLog.createLogger("config");
const LEGACY_MAIN_PORTFOLIO_COLUMN_IDS = DEFAULT_COLUMNS.map((column) => column.id);

function getGlobalConfigDir(): string {
  return join(process.env.HOME || "~", ".gloomberb");
}

function getGlobalConfigFile(): string {
  return join(getGlobalConfigDir(), "config.json");
}

export async function getDataDir(): Promise<string | null> {
  try {
    const raw = await readFile(getGlobalConfigFile(), "utf-8");
    const config = JSON.parse(raw) as { dataDir?: string };
    return config.dataDir || null;
  } catch {
    return null;
  }
}


export async function loadConfig(dataDir: string): Promise<AppConfig> {
  const { config } = await loadConfigState(dataDir);
  return config;
}

async function loadConfigState(dataDir: string): Promise<{ config: AppConfig; needsSave: boolean }> {
  const configPath = join(dataDir, "config.json");

  try {
    const raw = await readFile(configPath, "utf-8");
    const saved = JSON.parse(raw) as Record<string, unknown>;
    return normalizeConfig(saved, dataDir);
  } catch {
    return { config: createDefaultConfig(dataDir), needsSave: true };
  }
}

function normalizeConfig(saved: Record<string, unknown>, dataDir: string): { config: AppConfig; needsSave: boolean } {
  const defaults = createDefaultConfig(dataDir);
  const shouldMigratePortfolioDefaults =
    typeof saved.configVersion !== "number" || saved.configVersion < CURRENT_CONFIG_VERSION;
  const shouldEnableCloudDefault =
    typeof saved.configVersion !== "number" || saved.configVersion < 13;
  const directLayout = migrateLegacyPortfolioDefaultColumns(
    sanitizeLayout(saved.layout, defaults.layout),
    shouldMigratePortfolioDefaults,
  );
  const layouts = sanitizeSavedLayouts(saved.layouts, directLayout).map((entry) => ({
    ...entry,
    layout: migrateLegacyPortfolioDefaultColumns(entry.layout, shouldMigratePortfolioDefaults),
  }));
  const activeLayoutIndex = sanitizeActiveLayoutIndex(saved.activeLayoutIndex, layouts.length);
  const layout = cloneLayout(layouts[activeLayoutIndex]?.layout ?? directLayout);
  const syncedLayouts = layouts.map((entry, index) => (
    index === activeLayoutIndex ? { ...entry, layout: cloneLayout(layout) } : entry
  ));

  const config: AppConfig = {
    dataDir,
    configVersion: CURRENT_CONFIG_VERSION,
    baseCurrency: typeof saved.baseCurrency === "string" ? saved.baseCurrency : defaults.baseCurrency,
    refreshIntervalMinutes: typeof saved.refreshIntervalMinutes === "number" ? saved.refreshIntervalMinutes : defaults.refreshIntervalMinutes,
    portfolios: sanitizePortfolios(saved.portfolios, defaults.portfolios),
    watchlists: sanitizeWatchlists(saved.watchlists, defaults.watchlists),
    layout,
    layouts: syncedLayouts,
    activeLayoutIndex,
    brokerInstances: sanitizeBrokerInstances(saved.brokerInstances),
    plugins: sanitizeStringArray(saved.plugins, defaults.plugins),
    disabledPlugins: sanitizeDisabledPlugins(saved, defaults.disabledPlugins, {
      enableCloudDefault: shouldEnableCloudDefault,
    }),
    pluginConfig: sanitizePluginConfig(saved.pluginConfig),
    theme: typeof saved.theme === "string" ? saved.theme : defaults.theme,
    chartPreferences: sanitizeChartPreferences(saved.chartPreferences, defaults.chartPreferences),
    recentTickers: sanitizeStringArray(saved.recentTickers, defaults.recentTickers),
    onboardingComplete: typeof saved.onboardingComplete === "boolean" ? saved.onboardingComplete : defaults.onboardingComplete,
  };

  const needsSave =
    saved.configVersion !== CURRENT_CONFIG_VERSION
    || !isLayoutConfig(saved.layout)
    || !Array.isArray((saved.layout as { instances?: unknown })?.instances)
    || !Array.isArray(saved.layouts)
    || !Array.isArray(saved.brokerInstances)
    || !isPluginConfigMap(saved.pluginConfig)
    || !isChartPreferences(saved.chartPreferences)
    || typeof saved.activeLayoutIndex !== "number";

  return { config, needsSave };
}

export async function saveConfig(config: AppConfig): Promise<void> {
  const configPath = join(config.dataDir, "config.json");
  await mkdir(dirname(configPath), { recursive: true });

  const activeLayoutIndex = sanitizeActiveLayoutIndex(config.activeLayoutIndex, config.layouts.length || 1);
  const layout = sanitizeLayout(config.layout, createDefaultConfig(config.dataDir).layout);
  const layouts = sanitizeSavedLayouts(config.layouts, layout).map((entry, index) => (
    index === activeLayoutIndex ? { ...entry, layout: cloneLayout(layout) } : entry
  ));

  const persisted: AppConfig = {
    ...config,
    configVersion: CURRENT_CONFIG_VERSION,
    portfolios: sanitizePortfolios(config.portfolios, []),
    watchlists: sanitizeWatchlists(config.watchlists, []),
    layout,
    layouts,
    activeLayoutIndex,
    brokerInstances: sanitizeBrokerInstances(config.brokerInstances),
    plugins: sanitizeStringArray(config.plugins, []),
    disabledPlugins: sanitizeDisabledPluginList(config.disabledPlugins),
    pluginConfig: sanitizePluginConfig(config.pluginConfig),
    chartPreferences: sanitizeChartPreferences(config.chartPreferences, createDefaultConfig(config.dataDir).chartPreferences),
    recentTickers: sanitizeStringArray(config.recentTickers, []),
  };

  await writeFile(configPath, JSON.stringify(persisted, null, 2), "utf-8");
}

export async function initDataDir(dataDir: string): Promise<AppConfig> {
  configLog.info(`Initializing data directory: ${dataDir}`);
  await mkdir(dataDir, { recursive: true });
  const { config, needsSave } = await loadConfigState(dataDir);
  if (needsSave) {
    await saveConfig(config);
  }
  return config;
}

export async function resetAllData(dataDir: string): Promise<void> {
  await rm(dataDir, { recursive: true, force: true });
}

export async function exportConfig(config: AppConfig, destPath: string): Promise<void> {
  const { dataDir, ...rest } = config;
  await writeFile(destPath, JSON.stringify(rest, null, 2), "utf-8");
}

export async function importConfig(dataDir: string, srcPath: string): Promise<AppConfig> {
  const raw = await readFile(srcPath, "utf-8");
  const saved = JSON.parse(raw) as Record<string, unknown>;
  const { config } = normalizeConfig(saved, dataDir);
  await saveConfig(config);
  return config;
}

function sanitizeStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : fallback;
}

function sanitizeDisabledPluginList(value: unknown): string[] {
  return [...new Set(sanitizeStringArray(value, []))];
}

function sanitizeDisabledPlugins(
  saved: Record<string, unknown>,
  fallback: string[],
  options: { enableCloudDefault?: boolean } = {},
): string[] {
  const disabled = sanitizeDisabledPluginList(saved.disabledPlugins ?? fallback);
  return options.enableCloudDefault
    ? disabled.filter((pluginId) => pluginId !== "gloomberb-cloud")
    : disabled;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isPluginConfigMap(value: unknown): value is Record<string, Record<string, unknown>> {
  if (!isPlainRecord(value)) return false;
  return Object.values(value).every((entry) => isPlainRecord(entry));
}

function sanitizePluginConfig(value: unknown): Record<string, Record<string, unknown>> {
  if (!isPluginConfigMap(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([pluginId, state]) => [pluginId, { ...state }]),
  );
}

function isChartPreferences(value: unknown): value is ChartPreferences {
  if (!value || typeof value !== "object") return false;
  const defaultRenderMode = (value as ChartPreferences).defaultRenderMode;
  const renderer = (value as ChartPreferences).renderer;
  return (defaultRenderMode === "area"
    || defaultRenderMode === "line"
    || defaultRenderMode === "candles"
    || defaultRenderMode === "ohlc")
    && (renderer === "auto" || renderer === "kitty" || renderer === "braille");
}

function sanitizeChartPreferences(value: unknown, fallback: ChartPreferences): ChartPreferences {
  if (!value || typeof value !== "object") return { ...fallback };

  const candidate = value as Partial<ChartPreferences>;
  const defaultRenderMode = candidate.defaultRenderMode === "area"
    || candidate.defaultRenderMode === "line"
    || candidate.defaultRenderMode === "candles"
    || candidate.defaultRenderMode === "ohlc"
    ? candidate.defaultRenderMode
    : fallback.defaultRenderMode;
  const renderer = candidate.renderer === "auto"
    || candidate.renderer === "kitty"
    || candidate.renderer === "braille"
    ? candidate.renderer
    : fallback.renderer;

  return {
    defaultRenderMode,
    renderer,
  };
}

function sanitizePortfolios(value: unknown, fallback: Portfolio[]): Portfolio[] {
  if (!Array.isArray(value)) return fallback.map((portfolio) => ({ ...portfolio }));
  return value
    .filter((entry): entry is Portfolio =>
      !!entry
      && typeof entry === "object"
      && typeof (entry as Portfolio).id === "string"
      && typeof (entry as Portfolio).name === "string"
      && typeof (entry as Portfolio).currency === "string",
    )
    .map((entry) => ({ ...entry }));
}

function sanitizeWatchlists(value: unknown, fallback: Watchlist[]): Watchlist[] {
  if (!Array.isArray(value)) return fallback.map((watchlist) => ({ ...watchlist }));
  return value
    .filter((entry): entry is Watchlist =>
      !!entry
      && typeof entry === "object"
      && typeof (entry as Watchlist).id === "string"
      && typeof (entry as Watchlist).name === "string",
    )
    .map((entry) => ({ ...entry }));
}

function sanitizeBrokerInstances(value: unknown): BrokerInstanceConfig[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is BrokerInstanceConfig =>
      !!entry
      && typeof entry === "object"
      && typeof (entry as BrokerInstanceConfig).id === "string"
      && typeof (entry as BrokerInstanceConfig).brokerType === "string"
      && typeof (entry as BrokerInstanceConfig).label === "string"
      && typeof (entry as BrokerInstanceConfig).config === "object"
      && (entry as BrokerInstanceConfig).config !== null,
    )
    .map((entry) => ({
      ...entry,
      enabled: entry.enabled ?? true,
      config: { ...entry.config },
    }));
}

function hasExactColumnIds(value: unknown, expected: string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

function migrateLegacyPortfolioDefaultColumns(layout: LayoutConfig, enabled: boolean): LayoutConfig {
  if (!enabled) return layout;

  const instanceIndex = layout.instances.findIndex((instance) =>
    instance.instanceId === "portfolio-list:main"
    && instance.paneId === "portfolio-list"
    && hasExactColumnIds(instance.settings?.columnIds, LEGACY_MAIN_PORTFOLIO_COLUMN_IDS)
  );
  if (instanceIndex < 0) return layout;

  const nextLayout = cloneLayout(layout);
  nextLayout.instances[instanceIndex] = {
    ...nextLayout.instances[instanceIndex]!,
    settings: {
      ...(nextLayout.instances[instanceIndex]?.settings ?? {}),
      columnIds: [...DEFAULT_PORTFOLIO_COLUMN_IDS],
    },
  };
  return nextLayout;
}

function sanitizeSavedLayouts(value: unknown, fallbackLayout: LayoutConfig): SavedLayout[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [{ name: "Default", layout: cloneLayout(fallbackLayout) }];
  }

  const layouts = value
    .filter((entry): entry is SavedLayout =>
      !!entry
      && typeof entry === "object"
      && typeof (entry as SavedLayout).name === "string",
    )
    .map((entry) => ({
      name: entry.name,
      layout: sanitizeLayout(entry.layout, fallbackLayout),
    }));

  return layouts.length > 0 ? layouts : [{ name: "Default", layout: cloneLayout(fallbackLayout) }];
}

function sanitizeActiveLayoutIndex(value: unknown, layoutCount: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= layoutCount) {
    return 0;
  }
  return value;
}
