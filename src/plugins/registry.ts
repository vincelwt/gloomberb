import { Fragment, createElement, type ReactNode } from "react";
import type { AppPersistence } from "../data/app-persistence";
import type { TickerRepository } from "../data/ticker-repository";
import type { BrokerAdapter } from "../types/broker";
import type { BrokerInstanceConfig, LayoutConfig, PaneInstanceConfig } from "../types/config";
import type { DataProvider } from "../types/data-provider";
import type { DataSource } from "../types/data-source";
import type { TickerFinancials } from "../types/financials";
import type {
  AppNotificationRequest,
  CommandDef,
  ContextMenuProviderDef,
  CustomColumnDef,
  DetailTabDef,
  GloomPlugin,
  GloomPluginContext,
  GloomSlots,
  KeyboardShortcut,
  PaneDef,
  PaneSettingsContext,
  PaneSettingsDef,
  PaneTemplateCreateOptions,
  PaneTemplateDef,
  PluginPaneSettingsState,
  PluginResumeState,
  TickerAction,
} from "../types/plugin";
import type { ContextMenuContext, ContextMenuItem } from "../types/context-menu";
import type { TickerRecord } from "../types/ticker";
import { addPaneFloating, removePane } from "./pane-manager";
import { EventBus, type PluginEvents } from "./event-bus";
import { createPaneInstance, resolvePaneInstance } from "../types/config";
import { createPluginPersistence } from "./plugin-persistence";
import { debugLog } from "../utils/debug-log";
import { PluginRenderProvider, type PluginRuntimeAccess } from "./plugin-runtime";
import {
  resolveCollectionForPane,
  resolveTickerForPane,
  type PaneRuntimeState,
} from "../core/state/app-state";
import { deletePaneSetting, getPaneSettings, setPaneSetting } from "../pane-settings";

let sharedMarketData: DataProvider | undefined;
let sharedRegistry: PluginRegistry | undefined;
type SlotEntry = {
  pluginId: string;
  order: number;
  render: (props: unknown) => ReactNode;
};

interface ContextMenuProviderEntry {
  pluginId: string;
  provider: ContextMenuProviderDef;
}

export function getSharedMarketData(): DataProvider | undefined { return sharedMarketData; }
export function getSharedRegistry(): PluginRegistry | undefined { return sharedRegistry; }
export function setSharedMarketDataForTests(provider: DataProvider | undefined): void {
  sharedMarketData = provider;
}
export function setSharedRegistryForTests(registry: PluginRegistry | undefined): void {
  sharedRegistry = registry;
}

interface PluginItems {
  panes: string[];
  paneTemplates: string[];
  commands: string[];
  columns: string[];
  brokers: string[];
  dataSources: string[];
  detailTabs: string[];
  shortcuts: string[];
  tickerActions: string[];
  contextMenuProviders: string[];
  eventDisposers: Array<() => void>;
  dataSourceDisposers: Array<() => void>;
  newsQueryWatchDisposers: Array<() => void>;
}

export class PluginRegistry implements PluginRuntimeAccess {
  private slotEntries = new Map<string, SlotEntry[]>();
  private plugins = new Map<string, GloomPlugin>();
  private unregisterFns = new Map<string, () => void>();
  private pluginItems = new Map<string, PluginItems>();
  private commandOwners = new Map<string, string>();
  private paneOwners = new Map<string, string>();
  private paneTemplateOwners = new Map<string, string>();
  private shortcutOwners = new Map<string, string>();
  private dataSourceOwners = new Map<string, string>();
  private pluginResumeListeners = new Map<string, Set<() => void>>();

  private panesMap = new Map<string, PaneDef>();
  private paneTemplatesMap = new Map<string, PaneTemplateDef>();
  private commandsMap = new Map<string, CommandDef>();
  private columnsMap = new Map<string, CustomColumnDef>();
  private brokersMap = new Map<string, BrokerAdapter>();
  private dataSourcesMap = new Map<string, DataSource>();
  private detailTabsMap = new Map<string, DetailTabDef>();
  private shortcutsMap = new Map<string, KeyboardShortcut>();
  private tickerActionsMap = new Map<string, TickerAction>();
  private contextMenuProvidersMap = new Map<string, ContextMenuProviderEntry>();

