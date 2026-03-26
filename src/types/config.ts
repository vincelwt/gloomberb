import type { Portfolio, Watchlist } from "./ticker";

export interface ColumnConfig {
  id: string;
  label: string;
  width: number; // character width
  align: "left" | "right";
  format?: "currency" | "percent" | "number" | "compact";
}

export interface PaneLayoutEntry {
  paneId: string;
  position: "left" | "right" | "bottom";
  width?: string; // e.g., "40%", "60"
}

export interface AppConfig {
  dataDir: string;
  baseCurrency: string;
  refreshIntervalMinutes: number;
  portfolios: Portfolio[];
  watchlists: Watchlist[];
  columns: ColumnConfig[];
  layout: PaneLayoutEntry[];
  brokers: Record<string, Record<string, unknown>>;
  plugins: string[];
  disabledPlugins: string[];
  theme: string;
  onboardingComplete?: boolean;
}

export const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: "ticker", label: "TICKER", width: 8, align: "left" },
  { id: "price", label: "PRICE", width: 10, align: "right", format: "currency" },
  { id: "change_pct", label: "CHG%", width: 8, align: "right", format: "percent" },
  { id: "market_cap", label: "MCAP", width: 10, align: "right", format: "compact" },
  { id: "pe", label: "P/E", width: 7, align: "right", format: "number" },
  { id: "forward_pe", label: "FWD P/E", width: 8, align: "right", format: "number" },
];

export const DEFAULT_LAYOUT: PaneLayoutEntry[] = [
  { paneId: "portfolio-list", position: "left", width: "40%" },
  { paneId: "ticker-detail", position: "right", width: "60%" },
];

export function createDefaultConfig(dataDir: string): AppConfig {
  return {
    dataDir,
    baseCurrency: "USD",
    refreshIntervalMinutes: 30,
    portfolios: [{ id: "main", name: "Main Portfolio", currency: "USD" }],
    watchlists: [{ id: "watchlist", name: "Watchlist" }],
    columns: DEFAULT_COLUMNS,
    layout: DEFAULT_LAYOUT,
    brokers: {},
    plugins: ["portfolio-list", "ticker-detail", "manual-entry", "ibkr-flex"],
    disabledPlugins: [],
    theme: "amber",
  };
}
