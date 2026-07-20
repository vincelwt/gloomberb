import type {
  AppConfig,
  BrokerInstanceConfig,
  ChartPreferences,
  LayoutConfig,
  SavedLayout,
} from "../../../types/config";
import {
  cloneLayout,
  createDefaultConfig,
  CURRENT_CONFIG_VERSION,
  DEFAULT_COLUMNS,
  DEFAULT_PORTFOLIO_COLUMN_IDS,
} from "../../../types/config";
import type { Portfolio, Watchlist } from "../../../types/ticker";
import { isLayoutConfig, sanitizeLayout } from "../layout";

const LEGACY_MAIN_PORTFOLIO_COLUMN_IDS = DEFAULT_COLUMNS.map((column) => column.id);
const PRE_SPARKLINE_PORTFOLIO_COLUMN_IDS = [
  ...DEFAULT_COLUMNS.map((column) => column.id),
  "shares",
  "avg_cost",
  "cost_basis",
  "mkt_value",
  "pnl",
  "pnl_pct",
];
const PRE_DAY_PNL_PORTFOLIO_COLUMN_IDS = [
  ...DEFAULT_COLUMNS.map((column) => column.id),
  "sparkline",
  "shares",
  "avg_cost",
  "cost_basis",
  "mkt_value",
  "pnl",
  "pnl_pct",
];
const BUILTIN_SOURCE_IDS = new Set(["yahoo", "gloomberb-cloud"]);
const BUILTIN_PLUGIN_GROUP_ALIASES: Record<string, string> = {
  "broker-manager": "broker",
  "company-research": "ticker-research",
  "comparison-chart": "market-overview",
  correlation: "market-overview",
  "earnings-calendar": "macro",
  "fx-matrix": "market-overview",
  holders: "ticker-research",
  insider: "ticker-research",
  "market-movers": "market-overview",
  options: "ticker-research",
  research: "ticker-research",
  sectors: "market-overview",
  sec: "ticker-research",
  "ticker-detail": "ticker-research",
  "world-indices": "market-overview",
};

export function normalizeLoadedConfig(saved: Record<string, unknown>, dataDir: string): { config: AppConfig; needsSave: boolean } {
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
    index === activeLayoutIndex
      ? { ...entry, layout: cloneLayout(layout), paneState: sanitizeSavedPaneState(entry.paneState, layout) }
      : entry
  ));

  const disabledPlugins = sanitizeDisabledPlugins(saved, defaults.disabledPlugins, {
    enableCloudDefault: shouldEnableCloudDefault,
  });

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
    disabledPlugins,
    disabledSources: sanitizeDisabledSources(saved, defaults.disabledSources, disabledPlugins),
    pluginConfig: sanitizePluginConfig(saved.pluginConfig),
    theme: typeof saved.theme === "string" ? saved.theme : defaults.theme,
    chartPreferences: sanitizeChartPreferences(saved.chartPreferences, defaults.chartPreferences),
    valueFlashingEnabled: typeof saved.valueFlashingEnabled === "boolean" ? saved.valueFlashingEnabled : defaults.valueFlashingEnabled,
    recentTickers: sanitizeStringArray(saved.recentTickers, defaults.recentTickers),
    language: saved.language === "en" || saved.language === "zh-CN" || saved.language === "auto" ? saved.language : undefined,
    onboardingComplete: typeof saved.onboardingComplete === "boolean" ? saved.onboardingComplete : defaults.onboardingComplete,
  };

  const needsSave =
    saved.configVersion !== CURRENT_CONFIG_VERSION
    || !isLayoutConfig(saved.layout)
    || !Array.isArray((saved.layout as { instances?: unknown })?.instances)
    || !Array.isArray(saved.layouts)
    || !Array.isArray(saved.brokerInstances)
    || !Array.isArray(saved.disabledSources)
    || !isPluginConfigMap(saved.pluginConfig)
    || !isChartPreferences(saved.chartPreferences)
    || typeof saved.valueFlashingEnabled !== "boolean"
    || typeof saved.activeLayoutIndex !== "number";

  return { config, needsSave };
}

