import type { ReactNode } from "react";
import type { TickerRepository } from "../data/ticker-repository";
import type { PluginEvents } from "../plugins/event-bus";
import type { BrokerAdapter } from "./broker";
import type { BrokerInstanceConfig, ColumnConfig } from "./config";
import type { DataProvider } from "./data-provider";
import type { TickerFinancials } from "./financials";
import type { CachePolicy, PersistedResourceValue } from "./persistence";
import type { TickerRecord } from "./ticker";

export interface GloomSlots {
  "detail:tab": { ticker: TickerRecord; financials: TickerFinancials | null };
  "detail:section": { ticker: TickerRecord; financials: TickerFinancials | null };
  "list:column": { ticker: TickerRecord; financials: TickerFinancials | null };
  "command:extra": { query: string };
  "command:preset": Record<string, never>;
  "status:widget": Record<string, never>;
  "config:section": Record<string, never>;
  "data:post-refresh": { ticker: string; financials: TickerFinancials };
  "data:enricher": { ticker: TickerRecord };
}

export interface PaneProps {
  paneId: string;
  paneType: string;
  focused: boolean;
  width: number;
  height: number;
  close?: () => void;
}

export interface PaneDef {
  id: string;
  name: string;
  icon?: string;
  component: (props: PaneProps) => ReactNode;
  defaultPosition: "left" | "right";
  defaultWidth?: string;
  defaultFloatingSize?: { width: number; height: number };
  defaultMode?: "docked" | "floating";
}

export interface WizardStep {
  key: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  type?: "text" | "password" | "info" | "select" | "number";
  options?: Array<{ label: string; value: string }>;
  dependsOn?: { key: string; value: string };
  body?: string[];
}

export interface CommandDef {
  id: string;
  label: string;
  keywords: string[];
  shortcut?: string;
  execute: (values?: Record<string, string>) => void | Promise<void>;
  category: "navigation" | "data" | "portfolio" | "config";
  description?: string;
  wizard?: WizardStep[];
  hidden?: () => boolean;
}

export interface CustomColumnDef extends ColumnConfig {
  render: (ticker: TickerRecord, financials: TickerFinancials | null) => string;
}

export interface DetailTabProps {
  width: number;
  height: number;
  focused: boolean;
  onCapture: (capturing: boolean) => void;
}

export interface DetailTabDef {
  id: string;
  name: string;
  order: number;
  component: (props: DetailTabProps) => ReactNode;
}

export interface KeyboardShortcut {
  id: string;
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  description: string;
  execute: () => void;
}

export interface TickerAction {
  id: string;
  label: string;
  keywords: string[];
  filter?: (ticker: TickerRecord) => boolean;
  execute: (ticker: TickerRecord, financials: TickerFinancials | null) => void | Promise<void>;
}

export interface PluginStorage {
  get<T = unknown>(key: string): T | null;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  keys(): string[];
}

export interface PluginPersistence {
  getState<T = unknown>(key: string, options?: { schemaVersion?: number }): T | null;
  setState(key: string, value: unknown, options?: { schemaVersion?: number }): void;
  deleteState(key: string): void;
  getResource<T = unknown>(
    kind: string,
    key: string,
    options?: { sourceKey?: string; schemaVersion?: number; allowExpired?: boolean },
  ): PersistedResourceValue<T> | null;
  setResource<T = unknown>(
    kind: string,
    key: string,
    value: T,
    options: {
      cachePolicy: CachePolicy;
      sourceKey?: string;
      schemaVersion?: number;
      provenance?: unknown;
    },
  ): PersistedResourceValue<T>;
  deleteResource(kind: string, key: string, options?: { sourceKey?: string }): void;
}

export interface GloomPluginContext {
  registerPane(pane: PaneDef): void;
  registerCommand(command: CommandDef): void;
  registerColumn(column: CustomColumnDef): void;
  registerBroker(broker: BrokerAdapter): void;
  registerDataProvider(provider: DataProvider): void;
  registerDetailTab(tab: DetailTabDef): void;
  registerShortcut(shortcut: KeyboardShortcut): void;
  registerTickerAction(action: TickerAction): void;

  getData(ticker: string): TickerFinancials | null;
  getTicker(ticker: string): TickerRecord | null;
  getConfig(): import("./config").AppConfig;

  readonly dataProvider: DataProvider;
  readonly tickerRepository: TickerRepository;
  readonly storage: PluginStorage;
  readonly persistence: PluginPersistence;

  createBrokerInstance(brokerType: string, label: string, values: Record<string, unknown>): Promise<BrokerInstanceConfig>;
  updateBrokerInstance(instanceId: string, values: Record<string, unknown>): Promise<void>;
  syncBrokerInstance(instanceId: string): Promise<void>;
  removeBrokerInstance(instanceId: string): Promise<void>;

  selectTicker(symbol: string, paneId?: string): void;
  switchPanel(panel: "left" | "right"): void;
  switchTab(tabId: string, paneId?: string): void;
  openCommandBar(query?: string): void;
  showPane(paneId: string): void;
  hidePane(paneId: string): void;
  focusPane(paneId: string): void;
  pinTicker(symbol: string, options?: { floating?: boolean; paneType?: string }): void;

  on<K extends keyof PluginEvents>(event: K, handler: (payload: PluginEvents[K]) => void): () => void;
  emit<K extends keyof PluginEvents>(event: K, payload: PluginEvents[K]): void;

  showWidget(widgetId: string): void;
  hideWidget(widgetId: string): void;
  showToast(message: string, options?: { duration?: number; type?: "info" | "success" | "error" }): void;
}

export interface GloomPlugin {
  id: string;
  name: string;
  version: string;
  description?: string;
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
