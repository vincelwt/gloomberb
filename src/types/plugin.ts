import type { ReactNode } from "react";
import type { TickerRepository } from "../data/ticker-repository";
import type { PluginEvents } from "../plugins/event-bus";
import type { PluginLogger } from "../utils/debug-log";
import type { BrokerAdapter } from "./broker";
import type {
  AppConfig,
  BrokerInstanceConfig,
  ColumnConfig,
  LayoutConfig,
  PaneBinding,
  PaneInstanceConfig,
} from "./config";
import type { DataProvider } from "./data-provider";
import type { TickerFinancials } from "./financials";
import type { CachePolicy, PersistedResourceValue } from "./persistence";
import type { TickerRecord } from "./ticker";
import type { InstrumentSearchResult } from "./instrument";

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
  settings?: PaneSettingsDef | ((context: PaneSettingsContext) => PaneSettingsDef | null);
}

export interface PaneSettingsContext {
  config: AppConfig;
  layout: LayoutConfig;
  paneId: string;
  paneType: string;
  pane: PaneInstanceConfig;
  settings: Record<string, unknown>;
  paneState: Record<string, unknown>;
  activeTicker: string | null;
  activeCollectionId: string | null;
}

export interface PaneSettingOption {
  value: string;
  label: string;
  description?: string;
}

interface PaneSettingFieldBase {
  key: string;
  label: string;
  description?: string;
}

export interface PaneSettingToggleField extends PaneSettingFieldBase {
  type: "toggle";
}

export interface PaneSettingTextField extends PaneSettingFieldBase {
  type: "text";
  placeholder?: string;
}

export interface PaneSettingSelectField extends PaneSettingFieldBase {
  type: "select";
  options: PaneSettingOption[];
}

export interface PaneSettingMultiSelectField extends PaneSettingFieldBase {
  type: "multi-select";
  options: PaneSettingOption[];
}

export interface PaneSettingOrderedMultiSelectField extends PaneSettingFieldBase {
  type: "ordered-multi-select";
  options: PaneSettingOption[];
}

export type PaneSettingField =
  | PaneSettingToggleField
  | PaneSettingTextField
  | PaneSettingSelectField
  | PaneSettingMultiSelectField
  | PaneSettingOrderedMultiSelectField;

export interface PaneSettingsDef {
  title?: string;
  fields: PaneSettingField[];
}

export interface PaneTemplateContext {
  config: AppConfig;
  layout: LayoutConfig;
  focusedPaneId: string | null;
  activeTicker: string | null;
  activeCollectionId: string | null;
}

export interface PaneTemplateShortcut {
  prefix: string;
  argPlaceholder?: string;
  argKind?: "text" | "ticker" | "ticker-list";
}

export interface PaneTemplateCreateOptions {
  arg?: string;
  values?: Record<string, string>;
  symbol?: string | null;
  symbols?: string[] | null;
  ticker?: TickerRecord | null;
  searchResult?: InstrumentSearchResult | null;
}

export interface PaneTemplateInstanceConfig {
  title?: string;
  binding?: PaneBinding;
  params?: Record<string, string>;
  settings?: Record<string, unknown>;
  placement?: "default" | "docked" | "floating";
  relativeToPaneId?: string;
  relativePosition?: "left" | "right" | "above" | "below";
}

export interface PaneTemplateDef {
  id: string;
  paneId: string;
  label: string;
  description: string;
  keywords?: string[];
  shortcut?: PaneTemplateShortcut;
  wizard?: WizardStep[];
  canCreate?: (context: PaneTemplateContext, options?: PaneTemplateCreateOptions) => boolean;
  createInstance?: (
    context: PaneTemplateContext,
    options?: PaneTemplateCreateOptions,
  ) => PaneTemplateInstanceConfig | null | Promise<PaneTemplateInstanceConfig | null>;
}

export interface WizardStep {
  key: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  type?: "text" | "password" | "info" | "select" | "number" | "textarea";
  options?: Array<{ label: string; value: string }>;
  dependsOn?: { key: string; value: string };
  body?: string[];
}

export interface CliHelpColumn {
  header: string;
  align?: "left" | "right" | "center";
  width?: number;
}

export interface CliCommandHelpSection {
  title: string;
  columns?: CliHelpColumn[];
  rows?: string[][];
  lines?: string[];
}

export interface CliCommandHelp {
  usage?: string[];
  sections?: CliCommandHelpSection[];
}

export interface CliLaunchEnvironment {
  terminalWidth: number;
  terminalHeight: number;
}

export interface CliLaunchConfigResult<TLaunchState = unknown> {
  config: AppConfig;
  launchState?: TLaunchState;
}

export interface CliLaunchRequest<TLaunchState = unknown> {
  applyConfig(config: AppConfig, env: CliLaunchEnvironment): CliLaunchConfigResult<TLaunchState>;
  applySessionSnapshot?(
    config: AppConfig,
    snapshot: import("../state/session-persistence").AppSessionSnapshot | null,
    launchState: TLaunchState | undefined,
  ): import("../state/session-persistence").AppSessionSnapshot;
}

