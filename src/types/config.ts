import type { Portfolio, Watchlist } from "./ticker";

export const CURRENT_CONFIG_VERSION = 10;

export type DefaultChartRenderMode = "area" | "line" | "candles" | "ohlc";
export type ChartRendererPreference = "auto" | "kitty" | "braille";

export interface ChartPreferences {
  defaultRenderMode: DefaultChartRenderMode;
  renderer: ChartRendererPreference;
}

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

export interface DockedPlacementMemory {
  path?: Array<0 | 1>;
  anchorInstanceId?: string;
  position?: "left" | "right" | "above" | "below";
}

export interface FloatingPlacementMemory {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PanePlacementMemory {
  docked?: DockedPlacementMemory;
  floating?: FloatingPlacementMemory;
}

export interface PaneInstanceConfig {
  instanceId: string;
  paneId: string;
  title?: string;
  binding?: PaneBinding;
  params?: Record<string, string>;
  settings?: Record<string, unknown>;
  placementMemory?: PanePlacementMemory;
}

export interface DockPaneNode {
  kind: "pane";
  instanceId: string;
}

export interface DockSplitNode {
  kind: "split";
  axis: "horizontal" | "vertical";
  ratio: number;
  first: DockLayoutNode;
  second: DockLayoutNode;
}

export type DockLayoutNode = DockPaneNode | DockSplitNode;

export interface FloatingPaneEntry {
  instanceId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex?: number;
}

export interface LayoutConfig {
  dockRoot: DockLayoutNode | null;
  instances: PaneInstanceConfig[];
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
  layout: LayoutConfig;
  layouts: SavedLayout[];
  activeLayoutIndex: number;
  brokerInstances: BrokerInstanceConfig[];
  plugins: string[];
  disabledPlugins: string[];
  pluginConfig: Record<string, Record<string, unknown>>;
  theme: string;
  chartPreferences: ChartPreferences;
  recentTickers: string[];
  onboardingComplete?: boolean;
}

const TICKER_PANE_IDS = new Set([
  "ticker-detail",
  "quote-monitor",
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
  dockRoot: {
    kind: "split",
    axis: "horizontal",
    ratio: 0.4,
    first: { kind: "pane", instanceId: "portfolio-list:main" },
    second: { kind: "pane", instanceId: "ticker-detail:main" },
  },
  instances: [
    {
      instanceId: "portfolio-list:main",
      paneId: "portfolio-list",
      params: { collectionId: "main" },
      settings: {
        columnIds: DEFAULT_COLUMNS.map((column) => column.id),
        collectionScope: "all",
        visibleCollectionIds: [],
        hideTabs: false,
        lockedCollectionId: "main",
      },
      binding: { kind: "none" },
    },
    {
      instanceId: "ticker-detail:main",
      paneId: "ticker-detail",
      settings: {
        hideTabs: false,
        lockedTabId: "overview",
      },
      binding: { kind: "follow", sourceInstanceId: "portfolio-list:main" },
    },
  ],
  floating: [],
};

let nextPaneInstanceSeq = 0;

function clampDockRatio(ratio: number | undefined): number {
  if (typeof ratio !== "number" || !Number.isFinite(ratio)) return 0.5;
  return Math.max(0.1, Math.min(0.9, ratio));
}

function isDockAxis(value: unknown): value is DockSplitNode["axis"] {
  return value === "horizontal" || value === "vertical";
}

function cloneDockNode(node: DockLayoutNode): DockLayoutNode {
  if (node.kind === "pane") {
    return { kind: "pane", instanceId: node.instanceId };
  }
  return {
    kind: "split",
    axis: node.axis,
    ratio: node.ratio,
    first: cloneDockNode(node.first),
    second: cloneDockNode(node.second),
  };
}

function normalizeDockNode(
  node: DockLayoutNode | null | undefined,
  validInstanceIds: Set<string>,
  seenPaneIds: Set<string>,
): DockLayoutNode | null {
  if (!node || typeof node !== "object") return null;

  if ((node as DockPaneNode).kind === "pane") {
    const instanceId = (node as DockPaneNode).instanceId;
    if (typeof instanceId !== "string" || !validInstanceIds.has(instanceId) || seenPaneIds.has(instanceId)) {
      return null;
    }
    seenPaneIds.add(instanceId);
    return { kind: "pane", instanceId };
  }

  if ((node as DockSplitNode).kind !== "split") return null;
  const split = node as DockSplitNode;
  const first = normalizeDockNode(split.first, validInstanceIds, seenPaneIds);
  const second = normalizeDockNode(split.second, validInstanceIds, seenPaneIds);
  if (!first && !second) return null;
  if (!first) return second;
  if (!second) return first;
  return {
    kind: "split",
    axis: isDockAxis(split.axis) ? split.axis : "horizontal",
    ratio: clampDockRatio(split.ratio),
    first,
    second,
  };
}

function getDockedPaneIdsFromNode(node: DockLayoutNode | null, result: string[] = []): string[] {
  if (!node) return result;
  if (node.kind === "pane") {
    result.push(node.instanceId);
    return result;
  }
  getDockedPaneIdsFromNode(node.first, result);
  getDockedPaneIdsFromNode(node.second, result);
  return result;
}

export function createPaneInstanceId(paneId: string): string {
  nextPaneInstanceSeq += 1;
  return `${paneId}:${Date.now().toString(36)}${nextPaneInstanceSeq.toString(36)}`;
}

export function clonePaneBinding(binding: PaneBinding | undefined): PaneBinding | undefined {
  if (!binding) return undefined;
  return { ...binding };
}

export function clonePlacementMemory(memory: PanePlacementMemory | undefined): PanePlacementMemory | undefined {
  if (!memory) return undefined;
  return {
    docked: memory.docked ? {
      path: memory.docked.path ? [...memory.docked.path] : undefined,
      anchorInstanceId: memory.docked.anchorInstanceId,
      position: memory.docked.position,
    } : undefined,
    floating: memory.floating ? { ...memory.floating } : undefined,
  };
}

function cloneUnknownValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneUnknownValue(entry)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, cloneUnknownValue(entry)]),
    ) as T;
  }
  return value;
}

