import type { ReactNode } from "react";
import type { TickerFile } from "./ticker";
import type { TickerFinancials } from "./financials";
import type { BrokerAdapter } from "./broker";
import type { ColumnConfig } from "./config";
import type { DataProvider } from "./data-provider";

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
}

export interface PaneDef {
  id: string;
  name: string;
  icon?: string; // single char for tab display
  component: (props: PaneProps) => ReactNode;
  defaultPosition: "left" | "right" | "bottom";
  defaultWidth?: string;
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

export interface GloomPluginContext {
  registerPane(pane: PaneDef): void;
  registerCommand(command: CommandDef): void;
  registerColumn(column: CustomColumnDef): void;
  registerBroker(broker: BrokerAdapter): void;
  registerDataProvider(provider: DataProvider): void;
  registerDetailTab(tab: DetailTabDef): void;
  getData(ticker: string): TickerFinancials | null;
  getTicker(ticker: string): TickerFile | null;
  getConfig(): import("./config").AppConfig;
  updateBrokerConfig(brokerId: string, values: Record<string, unknown>): Promise<void>;
  /** Trigger position sync for a specific broker */
  syncBroker(brokerId: string): Promise<void>;
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