export function normalizeConfigForSave(config: AppConfig): AppConfig {
  const activeLayoutIndex = sanitizeActiveLayoutIndex(config.activeLayoutIndex, config.layouts.length || 1);
  const layout = sanitizeLayout(config.layout, createDefaultConfig(config.dataDir).layout);
  const layouts = sanitizeSavedLayouts(config.layouts, layout).map((entry, index) => (
    index === activeLayoutIndex
      ? { ...entry, layout: cloneLayout(layout), paneState: sanitizeSavedPaneState(entry.paneState, layout) }
      : entry
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
    disabledPlugins: sanitizeDisabledPluginList(config.disabledPlugins),
    disabledSources: sanitizeUniqueStringList(config.disabledSources),
    pluginConfig: sanitizePluginConfig(config.pluginConfig),
    chartPreferences: sanitizeChartPreferences(config.chartPreferences, createDefaultConfig(config.dataDir).chartPreferences),
    valueFlashingEnabled: config.valueFlashingEnabled !== false,
    recentTickers: sanitizeStringArray(config.recentTickers, []),
  };

  return persisted;
}

function sanitizeStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : fallback;
}

function normalizeBuiltinPluginId(pluginId: string): string {
  return BUILTIN_PLUGIN_GROUP_ALIASES[pluginId] ?? pluginId;
}

function sanitizeUniqueStringList(value: unknown): string[] {
  return [...new Set(sanitizeStringArray(value, []))];
}

function sanitizeDisabledPluginList(value: unknown, options: { expandLegacyCloudMacro?: boolean } = {}): string[] {
  const raw = sanitizeUniqueStringList(value);
  const disabled = raw.map(normalizeBuiltinPluginId);
  if (options.expandLegacyCloudMacro && raw.includes("gloomberb-cloud")) {
    disabled.push("macro");
  }
  return [...new Set(disabled)];
}

function sanitizeDisabledPlugins(
  saved: Record<string, unknown>,
  fallback: string[],
  options: { enableCloudDefault?: boolean } = {},
): string[] {
  const expandLegacyCloudMacro =
    !options.enableCloudDefault
    && (typeof saved.configVersion !== "number" || saved.configVersion < CURRENT_CONFIG_VERSION);
  const disabled = sanitizeDisabledPluginList(saved.disabledPlugins ?? fallback, {
    expandLegacyCloudMacro,
  });
  return options.enableCloudDefault
    ? disabled.filter((pluginId) => pluginId !== "gloomberb-cloud")
    : disabled;
}

function sanitizeDisabledSources(saved: Record<string, unknown>, fallback: string[], disabledPlugins: string[]): string[] {
  const explicit = sanitizeUniqueStringList(saved.disabledSources ?? fallback);
  const legacyPluginIds = sanitizeUniqueStringList(disabledPlugins)
    .filter((pluginId) => BUILTIN_SOURCE_IDS.has(pluginId));
  return [...new Set([...explicit, ...legacyPluginIds])];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sanitizeSerializableValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeSerializableValue(entry))
      .filter((entry) => entry !== undefined);
  }
  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, entry]) => [key, sanitizeSerializableValue(entry)])
        .filter(([, entry]) => entry !== undefined),
    );
  }
  return undefined;
}

function sanitizeSavedPaneState(
  value: unknown,
  layout: LayoutConfig,
): Record<string, Record<string, unknown>> | undefined {
  if (!isPlainRecord(value)) return undefined;
  const validPaneIds = new Set(layout.instances.map((instance) => instance.instanceId));
  const paneState = Object.fromEntries(
    Object.entries(value)
      .filter(([paneId, entry]) => validPaneIds.has(paneId) && isPlainRecord(entry))
      .map(([paneId, entry]) => [paneId, sanitizeSerializableValue(entry)])
      .filter((entry): entry is [string, Record<string, unknown>] => isPlainRecord(entry[1])),
  );
  return paneState;
}