export function clonePaneSettings(settings: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!settings) return undefined;
  return cloneUnknownValue(settings);
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
    settings: clonePaneSettings(options.settings),
    placementMemory: clonePlacementMemory(options.placementMemory),
  };
}

export function removePaneInstances(layout: LayoutConfig, instanceIds: Iterable<string>): LayoutConfig {
  const removedIds = new Set(instanceIds);
  if (removedIds.size === 0) return layout;

  const instances = layout.instances.filter((instance) => !removedIds.has(instance.instanceId));
  const validInstanceIds = new Set(instances.map((instance) => instance.instanceId));
  const dockRoot = normalizeDockNode(layout.dockRoot, validInstanceIds, new Set<string>());
  const dockedPaneIds = new Set(getDockedPaneIdsFromNode(dockRoot));
  return {
    ...layout,
    instances,
    dockRoot,
    floating: layout.floating.filter((entry) => !removedIds.has(entry.instanceId) && !dockedPaneIds.has(entry.instanceId)),
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

    if (removedIds.size === 0) break;
    nextLayout = removePaneInstances(nextLayout, removedIds);
  }

  const validInstanceIds = new Set(nextLayout.instances.map((instance) => instance.instanceId));
  const dockRoot = normalizeDockNode(nextLayout.dockRoot, validInstanceIds, new Set<string>());
  const dockedPaneIds = new Set(getDockedPaneIdsFromNode(dockRoot));

  return {
    dockRoot,
    instances: nextLayout.instances.map((instance) => ({
      ...instance,
      binding: clonePaneBinding(instance.binding),
      params: instance.params ? { ...instance.params } : undefined,
      settings: clonePaneSettings(instance.settings),
      placementMemory: clonePlacementMemory(instance.placementMemory),
    })),
    floating: nextLayout.floating
      .filter((entry) => validInstanceIds.has(entry.instanceId) && !dockedPaneIds.has(entry.instanceId))
      .map((entry) => ({ ...entry })),
  };
}

export function cloneLayout(layout: LayoutConfig): LayoutConfig {
  return {
    dockRoot: layout.dockRoot ? cloneDockNode(layout.dockRoot) : null,
    instances: layout.instances.map((instance) => ({
      ...instance,
      binding: clonePaneBinding(instance.binding),
      params: instance.params ? { ...instance.params } : undefined,
      settings: clonePaneSettings(instance.settings),
      placementMemory: clonePlacementMemory(instance.placementMemory),
    })),
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
    layout,
    layouts: [{ name: "Default", layout: cloneLayout(layout) }],
    activeLayoutIndex: 0,
    brokerInstances: [],
    plugins: ["portfolio-list", "ticker-detail", "manual-entry", "ibkr"],
    disabledPlugins: ["gloomberb-cloud"],
    pluginConfig: {},
    theme: "amber",
    chartPreferences: {
      defaultRenderMode: "area",
      renderer: "auto",
    },
    recentTickers: [],
  };
}