  readonly events: EventBus;
  readonly marketData: DataProvider;
  readonly tickerRepository: TickerRepository;
  readonly persistence: AppPersistence;

  getTickerFn: ((symbol: string) => TickerRecord | null) = () => null;
  getDataFn: ((symbol: string) => TickerFinancials | null) = () => null;
  getConfigFn: (() => import("../types/config").AppConfig) = () => { throw new Error("getConfigFn not set"); };
  createBrokerInstanceFn: ((brokerType: string, label: string, values: Record<string, unknown>) => Promise<BrokerInstanceConfig>) = async () => {
    throw new Error("createBrokerInstanceFn not set");
  };
  updateBrokerInstanceFn: ((instanceId: string, values: Record<string, unknown>) => Promise<void>) = async () => {};
  syncBrokerInstanceFn: ((instanceId: string) => Promise<void>) = async () => {};
  removeBrokerInstanceFn: ((instanceId: string) => Promise<void>) = async () => {};

  selectTickerFn: ((symbol: string, paneId?: string) => void) = () => {};
  switchPanelFn: ((panel: "left" | "right") => void) = () => {};
  switchTabFn: ((tabId: string, paneId?: string) => void) = () => {};
  openCommandBarFn: ((query?: string) => void) = () => {};
  openPluginCommandWorkflowFn: ((commandId: string) => void) = () => {};
  openPaneSettingsFn: ((paneId?: string) => void) = () => {};
  showPaneFn: ((paneId: string) => void) = () => {};
  createPaneFromTemplateFn: ((templateId: string, options?: PaneTemplateCreateOptions) => void) = () => {};
  createPaneFromTemplateAsyncFn: ((templateId: string, options?: PaneTemplateCreateOptions) => Promise<void>) = async () => {};
  hidePaneFn: ((paneId: string) => void) = () => {};
  focusPaneFn: ((paneId: string) => void) = () => {};
  pinTickerFn: ((symbol: string, options?: { floating?: boolean; paneType?: string }) => void) = () => {};
  navigateTickerFn: ((symbol: string) => void) = () => {};
  getMarketData = () => this.marketData;
  pinTicker = (symbol: string, options?: { floating?: boolean; paneType?: string }) => {
    this.pinTickerFn(symbol, options);
  };
  navigateTicker = (symbol: string) => {
    this.navigateTickerFn(symbol);
  };
  selectTicker = (symbol: string, paneId?: string) => {
    this.selectTickerFn(symbol, paneId);
  };
  switchPanel = (panel: "left" | "right") => {
    this.switchPanelFn(panel);
  };
  switchTab = (tabId: string, paneId?: string) => {
    this.switchTabFn(tabId, paneId);
  };
  openCommandBar = (query?: string) => {
    this.openCommandBarFn(query);
  };
  openPluginCommandWorkflow = (commandId: string) => {
    this.openPluginCommandWorkflowFn(commandId);
  };

  getLayoutFn: (() => LayoutConfig) = () => ({ dockRoot: null, instances: [], floating: [], detached: [] });
  updateLayoutFn: ((layout: LayoutConfig) => void) = () => {};
  getTermSizeFn: (() => { width: number; height: number }) = () => ({ width: 120, height: 40 });

  registerDataSourceFn: ((source: DataSource) => () => void) = () => () => {};
  watchNewsQueryFn: ((
    query: import("../types/news-source").NewsQuery,
    listener: (state: import("../types/news-source").NewsQueryState) => void,
  ) => () => void) = () => () => {};

  notifyFn: ((notification: AppNotificationRequest) => void) = () => {};
  getPaneRuntimeStateFn: ((paneId: string) => PaneRuntimeState | null) = () => null;
  updatePaneRuntimeStateFn: ((paneId: string, patch: Partial<PaneRuntimeState>) => void) = () => {};
  applyPaneSettingValueFn: ((paneId: string, field: import("../types/plugin").PaneSettingField, value: unknown) => Promise<void>) = async () => {};
  getPluginConfigValueFn: (<T = unknown>(pluginId: string, key: string) => T | null) = (pluginId, key) => (
    (this.getConfigFn().pluginConfig[pluginId]?.[key] as T | undefined) ?? null
  );
  setPluginConfigValueFn: ((pluginId: string, key: string, value: unknown) => Promise<void>) = async () => {};
  setPluginConfigValuesFn: ((pluginId: string, values: Record<string, unknown>) => Promise<void>) = async () => {};
  deletePluginConfigValueFn: ((pluginId: string, key: string) => Promise<void>) = async () => {};

