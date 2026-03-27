import type { Portfolio, Watchlist } from "./ticker";

export interface ColumnConfig {
  id: string;
  label: string;
  width: number; // character width
  align: "left" | "right";
  format?: "currency" | "percent" | "number" | "compact";
}

/** @deprecated Use LayoutConfig instead. Kept for migration from old configs. */
export interface PaneLayoutEntry {
  paneId: string;
  position: "left" | "right" | "bottom";
  width?: string;
}

/** A pane docked into the tiled layout */
export interface DockedPaneEntry {
  paneId: string;
  columnIndex: number;       // 0-based column index
  order?: number;            // vertical order within column (lower = higher)
  height?: string;           // e.g. "50%", "200" — omit = equal split
}

/** Configuration for a single layout column */
export interface LayoutColumnConfig {
  width?: string;            // e.g. "40%", "300" — omit = equal split
}

/** A pane floating as a draggable overlay */
export interface FloatingPaneEntry {
  paneId: string;
  x: number;                 // absolute terminal column
  y: number;                 // absolute terminal row
  width: number;             // character columns
  height: number;            // character rows
  zIndex?: number;
}

/** The unified layout config */
export interface LayoutConfig {
  columns: LayoutColumnConfig[];    // ordered list of columns
  docked: DockedPaneEntry[];       // panes placed in columns
  floating: FloatingPaneEntry[];   // panes in floating windows
}

export interface AppConfig {
  dataDir: string;
  baseCurrency: string;
  refreshIntervalMinutes: number;
  portfolios: Portfolio[];
  watchlists: Watchlist[];
  columns: ColumnConfig[];
  layout: LayoutConfig;
  brokers: Record<string, Record<string, unknown>>;
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
    recentTickers: [],
  };
}
