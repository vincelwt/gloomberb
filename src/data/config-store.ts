import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { dirname, join } from "path";
import type {
  AppConfig,
  BrokerInstanceConfig,
  ColumnConfig,
  LayoutConfig,
  PaneBinding,
  PaneInstanceConfig,
  SavedLayout,
} from "../types/config";
import {
  cloneLayout,
  createDefaultConfig,
  createPaneInstance,
  createPaneInstanceId,
  CURRENT_CONFIG_VERSION,
  normalizePaneLayout,
} from "../types/config";
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
  const directLayout = sanitizeLayout(saved.layout, defaults.layout);
  const layouts = sanitizeSavedLayouts(saved.layouts, directLayout);
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
    columns: sanitizeColumns(saved.columns, defaults.columns),
    layout,
    layouts: syncedLayouts,
    activeLayoutIndex,
    brokerInstances: sanitizeBrokerInstances(saved.brokerInstances),
    plugins: sanitizeStringArray(saved.plugins, defaults.plugins),
    disabledPlugins: sanitizeStringArray(saved.disabledPlugins, defaults.disabledPlugins),
    theme: typeof saved.theme === "string" ? saved.theme : defaults.theme,
    recentTickers: sanitizeStringArray(saved.recentTickers, defaults.recentTickers),
    onboardingComplete: typeof saved.onboardingComplete === "boolean" ? saved.onboardingComplete : defaults.onboardingComplete,
  };

  const needsSave =
    saved.configVersion !== CURRENT_CONFIG_VERSION
    || !isLayoutConfig(saved.layout)
    || !Array.isArray((saved.layout as { instances?: unknown })?.instances)
    || !Array.isArray(saved.layouts)
    || !Array.isArray(saved.brokerInstances)
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
    columns: sanitizeColumns(config.columns, createDefaultConfig(config.dataDir).columns),
    portfolios: sanitizePortfolios(config.portfolios, []),
    watchlists: sanitizeWatchlists(config.watchlists, []),
    layout,
    layouts,
    activeLayoutIndex,
    brokerInstances: sanitizeBrokerInstances(config.brokerInstances),
    plugins: sanitizeStringArray(config.plugins, []),
    disabledPlugins: sanitizeStringArray(config.disabledPlugins, []),
    recentTickers: sanitizeStringArray(config.recentTickers, []),
  };

  await writeFile(configPath, JSON.stringify(persisted, null, 2), "utf-8");
}