  readonly Slot;

  constructor(marketData: DataProvider, tickerRepository: TickerRepository, persistence: AppPersistence) {
    this.marketData = marketData;
    this.tickerRepository = tickerRepository;
    this.persistence = persistence;
    this.events = new EventBus();

    sharedMarketData = marketData;
    sharedRegistry = this;
    (globalThis as any).__gloomRegistry = this;
    this.Slot = ({ name, ...props }: { name: keyof GloomSlots } & Record<string, unknown>) => (
      this.renderSlot(name, props as any)
    );
  }

  get panes(): ReadonlyMap<string, PaneDef> { return this.panesMap; }
  get paneTemplates(): ReadonlyMap<string, PaneTemplateDef> { return this.paneTemplatesMap; }
  get commands(): ReadonlyMap<string, CommandDef> { return this.commandsMap; }
  get columns(): ReadonlyMap<string, CustomColumnDef> { return this.columnsMap; }
  get brokers(): ReadonlyMap<string, BrokerAdapter> { return this.brokersMap; }
  get dataSources(): ReadonlyMap<string, DataSource> { return this.dataSourcesMap; }
  get detailTabs(): ReadonlyMap<string, DetailTabDef> { return this.detailTabsMap; }
  get shortcuts(): ReadonlyMap<string, KeyboardShortcut> { return this.shortcutsMap; }
  get tickerActions(): ReadonlyMap<string, TickerAction> { return this.tickerActionsMap; }
  get allPlugins(): ReadonlyMap<string, GloomPlugin> { return this.plugins; }

