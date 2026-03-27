import type { Portfolio, Watchlist } from "./ticker";

export const CURRENT_CONFIG_VERSION = 5;

export interface BrokerInstanceConfig {
  id: string;
  brokerType: string;
  label: string;
  connectionMode?: string;
  config: Record<string, unknown>;
  enabled?: boolean;
}

export interface ColumnConfig {
  id: string;
  label: string;
  width: number;
  align: "left" | "right";
  format?: "currency" | "percent" | "number" | "compact";
}

export type PaneBinding =
  | { kind: "none" }
  | { kind: "fixed"; symbol: string }
  | { kind: "follow"; sourceInstanceId: string };

export interface PaneInstanceConfig {
  instanceId: string;
  paneId: string;
  title?: string;
  binding?: PaneBinding;
  params?: Record<string, string>;
}

export interface DockedPaneEntry {
  instanceId: string;
  columnIndex: number;
  order?: number;
  height?: string;
}

export interface LayoutColumnConfig {
  width?: string;
}

export interface FloatingPaneEntry {
  instanceId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex?: number;
}

export interface LayoutConfig {
  columns: LayoutColumnConfig[];
  instances: PaneInstanceConfig[];
  docked: DockedPaneEntry[];
  floating: FloatingPaneEntry[];
}

export interface SavedLayout {
  name: string;
  layout: LayoutConfig;
}

export interface AppConfig {
  dataDir: string;
  configVersion: number;
  baseCurrency: string;
  refreshIntervalMinutes: number;
  portfolios: Portfolio[];
  watchlists: Watchlist[];
  columns: ColumnConfig[];
  layout: LayoutConfig;
  layouts: SavedLayout[];
  activeLayoutIndex: number;
  brokerInstances: BrokerInstanceConfig[];
  plugins: string[];
  disabledPlugins: string[];
  theme: string;
  recentTickers: string[];
  onboardingComplete?: boolean;
}

const TICKER_PANE_IDS = new Set([
  "ticker-detail",
  "news",
  "notes",
  "options",
  "ask-ai",
  "ibkr-trading",
]);

export const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: "ticker", label: "TICKER", width: 8, align: "left" },
  { id: "price", label: "PRICE", width: 10, align: "right", format: "currency" },
  { id: "change_pct", label: "CHG%", width: 8, align: "right", format: "percent" },
  { id: "market_cap", label: "MCAP", width: 10, align: "right", format: "compact" },
  { id: "pe", label: "P/E", width: 7, align: "right", format: "number" },
  { id: "forward_pe", label: "FWD P/E", width: 8, align: "right", format: "number" },
  { id: "latency", label: "AGE", width: 6, align: "right" },
];

export const DEFAULT_LAYOUT: LayoutConfig = {
  columns: [{ width: "40%" }, { width: "60%" }],
  instances: [
    {
      instanceId: "portfolio-list:main",
      paneId: "portfolio-list",
      params: { collectionId: "main" },
      binding: { kind: "none" },
    },
    {
      instanceId: "ticker-detail:main",
      paneId: "ticker-detail",
      binding: { kind: "follow", sourceInstanceId: "portfolio-list:main" },
    },
  ],
  docked: [
    { instanceId: "portfolio-list:main", columnIndex: 0 },
    { instanceId: "ticker-detail:main", columnIndex: 1 },
  ],
  floating: [],
};

let nextPaneInstanceSeq = 0;

export function createPaneInstanceId(paneId: string): string {
  nextPaneInstanceSeq += 1;
  return `${paneId}:${Date.now().toString(36)}${nextPaneInstanceSeq.toString(36)}`;
}

export function clonePaneBinding(binding: PaneBinding | undefined): PaneBinding | undefined {
  if (!binding) return undefined;
  return { ...binding };
}

export function isTickerPaneId(paneId: string): boolean {
  return TICKER_PANE_IDS.has(paneId);
}

export function isTickerPaneInstance(instance: PaneInstanceConfig): boolean {
  return isTickerPaneId(instance.paneId);
}

export function isFollowTickerPane(instance: PaneInstanceConfig): boolean {
  return isTickerPaneInstance(instance) && instance.binding?.kind === "follow";
}

export function isFixedTickerPane(instance: PaneInstanceConfig): boolean {
  return isTickerPaneInstance(instance) && instance.binding?.kind === "fixed";
}

