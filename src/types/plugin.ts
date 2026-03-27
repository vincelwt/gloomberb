import type { ReactNode } from "react";
import type { TickerFile } from "./ticker";
import type { TickerFinancials } from "./financials";
import type { BrokerAdapter } from "./broker";
import type { ColumnConfig } from "./config";
import type { DataProvider } from "./data-provider";
import type { PluginEvents } from "../plugins/event-bus";
import type { MarkdownStore } from "../data/markdown-store";

/** All available slot definitions for plugins */
export interface GloomSlots {
  /** Extra tabs in the right detail panel */
  "detail:tab": { ticker: TickerFile; financials: TickerFinancials | null };
  /** Extra sections in the detail panel */
  "detail:section": { ticker: TickerFile; financials: TickerFinancials | null };
  /** Extra columns in ticker list tables */
  "list:column": { ticker: TickerFile; financials: TickerFinancials | null };
  /** Extra items in the command bar */
  "command:extra": { query: string };
  /** Pluggable command presets */
  "command:preset": Record<string, never>;
  /** Widgets in the status bar */
  "status:widget": Record<string, never>;
  /** Extra sections on the config page */
  "config:section": Record<string, never>;
  /** Hook into data refresh cycle */
  "data:post-refresh": { ticker: string; financials: TickerFinancials };
  /** For agent-driven data enrichment */
  "data:enricher": { ticker: TickerFile };
}

export interface PaneProps {
  focused: boolean;
  width: number;
  height: number;
  /** Present when pane is floating — call to dock back or hide */
  close?: () => void;
}

export interface PaneDef {
  id: string;
  name: string;
  icon?: string; // single char for tab display
  component: (props: PaneProps) => ReactNode;
  defaultPosition: "left" | "right" | "bottom";
  defaultWidth?: string;
  /** Hint for initial floating size (character columns/rows) */
  defaultFloatingSize?: { width: number; height: number };
  /** Whether this pane starts docked or floating. Default: "docked" */
  defaultMode?: "docked" | "floating";
}

export interface WizardStep {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "password" | "info";
  /** Lines of text displayed above the input (or as the body for info steps) */
  body?: string[];
}

export interface CommandDef {
  id: string;
  label: string;
  keywords: string[];
  shortcut?: string;
  /** Called with wizard values (if wizard is defined) or no args */
  execute: (values?: Record<string, string>) => void | Promise<void>;
  category: "navigation" | "data" | "portfolio" | "config";
  /** Short description shown in command bar */
  description?: string;
  /** Multi-step wizard flow. When present, selecting this command starts the wizard. */
  wizard?: WizardStep[];
  /** When provided and returns true, the command is hidden from the command bar */
  hidden?: () => boolean;
}

export interface CustomColumnDef extends ColumnConfig {
  render: (ticker: TickerFile, financials: TickerFinancials | null) => string;
}

/** Props passed to dynamic detail tabs registered by plugins */
export interface DetailTabProps {
  width: number;
  height: number;
  focused: boolean;
  /** Call with true when tab captures keyboard (e.g. editing mode), false when releasing */
  onCapture: (capturing: boolean) => void;
}

/** Definition for a detail tab contributed by a plugin */
export interface DetailTabDef {
  id: string;
  name: string;
  /** Controls tab ordering — lower numbers appear first (core tabs use 10/20/30) */
  order: number;
  component: (props: DetailTabProps) => ReactNode;
}

/** Keyboard shortcut registered by a plugin */
export interface KeyboardShortcut {
  id: string;
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  description: string;
  execute: () => void;
}

/** Ticker action registered by a plugin */
export interface TickerAction {
  id: string;
  label: string;
  keywords: string[];
  /** Only show for tickers matching this filter */
  filter?: (ticker: TickerFile) => boolean;
  execute: (ticker: TickerFile, financials: TickerFinancials | null) => void | Promise<void>;
}

/** Scoped key-value storage for a plugin */
export interface PluginStorage {
  get<T = unknown>(key: string): T | null;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  keys(): string[];
}

export interface GloomPluginContext {
  // --- Registration ---
  registerPane(pane: PaneDef): void;
  registerCommand(command: CommandDef): void;
  registerColumn(column: CustomColumnDef): void;
  registerBroker(broker: BrokerAdapter): void;
  registerDataProvider(provider: DataProvider): void;
  registerDetailTab(tab: DetailTabDef): void;
  registerShortcut(shortcut: KeyboardShortcut): void;
  registerTickerAction(action: TickerAction): void;

  // --- Data access ---
  getData(ticker: string): TickerFinancials | null;
  getTicker(ticker: string): TickerFile | null;
  getConfig(): import("./config").AppConfig;

  // --- Services ---
  readonly dataProvider: DataProvider;
  readonly markdownStore: MarkdownStore;
  readonly storage: PluginStorage;

  // --- Broker ---
  updateBrokerConfig(brokerId: string, values: Record<string, unknown>): Promise<void>;
  syncBroker(brokerId: string): Promise<void>;

  // --- Navigation ---
  selectTicker(symbol: string): void;
  switchPanel(panel: "left" | "right"): void;
  switchTab(tabId: string): void;
  openCommandBar(query?: string): void;

  // --- Events ---
  on<K extends keyof PluginEvents>(event: K, handler: (payload: PluginEvents[K]) => void): () => void;
  emit<K extends keyof PluginEvents>(event: K, payload: PluginEvents[K]): void;

  // --- UI ---
  showWidget(widgetId: string): void;
  hideWidget(widgetId: string): void;
  showToast(message: string, options?: { duration?: number; type?: "info" | "success" | "error" }): void;
}

export interface GloomPlugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  /** If true, this plugin can be toggled on/off by the user */
  toggleable?: boolean;
  order?: number;

  setup?(ctx: GloomPluginContext): void | Promise<void>;
  dispose?(): void;

  panes?: PaneDef[];
  broker?: BrokerAdapter;
  dataProvider?: DataProvider;
  slots?: Partial<{
    [K in keyof GloomSlots]: (props: GloomSlots[K]) => ReactNode;
  }>;
}