export type CliDispatchResult =
  | { kind: "handled" }
  | { kind: "launch-ui"; request: CliLaunchRequest }
  | { kind: "unhandled" };

export interface CliCommandContext {
  initConfigData(): Promise<import("../cli/types").ConfigContext>;
  initMarketData(): Promise<import("../cli/types").MarketContext>;
  fail(message: string, details?: string): never;
  closeAndFail(
    persistence: import("../data/app-persistence").AppPersistence,
    message: string,
    details?: string,
  ): never;
  output: {
    cliStyles: typeof import("../utils/cli-output").cliStyles;
    colorBySign: typeof import("../utils/cli-output").colorBySign;
    renderSection: typeof import("../utils/cli-output").renderSection;
    renderStat: typeof import("../utils/cli-output").renderStat;
    renderTable: typeof import("../utils/cli-output").renderTable;
  };
  log: PluginLogger;
}

export interface CliCommandDef {
  name: string;
  aliases?: string[];
  description: string;
  help?: CliCommandHelp;
  execute(args: string[], ctx: CliCommandContext): void | CliDispatchResult | Promise<void | CliDispatchResult>;
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
  confirm?: CommandConfirmDef | ((context: CommandConfirmContext) => CommandConfirmDef | null);
  wizardLayout?: "steps" | "form";
  hidden?: () => boolean;
}

export interface CommandConfirmContext {
  config: AppConfig;
  layout: LayoutConfig;
  activeTicker: string | null;
  activeCollectionId: string | null;
}

export interface CommandConfirmDef {
  title: string;
  body: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
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

export interface DetailTabVisibilityContext {
  ticker: TickerRecord | null;
  financials: TickerFinancials | null | undefined;
  hasIbkrGatewayTrading: boolean;
  hasOptionsChain: boolean;
}

export interface DetailTabDef {
  id: string;
  name: string;
  order: number;
  component: (props: DetailTabProps) => ReactNode;
  isVisible?: (context: DetailTabVisibilityContext) => boolean;
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

export interface PluginResumeState {
  getState<T = unknown>(key: string, options?: { schemaVersion?: number }): T | null;
  setState(key: string, value: unknown, options?: { schemaVersion?: number }): void;
  deleteState(key: string): void;
  getPaneState<T = unknown>(paneId: string, key: string): T | null;
  setPaneState(paneId: string, key: string, value: unknown): void;
  deletePaneState(paneId: string, key: string): void;
}

export interface PluginConfigState {
  get<T = unknown>(key: string): T | null;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): string[];
}

export interface PluginPaneSettingsState {
  get<T = unknown>(paneId: string, key: string): T | null;
  set(paneId: string, key: string, value: unknown): Promise<void>;
  delete(paneId: string, key: string): Promise<void>;
}

export type AppNotificationType = "info" | "success" | "error";
export type AppDesktopNotificationMode = "never" | "when-inactive" | "always";

export interface AppNotificationRequest {
  title?: string;
  body: string;
  subtitle?: string;
  duration?: number;
  type?: AppNotificationType;
  toast?: boolean;
  desktop?: AppDesktopNotificationMode;
}

export interface GloomPluginContext {
  registerPane(pane: PaneDef): void;
  registerPaneTemplate(template: PaneTemplateDef): void;
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
  readonly persistence: PluginPersistence;
  readonly log: PluginLogger;
  readonly resume: PluginResumeState;
  readonly configState: PluginConfigState;
  readonly paneSettings: PluginPaneSettingsState;

  createBrokerInstance(brokerType: string, label: string, values: Record<string, unknown>): Promise<BrokerInstanceConfig>;
  updateBrokerInstance(instanceId: string, values: Record<string, unknown>): Promise<void>;
  syncBrokerInstance(instanceId: string): Promise<void>;
  removeBrokerInstance(instanceId: string): Promise<void>;

  selectTicker(symbol: string, paneId?: string): void;
  switchPanel(panel: "left" | "right"): void;
  switchTab(tabId: string, paneId?: string): void;
  openCommandBar(query?: string): void;
  showPane(paneId: string): void;
  createPaneFromTemplate(templateId: string, options?: PaneTemplateCreateOptions): void;
  hidePane(paneId: string): void;
  focusPane(paneId: string): void;
  pinTicker(symbol: string, options?: { floating?: boolean; paneType?: string }): void;
  openPaneSettings(paneId?: string): void;

  on<K extends keyof PluginEvents>(event: K, handler: (payload: PluginEvents[K]) => void): () => void;
  emit<K extends keyof PluginEvents>(event: K, payload: PluginEvents[K]): void;

  showWidget(widgetId: string): void;
  hideWidget(widgetId: string): void;
  notify(notification: AppNotificationRequest): void;
}

export interface GloomPlugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  toggleable?: boolean;
  order?: number;
  cliCommands?: CliCommandDef[];

  setup?(ctx: GloomPluginContext): void | Promise<void>;
  dispose?(): void;

  panes?: PaneDef[];
  paneTemplates?: PaneTemplateDef[];
  broker?: BrokerAdapter;
  dataProvider?: DataProvider;
  slots?: Partial<{
    [K in keyof GloomSlots]: (props: GloomSlots[K]) => ReactNode;
  }>;
}