  getContextMenuItems(context: ContextMenuContext): ContextMenuItem[] {
    const disabledPlugins = new Set(this.getConfigFn().disabledPlugins ?? []);
    const entries = [...this.contextMenuProvidersMap.entries()]
      .filter(([, entry]) => !disabledPlugins.has(entry.pluginId))
      .filter(([, entry]) => !entry.provider.contexts || entry.provider.contexts.includes(context.kind))
      .sort((left, right) => (
        (left[1].provider.order ?? 0) - (right[1].provider.order ?? 0)
        || left[1].pluginId.localeCompare(right[1].pluginId)
        || left[1].provider.id.localeCompare(right[1].provider.id)
      ));

    const items: ContextMenuItem[] = [];
    for (const [, entry] of entries) {
      try {
        const provided = entry.provider.getItems(context);
        if (provided?.length) items.push(...provided);
      } catch (error) {
        this.registryLog.error("Context menu provider failed", {
          pluginId: entry.pluginId,
          providerId: entry.provider.id,
          context: context.kind,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return items;
  }

  getDataSourcePluginId(sourceId: string): string | undefined {
    return this.dataSourceOwners.get(sourceId);
  }

  getEnabledDataSources(): DataSource[] {
    const disabledPlugins = new Set(this.getConfigFn().disabledPlugins ?? []);
    const disabledSources = new Set(this.getConfigFn().disabledSources ?? []);
    return [...this.dataSourcesMap.values()].filter((source) => {
      const ownerId = this.dataSourceOwners.get(source.id);
      return !disabledSources.has(source.id) && (!ownerId || !disabledPlugins.has(ownerId));
    });
  }

  getActiveSource(): DataSource | undefined {
    let active: DataSource | undefined;
    for (const source of this.dataSourcesMap.values()) active = source;
    return active;
  }

  getPluginPaneIds(pluginId: string): string[] {
    return this.pluginItems.get(pluginId)?.panes ?? [];
  }

  getPluginPaneTemplateIds(pluginId: string): string[] {
    return this.pluginItems.get(pluginId)?.paneTemplates ?? [];
  }

  notify(notification: AppNotificationRequest): void {
    this.notifyFn(notification);
  }

  renderSlot<K extends keyof GloomSlots>(name: K, props: GloomSlots[K]): ReactNode {
    const entries = this.slotEntries.get(name as string) ?? [];
    if (entries.length === 0) return null;
    return createElement(
      Fragment,
      null,
      ...entries.map((entry) => createElement(
        Fragment,
        { key: entry.pluginId },
        entry.render(props),
      )),
    );
  }

  private getOrCreatePluginItems(pluginId: string): PluginItems {
    const existing = this.pluginItems.get(pluginId);
    if (existing) return existing;

    const items: PluginItems = {
      panes: [],
      paneTemplates: [],
      commands: [],
      columns: [],
      brokers: [],
      dataSources: [],
      detailTabs: [],
      shortcuts: [],
      tickerActions: [],
      contextMenuProviders: [],
      eventDisposers: [],
      dataSourceDisposers: [],
      newsQueryWatchDisposers: [],
    };
    this.pluginItems.set(pluginId, items);
    return items;
  }

  private wrapPaneDef(pluginId: string, pane: PaneDef): PaneDef {
    return {
      ...pane,
      component: (props) => createElement(
        PluginRenderProvider,
        {
          pluginId,
          runtime: this,
          children: createElement(pane.component as any, props),
        },
      ),
    };
  }

  private wrapDetailTabDef(pluginId: string, tab: DetailTabDef): DetailTabDef {
    return {
      ...tab,
      component: (props) => createElement(
        PluginRenderProvider,
        {
          pluginId,
          runtime: this,
          children: createElement(tab.component as any, props),
        },
      ),
    };
  }

  private emitResumeState(pluginId: string, key: string): void {
    const listenerKey = `${pluginId}:${key}`;
    for (const listener of this.pluginResumeListeners.get(listenerKey) ?? []) {
      listener();
    }
  }

  subscribeResumeState(pluginId: string, key: string, listener: () => void): () => void {
    const listenerKey = `${pluginId}:${key}`;
    if (!this.pluginResumeListeners.has(listenerKey)) {
      this.pluginResumeListeners.set(listenerKey, new Set());
    }
    this.pluginResumeListeners.get(listenerKey)!.add(listener);
    return () => {
      const listeners = this.pluginResumeListeners.get(listenerKey);
      if (!listeners) return;
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.pluginResumeListeners.delete(listenerKey);
      }
    };
  }

  getResumeState<T = unknown>(pluginId: string, key: string, schemaVersion?: number): T | null {
    return this.persistence.pluginState.get<T>(pluginId, `resume:${key}`, schemaVersion)?.value ?? null;
  }

  setResumeState(pluginId: string, key: string, value: unknown, schemaVersion?: number): void {
    this.persistence.pluginState.set(pluginId, `resume:${key}`, value, schemaVersion);
    this.emitResumeState(pluginId, key);
  }

  deleteResumeState(pluginId: string, key: string): void {
    this.persistence.pluginState.delete(pluginId, `resume:${key}`);
    this.emitResumeState(pluginId, key);
  }

  getConfigState<T = unknown>(pluginId: string, key: string): T | null {
    return this.getPluginConfigValueFn<T>(pluginId, key);
  }

  setConfigState(pluginId: string, key: string, value: unknown): Promise<void> {
    return this.setPluginConfigValueFn(pluginId, key, value);
  }

  setConfigStates(pluginId: string, values: Record<string, unknown>): Promise<void> {
    return this.setPluginConfigValuesFn(pluginId, values);
  }

  deleteConfigState(pluginId: string, key: string): Promise<void> {
    return this.deletePluginConfigValueFn(pluginId, key);
  }

  getConfigStateKeys(pluginId: string): string[] {
    return Object.keys(this.getConfigFn().pluginConfig[pluginId] ?? {}).sort();
  }

  private resolvePaneTarget(paneId: string): string | undefined {
    return resolvePaneInstance(this.getLayoutFn(), paneId)?.instanceId;
  }

  resolvePaneSettings(paneId: string): {
    paneId: string;
    pluginId?: string;
    pane: PaneInstanceConfig;
    paneDef: PaneDef;
    settingsDef: PaneSettingsDef;
    context: PaneSettingsContext;
  } | null {
    const targetPaneId = this.resolvePaneTarget(paneId);
    if (!targetPaneId) return null;

    const layout = this.getLayoutFn();
    const pane = layout.instances.find((instance) => instance.instanceId === targetPaneId);
    if (!pane) return null;

    const paneDef = this.panesMap.get(pane.paneId);
    if (!paneDef?.settings) return null;

    const config = this.getConfigFn();
    const pluginId = this.paneOwners.get(pane.paneId);
    const paneSettings = getPaneSettings(pane);
    const paneStateMap = Object.fromEntries(
      layout.instances.map((instance) => [instance.instanceId, this.getPaneRuntimeStateFn(instance.instanceId) ?? {}]),
    );
    const paneState = paneStateMap[targetPaneId] ?? {};
    const stateView = {
      config,
      paneState: paneStateMap,
    } as any;
    const context: PaneSettingsContext = {
      config,
      layout,
      paneId: targetPaneId,
      paneType: pane.paneId,
      pane,
      settings: paneSettings,
      paneState,
      activeTicker: resolveTickerForPane(stateView, targetPaneId),
      activeCollectionId: resolveCollectionForPane(stateView, targetPaneId),
    };
    const settingsDef = typeof paneDef.settings === "function"
      ? paneDef.settings(context)
      : paneDef.settings;
    if (!settingsDef) return null;

    if (pluginId) {
      const resolvedSettings = { ...paneSettings };
      for (const field of settingsDef.fields) {
        if (field.storage !== "plugin") continue;
        const configValue = this.getConfigState(pluginId, field.key);
        if (configValue === null) {
          delete resolvedSettings[field.key];
        } else {
          resolvedSettings[field.key] = configValue;
        }
      }
      context.settings = resolvedSettings;
    }

    return {
      paneId: targetPaneId,
      pluginId,
      pane,
      paneDef,
      settingsDef,
      context,
    };
  }

  hasPaneSettings(paneId: string): boolean {
    return this.resolvePaneSettings(paneId) !== null;
  }

  getCommandPluginId(commandId: string): string | undefined {
    return this.commandOwners.get(commandId);
  }

  getPaneTemplatePluginId(templateId: string): string | undefined {
    return this.paneTemplateOwners.get(templateId);
  }

  getShortcutPluginId(shortcutId: string): string | undefined {
    return this.shortcutOwners.get(shortcutId);
  }

  isPaneFloating(paneId: string): boolean {
    try {
      const target = this.resolvePaneTarget(paneId);
      return !!target && this.getLayoutFn().floating.some((entry) => entry.instanceId === target);
    } catch {
      return false;
    }
  }

  showWidget(paneId: string): void {
    try {
      const disabledPlugins = new Set(this.getConfigFn().disabledPlugins);
      for (const [pluginId, items] of this.pluginItems) {
        if (items.panes.includes(paneId) && disabledPlugins.has(pluginId)) {
          return;
        }
      }
    } catch {
      return;
    }

    const layout = this.getLayoutFn();
    const existingInstanceId = this.resolvePaneTarget(paneId);
    if (existingInstanceId && layout.floating.some((entry) => entry.instanceId === existingInstanceId)) {
      this.focusPaneFn(existingInstanceId);
      return;
    }

    const def = this.panesMap.get(paneId);
    const { width, height } = this.getTermSizeFn();
    const instance = existingInstanceId
      ? layout.instances.find((entry) => entry.instanceId === existingInstanceId)!
      : createPaneInstance(paneId, { instanceId: `${paneId}:main` });
    const nextLayout = addPaneFloating(layout, instance, width, height, def);
    this.updateLayoutFn(nextLayout);
    this.focusPaneFn(instance.instanceId);
  }

  hideWidget(paneId: string): void {
    const target = this.resolvePaneTarget(paneId);
    if (!target) return;
    this.updateLayoutFn(removePane(this.getLayoutFn(), target));
  }

  private createContext(pluginId: string): GloomPluginContext {
    const items = this.getOrCreatePluginItems(pluginId);

    const pluginNamespace = `plugin:${pluginId}`;

    const persistence = createPluginPersistence(this.persistence.pluginState, this.persistence.resources, pluginNamespace, pluginId);
    const log = debugLog.createLogger(pluginId);
    const resume: PluginResumeState = {
      getState: (key, options) => this.getResumeState(pluginId, key, options?.schemaVersion),
      setState: (key, value, options) => this.setResumeState(pluginId, key, value, options?.schemaVersion),
      deleteState: (key) => this.deleteResumeState(pluginId, key),
      getPaneState: <T = unknown>(paneId: string, key: string): T | null => {
        const value = this.getPaneRuntimeStateFn(paneId)?.pluginState?.[pluginId]?.[key];
        return value === undefined ? null : value as T;
      },
      setPaneState: (paneId, key, value) => {
        const currentPaneState = this.getPaneRuntimeStateFn(paneId) ?? {};
        const pluginState = {
          ...(currentPaneState.pluginState ?? {}),
          [pluginId]: {
            ...(currentPaneState.pluginState?.[pluginId] ?? {}),
            [key]: value,
          },
        };
        this.updatePaneRuntimeStateFn(paneId, { pluginState });
      },
      deletePaneState: (paneId, key) => {
        const currentPaneState = this.getPaneRuntimeStateFn(paneId) ?? {};
        const currentPluginState = currentPaneState.pluginState?.[pluginId];
        if (!currentPluginState || !(key in currentPluginState)) return;
        const nextPluginState = { ...currentPluginState };
        delete nextPluginState[key];
        const nextAllPluginState = { ...(currentPaneState.pluginState ?? {}) };
        if (Object.keys(nextPluginState).length === 0) {
          delete nextAllPluginState[pluginId];
        } else {
          nextAllPluginState[pluginId] = nextPluginState;
        }
        this.updatePaneRuntimeStateFn(paneId, {
          pluginState: Object.keys(nextAllPluginState).length > 0 ? nextAllPluginState : undefined,
        });
      },
    };
    const paneSettings: PluginPaneSettingsState = {
      get: (paneId, key) => {
        const target = this.resolvePaneTarget(paneId);
        if (!target) return null;
        return (this.getLayoutFn().instances.find((instance) => instance.instanceId === target)?.settings?.[key] as any) ?? null;
      },
      set: async (paneId, key, value) => {
        const target = this.resolvePaneTarget(paneId);
        if (!target) return;
        const nextLayout = setPaneSetting(this.getLayoutFn(), target, key, value);
        this.updateLayoutFn(nextLayout);
      },
      delete: async (paneId, key) => {
        const target = this.resolvePaneTarget(paneId);
        if (!target) return;
        const nextLayout = deletePaneSetting(this.getLayoutFn(), target, key);
        this.updateLayoutFn(nextLayout);
      },
    };

    return {
      registerPane: (pane) => {
        this.panesMap.set(pane.id, this.wrapPaneDef(pluginId, pane));
        this.paneOwners.set(pane.id, pluginId);
        items.panes.push(pane.id);
      },
      registerPaneTemplate: (template) => {
        this.paneTemplatesMap.set(template.id, template);
        this.paneTemplateOwners.set(template.id, pluginId);
        items.paneTemplates.push(template.id);
      },
      registerCommand: (command) => {
        this.commandsMap.set(command.id, command);
        this.commandOwners.set(command.id, pluginId);
        items.commands.push(command.id);
      },
      registerColumn: (column) => { this.columnsMap.set(column.id, column); items.columns.push(column.id); },
      registerBroker: (broker) => { this.brokersMap.set(broker.id, broker); items.brokers.push(broker.id); },
      registerDataSource: (source) => {
        const ownedSource: DataSource = {
          ...source,
          isEnabled: () => {
            const config = this.getConfigFn();
            const disabledPlugin = config.disabledPlugins.includes(pluginId);
            const disabledSource = config.disabledSources?.includes(source.id) ?? false;
            return !disabledPlugin && !disabledSource && (source.isEnabled?.() ?? true);
          },
        };
        this.dataSourcesMap.set(source.id, ownedSource);
        this.dataSourceOwners.set(source.id, pluginId);
        items.dataSources.push(source.id);
        const dispose = this.registerDataSourceFn(ownedSource);
        items.dataSourceDisposers.push(dispose);
      },
      registerDetailTab: (tab) => { this.detailTabsMap.set(tab.id, this.wrapDetailTabDef(pluginId, tab)); items.detailTabs.push(tab.id); },
      registerShortcut: (shortcut) => {
        this.shortcutsMap.set(shortcut.id, shortcut);
        this.shortcutOwners.set(shortcut.id, pluginId);
        items.shortcuts.push(shortcut.id);
      },
      registerTickerAction: (action) => { this.tickerActionsMap.set(action.id, action); items.tickerActions.push(action.id); },
      registerContextMenuProvider: (provider) => {
        const providerKey = `${pluginId}:${provider.id}`;
        this.contextMenuProvidersMap.set(providerKey, { pluginId, provider });
        items.contextMenuProviders.push(providerKey);
      },
      watchNewsQuery: (query, listener) => {
        const dispose = this.watchNewsQueryFn(query, listener);
        items.newsQueryWatchDisposers.push(dispose);
        return dispose;
      },

      getData: (ticker) => this.getDataFn(ticker),
      getTicker: (ticker) => this.getTickerFn(ticker),
      getConfig: () => this.getConfigFn(),
      getPaneDef: (paneId) => this.panesMap.get(paneId),

      marketData: this.marketData,
      tickerRepository: this.tickerRepository,
      persistence,
      log,
      resume,
      paneSettings,
      configState: {
        get: (key) => this.getConfigState(pluginId, key),
        set: (key, value) => this.setConfigState(pluginId, key, value),
        delete: (key) => this.deleteConfigState(pluginId, key),
        keys: () => this.getConfigStateKeys(pluginId),
      },

      createBrokerInstance: (brokerType, label, values) => this.createBrokerInstanceFn(brokerType, label, values),
      updateBrokerInstance: (instanceId, values) => this.updateBrokerInstanceFn(instanceId, values),
      syncBrokerInstance: (instanceId) => this.syncBrokerInstanceFn(instanceId),
      removeBrokerInstance: (instanceId) => this.removeBrokerInstanceFn(instanceId),

      selectTicker: this.selectTicker,
      switchPanel: this.switchPanel,
      switchTab: this.switchTab,
      openCommandBar: this.openCommandBar,
      showPane: (paneId) => this.showPaneFn(paneId),
      createPaneFromTemplate: (templateId, options) => this.createPaneFromTemplateFn(templateId, options),
      hidePane: (paneId) => this.hidePaneFn(paneId),
      focusPane: (paneId) => this.focusPaneFn(paneId),
      pinTicker: this.pinTicker,
      navigateTicker: this.navigateTicker,
      openPaneSettings: (paneId) => this.openPaneSettingsFn(paneId),

      on: <K extends keyof PluginEvents>(event: K, handler: (payload: PluginEvents[K]) => void) => {
        const dispose = this.events.on(event, handler);
        items.eventDisposers.push(dispose);
        return dispose;
      },
      emit: (event, payload) => this.events.emit(event, payload),

      showWidget: (widgetId) => this.showWidget(widgetId),
      hideWidget: (widgetId) => this.hideWidget(widgetId),
      notify: (notification) => this.notifyFn(notification),
    };
  }

  private registryLog = debugLog.createLogger("registry");

  async register(plugin: GloomPlugin): Promise<void> {
    this.registryLog.info(`Registering plugin: ${plugin.id} v${plugin.version ?? "?"}`);
    const items = this.getOrCreatePluginItems(plugin.id);
    if (plugin.panes) {
      for (const pane of plugin.panes) {
        this.panesMap.set(pane.id, this.wrapPaneDef(plugin.id, pane));
        this.paneOwners.set(pane.id, plugin.id);
        items.panes.push(pane.id);
      }
    }

    if (plugin.paneTemplates) {
      for (const template of plugin.paneTemplates) {
        this.paneTemplatesMap.set(template.id, template);
        this.paneTemplateOwners.set(template.id, plugin.id);
        items.paneTemplates.push(template.id);
      }
    }

    if (plugin.broker) {
      this.brokersMap.set(plugin.broker.id, plugin.broker);
      items.brokers.push(plugin.broker.id);
    }

    if (plugin.dataSources) {
      for (const source of plugin.dataSources) {
        const ownedSource: DataSource = {
          ...source,
          isEnabled: () => {
            const config = this.getConfigFn();
            const disabledPlugin = config.disabledPlugins.includes(plugin.id);
            const disabledSource = config.disabledSources?.includes(source.id) ?? false;
            return !disabledPlugin && !disabledSource && (source.isEnabled?.() ?? true);
          },
        };
        this.dataSourcesMap.set(source.id, ownedSource);
        this.dataSourceOwners.set(source.id, plugin.id);
        items.dataSources.push(source.id);
        const dispose = this.registerDataSourceFn(ownedSource);
        items.dataSourceDisposers.push(dispose);
      }
    }

    if (plugin.slots) {
      const registeredSlotNames: string[] = [];
      for (const [slotName, renderer] of Object.entries(plugin.slots)) {
        if (renderer) {
          const entries = this.slotEntries.get(slotName) ?? [];
          entries.push({
            pluginId: plugin.id,
            order: plugin.order ?? 0,
            render: (props: unknown) => createElement(
              PluginRenderProvider,
              {
                pluginId: plugin.id,
                runtime: this,
                children: (renderer as any)(props),
              },
            ),
          });
          entries.sort((left, right) => left.order - right.order || left.pluginId.localeCompare(right.pluginId));
          this.slotEntries.set(slotName, entries);
          registeredSlotNames.push(slotName);
        }
      }

      const unregister = () => {
        for (const slotName of registeredSlotNames) {
          const entries = this.slotEntries.get(slotName);
          if (!entries) continue;
          const nextEntries = entries.filter((entry) => entry.pluginId !== plugin.id);
          if (nextEntries.length === 0) {
            this.slotEntries.delete(slotName);
          } else {
            this.slotEntries.set(slotName, nextEntries);
          }
        }
      };
      this.unregisterFns.set(plugin.id, unregister);
    }

    this.plugins.set(plugin.id, plugin);

    if (plugin.setup) {
      await plugin.setup(this.createContext(plugin.id));
    }

    this.events.emit("plugin:registered", { pluginId: plugin.id });
  }

  unregister(pluginId: string): void {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;
    this.registryLog.info(`Unregistering plugin: ${pluginId}`);

    plugin.dispose?.();
    this.unregisterFns.get(pluginId)?.();
    this.unregisterFns.delete(pluginId);

    const items = this.pluginItems.get(pluginId);
    if (items) {
      for (const paneId of items.panes) {
        this.panesMap.delete(paneId);
        this.paneOwners.delete(paneId);
      }
      for (const templateId of items.paneTemplates) {
        this.paneTemplatesMap.delete(templateId);
        this.paneTemplateOwners.delete(templateId);
      }
      for (const commandId of items.commands) {
        this.commandsMap.delete(commandId);
        this.commandOwners.delete(commandId);
      }
      for (const columnId of items.columns) this.columnsMap.delete(columnId);
      for (const brokerId of items.brokers) this.brokersMap.delete(brokerId);
      for (const sourceId of items.dataSources) {
        this.dataSourcesMap.delete(sourceId);
        this.dataSourceOwners.delete(sourceId);
      }
      for (const tabId of items.detailTabs) this.detailTabsMap.delete(tabId);
      for (const shortcutId of items.shortcuts) {
        this.shortcutsMap.delete(shortcutId);
        this.shortcutOwners.delete(shortcutId);
      }
      for (const actionId of items.tickerActions) this.tickerActionsMap.delete(actionId);
      for (const providerKey of items.contextMenuProviders) this.contextMenuProvidersMap.delete(providerKey);
      for (const dispose of items.eventDisposers) dispose();
      for (const dispose of items.dataSourceDisposers) dispose();
      for (const dispose of items.newsQueryWatchDisposers) dispose();
      this.pluginItems.delete(pluginId);
    }

    this.plugins.delete(pluginId);
    this.events.emit("plugin:unregistered", { pluginId });
  }

  destroy(): void {
    for (const pluginId of [...this.plugins.keys()].reverse()) {
      try {
        this.unregister(pluginId);
      } catch (error) {
        this.registryLog.error("Failed to unregister plugin during registry destroy", {
          pluginId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.pluginResumeListeners.clear();
    if (sharedRegistry === this) {
      sharedRegistry = undefined;
    }
    if (sharedMarketData === this.marketData) {
      sharedMarketData = undefined;
    }
    if ((globalThis as any).__gloomRegistry === this) {
      delete (globalThis as any).__gloomRegistry;
    }
  }
}