function isPluginConfigMap(value: unknown): value is Record<string, Record<string, unknown>> {
  if (!isPlainRecord(value)) return false;
  return Object.values(value).every((entry) => isPlainRecord(entry));
}

function sanitizePluginConfig(value: unknown): Record<string, Record<string, unknown>> {
  if (!isPluginConfigMap(value)) return {};
  return Object.fromEntries(
    Object.entries(value).reduce<Array<[string, Record<string, unknown>]>>((entries, [pluginId, state]) => {
      const normalizedPluginId = normalizeBuiltinPluginId(pluginId);
      const existing = entries.find(([entryPluginId]) => entryPluginId === normalizedPluginId);
      if (existing) {
        existing[1] = { ...state, ...existing[1] };
      } else {
        entries.push([normalizedPluginId, { ...state }]);
      }
      return entries;
    }, []),
  );
}

function isChartPreferences(value: unknown): value is ChartPreferences {
  if (!value || typeof value !== "object") return false;
  const defaultRenderMode = (value as ChartPreferences).defaultRenderMode;
  const renderer = (value as ChartPreferences).renderer;
  return (defaultRenderMode === "area"
    || defaultRenderMode === "line"
    || defaultRenderMode === "candles"
    || defaultRenderMode === "ohlc"
    || defaultRenderMode === "hlc")
    && (renderer === "auto" || renderer === "kitty" || renderer === "braille");
}

function sanitizeChartPreferences(value: unknown, fallback: ChartPreferences): ChartPreferences {
  if (!value || typeof value !== "object") return { ...fallback };

  const candidate = value as Partial<ChartPreferences>;
  const defaultRenderMode = candidate.defaultRenderMode === "area"
    || candidate.defaultRenderMode === "line"
    || candidate.defaultRenderMode === "candles"
    || candidate.defaultRenderMode === "ohlc"
    || candidate.defaultRenderMode === "hlc"
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

function shouldMigratePortfolioColumnIds(value: unknown): boolean {
  return hasExactColumnIds(value, LEGACY_MAIN_PORTFOLIO_COLUMN_IDS)
    || hasExactColumnIds(value, PRE_SPARKLINE_PORTFOLIO_COLUMN_IDS)
    || hasExactColumnIds(value, PRE_DAY_PNL_PORTFOLIO_COLUMN_IDS);
}

function migrateLegacyPortfolioDefaultColumns(layout: LayoutConfig, enabled: boolean): LayoutConfig {
  if (!enabled) return layout;

  const instanceIndices = layout.instances.flatMap((instance, index) => (
    instance.paneId === "portfolio-list" && shouldMigratePortfolioColumnIds(instance.settings?.columnIds)
      ? [index]
      : []
  ));
  if (instanceIndices.length === 0) return layout;

  const nextLayout = cloneLayout(layout);
  for (const instanceIndex of instanceIndices) {
    nextLayout.instances[instanceIndex] = {
      ...nextLayout.instances[instanceIndex]!,
      settings: {
        ...(nextLayout.instances[instanceIndex]?.settings ?? {}),
        columnIds: [...DEFAULT_PORTFOLIO_COLUMN_IDS],
      },
    };
  }
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
    .map((entry) => {
      const layout = sanitizeLayout(entry.layout, fallbackLayout);
      return {
        id: typeof entry.id === "string" ? entry.id : undefined,
        name: entry.name,
        layout,
        paneState: sanitizeSavedPaneState((entry as { paneState?: unknown }).paneState, layout),
        focusedPaneId: typeof entry.focusedPaneId === "string" || entry.focusedPaneId === null
          ? entry.focusedPaneId
          : undefined,
        activePanel: entry.activePanel === "right" || entry.activePanel === "left"
          ? entry.activePanel
          : undefined,
      };
    });

  return layouts.length > 0 ? layouts : [{ name: "Default", layout: cloneLayout(fallbackLayout) }];
}

function sanitizeActiveLayoutIndex(value: unknown, layoutCount: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= layoutCount) {
    return 0;
  }
  return value;
}
