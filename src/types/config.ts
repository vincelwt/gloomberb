import type { Portfolio, Watchlist } from "./ticker";

export const CURRENT_CONFIG_VERSION = 3;

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

export interface DockedPaneEntry {
  paneId: string;
  columnIndex: number;
  order?: number;
  height?: string;
}

export interface LayoutColumnConfig {
  width?: string;
}

export interface FloatingPaneEntry {
  paneId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex?: number;
}

export interface LayoutConfig {
  columns: LayoutColumnConfig[];
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
  docked: [
    { paneId: "portfolio-list", columnIndex: 0 },
    { paneId: "ticker-detail", columnIndex: 1 },
  ],
  floating: [],
};

export function cloneLayout(layout: LayoutConfig): LayoutConfig {
  return {
    columns: layout.columns.map((column) => ({ ...column })),
    docked: layout.docked.map((entry) => ({ ...entry })),
    floating: layout.floating.map((entry) => ({ ...entry })),
  };
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