export async function initDataDir(dataDir: string): Promise<AppConfig> {
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

function sanitizePaneBinding(value: unknown, fallback: PaneBinding = { kind: "none" }): PaneBinding {
  if (!value || typeof value !== "object") return fallback;
  if ((value as PaneBinding).kind === "fixed" && typeof (value as Extract<PaneBinding, { kind: "fixed" }>).symbol === "string") {
    return { kind: "fixed", symbol: (value as Extract<PaneBinding, { kind: "fixed" }>).symbol };
  }
  if ((value as PaneBinding).kind === "follow" && typeof (value as Extract<PaneBinding, { kind: "follow" }>).sourceInstanceId === "string") {
    return { kind: "follow", sourceInstanceId: (value as Extract<PaneBinding, { kind: "follow" }>).sourceInstanceId };
  }
  if ((value as PaneBinding).kind === "none") return { kind: "none" };
  return fallback;
}

function sanitizePaneInstances(value: unknown, fallback: LayoutConfig): PaneInstanceConfig[] {
  if (!Array.isArray(value)) return cloneLayout(fallback).instances;
  const seen = new Set<string>();
  const instances = value
    .filter((entry): entry is PaneInstanceConfig =>
      !!entry
      && typeof entry === "object"
      && typeof (entry as PaneInstanceConfig).instanceId === "string"
      && typeof (entry as PaneInstanceConfig).paneId === "string",
    )
    .map((entry) => {
      const instanceId = seen.has(entry.instanceId) ? createPaneInstanceId(entry.paneId) : entry.instanceId;
      seen.add(instanceId);
      return {
        instanceId,
        paneId: entry.paneId,
        title: typeof entry.title === "string" ? entry.title : undefined,
        binding: sanitizePaneBinding(entry.binding),
        params: entry.params && typeof entry.params === "object"
          ? Object.fromEntries(
            Object.entries(entry.params).filter((param): param is [string, string] => typeof param[1] === "string"),
          )
          : undefined,
      };
    });
  return instances.length > 0 ? instances : cloneLayout(fallback).instances;
}

function getDefaultFollowSourceInstanceId(instances: PaneInstanceConfig[]): string | null {
  return instances.find((instance) => instance.paneId === "portfolio-list")?.instanceId ?? null;
}

type LegacyDockedEntry = { paneId: string; columnIndex: number; order?: number; height?: string };
type LegacyFloatingEntry = { paneId: string; x: number; y: number; width: number; height: number; zIndex?: number };
type LegacyLayoutValue = {
  columns: unknown[];
  docked: unknown[];
  floating: unknown[];
};

function migrateLegacyLayout(value: LegacyLayoutValue, fallback: LayoutConfig): LayoutConfig {
  const columns = value.columns
    .filter((entry): entry is LayoutConfig["columns"][number] =>
      !!entry
      && typeof entry === "object"
      && (typeof (entry as LayoutConfig["columns"][number]).width === "string"
        || typeof (entry as LayoutConfig["columns"][number]).width === "undefined"),
    )
    .map((entry) => ({ ...entry }));

  const legacyDocked = value.docked
    .filter((entry): entry is LegacyDockedEntry =>
      !!entry
      && typeof entry === "object"
      && typeof (entry as LegacyDockedEntry).paneId === "string"
      && typeof (entry as LegacyDockedEntry).columnIndex === "number",
    );
  const legacyFloating = value.floating
    .filter((entry): entry is LegacyFloatingEntry =>
      !!entry
      && typeof entry === "object"
      && typeof (entry as LegacyFloatingEntry).paneId === "string"
      && typeof (entry as LegacyFloatingEntry).x === "number"
      && typeof (entry as LegacyFloatingEntry).y === "number"
      && typeof (entry as LegacyFloatingEntry).width === "number"
      && typeof (entry as LegacyFloatingEntry).height === "number",
    );

  const instances: PaneInstanceConfig[] = [];
  let firstPortfolioInstanceId: string | null = null;
  let firstTickerDetailInstanceId: string | null = null;

  const createLegacyInstance = (paneId: string): PaneInstanceConfig => {
    let instanceId: string;
    if (paneId === "portfolio-list" && !firstPortfolioInstanceId) {
      instanceId = "portfolio-list:main";
      firstPortfolioInstanceId = instanceId;
    } else if (paneId === "ticker-detail" && !firstTickerDetailInstanceId) {
      instanceId = "ticker-detail:main";
      firstTickerDetailInstanceId = instanceId;
    } else {
      instanceId = createPaneInstanceId(paneId);
    }

    const binding: PaneBinding = paneId === "ticker-detail" && firstPortfolioInstanceId
      ? { kind: "follow", sourceInstanceId: firstPortfolioInstanceId }
      : paneId === "ibkr-trading" && (firstTickerDetailInstanceId || firstPortfolioInstanceId)
        ? { kind: "follow", sourceInstanceId: firstTickerDetailInstanceId ?? firstPortfolioInstanceId! }
        : { kind: "none" };

    const params = paneId === "portfolio-list"
      ? { collectionId: fallback.instances.find((instance) => instance.paneId === "portfolio-list")?.params?.collectionId ?? "main" }
      : undefined;

    const instance = createPaneInstance(paneId, { instanceId, binding, params });
    instances.push(instance);
    return instance;
  };

  const docked = legacyDocked.map((entry) => {
    const instance = createLegacyInstance(entry.paneId);
    return {
      instanceId: instance.instanceId,
      columnIndex: entry.columnIndex,
      order: entry.order,
      height: entry.height,
    };
  });

  const floating = legacyFloating.map((entry) => {
    const instance = createLegacyInstance(entry.paneId);
    return {
      instanceId: instance.instanceId,
      x: entry.x,
      y: entry.y,
      width: entry.width,
      height: entry.height,
      zIndex: entry.zIndex,
    };
  });

  if (instances.length === 0) return cloneLayout(fallback);

  return {
    columns: columns.length > 0 ? columns : cloneLayout(fallback).columns,
    instances,
    docked,
    floating,
  };
}

export function sanitizeLayout(value: unknown, fallback: LayoutConfig): LayoutConfig {
  if (!isLayoutConfig(value)) {
    return cloneLayout(fallback);
  }

  if (!Array.isArray((value as LayoutConfig & { instances?: unknown }).instances)) {
    const migrated = migrateLegacyLayout(value as unknown as LegacyLayoutValue, fallback);
    return normalizePaneLayout(migrated, {
      defaultFollowSourceInstanceId: getDefaultFollowSourceInstanceId(migrated.instances),
    });
  }

  const columns = value.columns
    .filter((entry): entry is LayoutConfig["columns"][number] =>
      !!entry && typeof entry === "object" && (typeof entry.width === "string" || typeof entry.width === "undefined"),
    )
    .map((entry) => ({ ...entry }));

  const instances = sanitizePaneInstances((value as LayoutConfig & { instances?: unknown }).instances, fallback);
  const validInstanceIds = new Set(instances.map((entry) => entry.instanceId));

  const docked = value.docked
    .filter((entry): entry is LayoutConfig["docked"][number] =>
      !!entry
      && typeof entry === "object"
      && typeof entry.instanceId === "string"
      && typeof entry.columnIndex === "number",
    )
    .filter((entry) => validInstanceIds.has(entry.instanceId))
    .map((entry) => ({ ...entry }));

  const floating = value.floating
    .filter((entry): entry is LayoutConfig["floating"][number] =>
      !!entry
      && typeof entry === "object"
      && typeof entry.instanceId === "string"
      && typeof entry.x === "number"
      && typeof entry.y === "number"
      && typeof entry.width === "number"
      && typeof entry.height === "number",
    )
    .filter((entry) => validInstanceIds.has(entry.instanceId))
    .map((entry) => ({ ...entry }));

  const layout = {
    columns: columns.length > 0 ? columns : cloneLayout(fallback).columns,
    instances,
    docked,
    floating,
  };

  return normalizePaneLayout(layout, {
    defaultFollowSourceInstanceId: getDefaultFollowSourceInstanceId(layout.instances),
  });
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