export function createPaneInstance(
  paneId: string,
  options: Partial<PaneInstanceConfig> = {},
): PaneInstanceConfig {
  return {
    instanceId: options.instanceId ?? createPaneInstanceId(paneId),
    paneId,
    title: options.title,
    binding: clonePaneBinding(options.binding) ?? { kind: "none" },
    params: options.params ? { ...options.params } : undefined,
  };
}

export function removePaneInstances(layout: LayoutConfig, instanceIds: Iterable<string>): LayoutConfig {
  const removedIds = new Set(instanceIds);
  if (removedIds.size === 0) return layout;

  return {
    ...layout,
    instances: layout.instances.filter((instance) => !removedIds.has(instance.instanceId)),
    docked: layout.docked.filter((entry) => !removedIds.has(entry.instanceId)),
    floating: layout.floating.filter((entry) => !removedIds.has(entry.instanceId)),
  };
}

export function normalizePaneLayout(
  layout: LayoutConfig,
  options?: { defaultFollowSourceInstanceId?: string | null },
): LayoutConfig {
  const fallbackSourceId = options?.defaultFollowSourceInstanceId ?? null;
  const fallbackAvailable = !!fallbackSourceId && layout.instances.some((instance) => instance.instanceId === fallbackSourceId);

  let nextLayout = layout;
  if (fallbackAvailable) {
    const nextInstances: PaneInstanceConfig[] = layout.instances.map((instance) => {
      if (!isTickerPaneInstance(instance)) return instance;
      if (instance.binding?.kind === "fixed" || instance.binding?.kind === "follow") return instance;
      return {
        ...instance,
        binding: { kind: "follow", sourceInstanceId: fallbackSourceId! },
      };
    });
    if (nextInstances.some((instance, index) => instance !== layout.instances[index])) {
      nextLayout = {
        ...layout,
        instances: nextInstances,
      };
    }
  }

  for (;;) {
    const validInstanceIds = new Set(nextLayout.instances.map((instance) => instance.instanceId));
    const removedIds = new Set<string>();

    for (const instance of nextLayout.instances) {
      if (instance.binding?.kind === "follow" && !validInstanceIds.has(instance.binding.sourceInstanceId)) {
        removedIds.add(instance.instanceId);
        continue;
      }

      if (isTickerPaneInstance(instance) && instance.binding?.kind !== "follow" && instance.binding?.kind !== "fixed") {
        removedIds.add(instance.instanceId);
        continue;
      }

      if (instance.binding?.kind === "fixed" && instance.binding.symbol.trim().length === 0) {
        removedIds.add(instance.instanceId);
      }
    }

    if (removedIds.size === 0) return nextLayout;
    nextLayout = removePaneInstances(nextLayout, removedIds);
  }
}

export function cloneLayout(layout: LayoutConfig): LayoutConfig {
  return {
    columns: layout.columns.map((column) => ({ ...column })),
    instances: layout.instances.map((instance) => ({
      ...instance,
      binding: clonePaneBinding(instance.binding),
      params: instance.params ? { ...instance.params } : undefined,
    })),
    docked: layout.docked.map((entry) => ({ ...entry })),
    floating: layout.floating.map((entry) => ({ ...entry })),
  };
}

export function findPaneInstance(layout: LayoutConfig, instanceId: string): PaneInstanceConfig | undefined {
  return layout.instances.find((instance) => instance.instanceId === instanceId);
}

export function createDefaultConfig(dataDir: string): AppConfig {
  const layout = cloneLayout(DEFAULT_LAYOUT);
  return {
    dataDir,
    configVersion: CURRENT_CONFIG_VERSION,
    baseCurrency: "USD",
    refreshIntervalMinutes: 30,
    portfolios: [{ id: "main", name: "Main Portfolio", currency: "USD" }],
    watchlists: [{ id: "watchlist", name: "Watchlist" }],
    columns: DEFAULT_COLUMNS.map((column) => ({ ...column })),
    layout,
    layouts: [{ name: "Default", layout: cloneLayout(layout) }],
    activeLayoutIndex: 0,
    brokerInstances: [],
    plugins: ["portfolio-list", "ticker-detail", "manual-entry", "ibkr"],
    disabledPlugins: [],
    theme: "amber",
    recentTickers: [],
  };
}
