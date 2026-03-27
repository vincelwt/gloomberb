import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { dirname, join } from "path";
import type { AppConfig, BrokerInstanceConfig, ColumnConfig, LayoutConfig } from "../types/config";
import { createDefaultConfig, CURRENT_CONFIG_VERSION } from "../types/config";
import type { Portfolio, Watchlist } from "../types/ticker";

const GLOBAL_CONFIG_DIR = join(process.env.HOME || "~", ".gloomberb");
const GLOBAL_CONFIG_FILE = join(GLOBAL_CONFIG_DIR, "config.json");

export async function getDataDir(): Promise<string | null> {
  try {
    const raw = await readFile(GLOBAL_CONFIG_FILE, "utf-8");
    const config = JSON.parse(raw) as { dataDir?: string };
    return config.dataDir || null;
  } catch {
    return null;
  }
}

export async function setDataDir(dataDir: string): Promise<void> {
  await mkdir(GLOBAL_CONFIG_DIR, { recursive: true });
  await writeFile(GLOBAL_CONFIG_FILE, JSON.stringify({ dataDir }, null, 2), "utf-8");
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
  const layout = sanitizeLayout(saved.layout, defaults.layout);
  const brokerInstances = sanitizeBrokerInstances(saved.brokerInstances);
  const portfolios = sanitizePortfolios(saved.portfolios, defaults.portfolios);
  const watchlists = sanitizeWatchlists(saved.watchlists, defaults.watchlists);
  const columns = sanitizeColumns(saved.columns, defaults.columns);

  const config: AppConfig = {
    dataDir,
    configVersion: CURRENT_CONFIG_VERSION,
    baseCurrency: typeof saved.baseCurrency === "string" ? saved.baseCurrency : defaults.baseCurrency,
    refreshIntervalMinutes: typeof saved.refreshIntervalMinutes === "number" ? saved.refreshIntervalMinutes : defaults.refreshIntervalMinutes,
    portfolios,
    watchlists,
    columns,
    layout,
    brokerInstances,
    plugins: sanitizeStringArray(saved.plugins, defaults.plugins),
    disabledPlugins: sanitizeStringArray(saved.disabledPlugins, defaults.disabledPlugins),
    theme: typeof saved.theme === "string" ? saved.theme : defaults.theme,
    recentTickers: sanitizeStringArray(saved.recentTickers, defaults.recentTickers),
    onboardingComplete: typeof saved.onboardingComplete === "boolean" ? saved.onboardingComplete : defaults.onboardingComplete,
  };

  const needsSave =
    saved.configVersion !== CURRENT_CONFIG_VERSION
    || !isLayoutConfig(saved.layout)
    || !Array.isArray(saved.brokerInstances);

  return { config, needsSave };
}

export async function saveConfig(config: AppConfig): Promise<void> {
  const configPath = join(config.dataDir, "config.json");
  await mkdir(dirname(configPath), { recursive: true });

  const persisted: AppConfig = {
    ...config,
    configVersion: CURRENT_CONFIG_VERSION,
    layout: sanitizeLayout(config.layout, createDefaultConfig(config.dataDir).layout),
    brokerInstances: sanitizeBrokerInstances(config.brokerInstances),
    portfolios: sanitizePortfolios(config.portfolios, []),
    watchlists: sanitizeWatchlists(config.watchlists, []),
    columns: sanitizeColumns(config.columns, createDefaultConfig(config.dataDir).columns),
    plugins: sanitizeStringArray(config.plugins, []),
    disabledPlugins: sanitizeStringArray(config.disabledPlugins, []),
    recentTickers: sanitizeStringArray(config.recentTickers, []),
  };

  const { dataDir, ...rest } = persisted;
  await writeFile(configPath, JSON.stringify(rest, null, 2), "utf-8");
}

export async function initDataDir(dataDir: string): Promise<AppConfig> {
  await mkdir(dataDir, { recursive: true });
  const { config, needsSave } = await loadConfigState(dataDir);
  if (needsSave) {
    await saveConfig(config);
  }
  await setDataDir(dataDir);
  return config;
}

export async function resetAllData(dataDir: string): Promise<void> {
  await rm(dataDir, { recursive: true, force: true });
  await rm(GLOBAL_CONFIG_DIR, { recursive: true, force: true });
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

function sanitizeColumns(value: unknown, fallback: ColumnConfig[]): ColumnConfig[] {
  if (!Array.isArray(value)) return fallback.map((column) => ({ ...column }));
  return value
    .filter((entry): entry is ColumnConfig =>
      !!entry
      && typeof entry === "object"
      && typeof (entry as ColumnConfig).id === "string"
      && typeof (entry as ColumnConfig).label === "string"
      && typeof (entry as ColumnConfig).width === "number"
      && ((entry as ColumnConfig).align === "left" || (entry as ColumnConfig).align === "right"),
    )
    .map((entry) => ({ ...entry }));
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

function isLayoutConfig(value: unknown): value is LayoutConfig {
  return !!value
    && typeof value === "object"
    && Array.isArray((value as LayoutConfig).columns)
    && Array.isArray((value as LayoutConfig).docked)
    && Array.isArray((value as LayoutConfig).floating);
}

function sanitizeLayout(value: unknown, fallback: LayoutConfig): LayoutConfig {
  if (!isLayoutConfig(value)) {
    return {
      columns: fallback.columns.map((column) => ({ ...column })),
      docked: fallback.docked.map((entry) => ({ ...entry })),
      floating: fallback.floating.map((entry) => ({ ...entry })),
    };
  }

  const columns = value.columns
    .filter((entry): entry is LayoutConfig["columns"][number] =>
      !!entry && typeof entry === "object" && (typeof entry.width === "string" || typeof entry.width === "undefined"),
    )
    .map((entry) => ({ ...entry }));

  const docked = value.docked
    .filter((entry): entry is LayoutConfig["docked"][number] =>
      !!entry
      && typeof entry === "object"
      && typeof entry.paneId === "string"
      && typeof entry.columnIndex === "number",
    )
    .map((entry) => ({ ...entry }));

  const floating = value.floating
    .filter((entry): entry is LayoutConfig["floating"][number] =>
      !!entry
      && typeof entry === "object"
      && typeof entry.paneId === "string"
      && typeof entry.x === "number"
      && typeof entry.y === "number"
      && typeof entry.width === "number"
      && typeof entry.height === "number",
    )
    .map((entry) => ({ ...entry }));

  return {
    columns: columns.length > 0 ? columns : fallback.columns.map((column) => ({ ...column })),
    docked,
    floating,
  };
}
