import type { CliRenderer } from "@opentui/core";
import { createReactSlotRegistry, createSlot } from "@opentui/react";
import type { MarkdownStore } from "../data/markdown-store";
import type { SqliteCache } from "../data/sqlite-cache";
import type { BrokerAdapter } from "../types/broker";
import type { BrokerInstanceConfig, LayoutConfig } from "../types/config";
import type { DataProvider } from "../types/data-provider";
import type { TickerFinancials } from "../types/financials";
import type {
  CommandDef,
  CustomColumnDef,
  DetailTabDef,
  GloomPlugin,
  GloomPluginContext,
  GloomSlots,
  KeyboardShortcut,
  PaneDef,
  PluginStorage,
  TickerAction,
} from "../types/plugin";
import type { TickerFile } from "../types/ticker";
import { addPaneFloating, removePane } from "./pane-manager";
import { EventBus, type PluginEvents } from "./event-bus";
import { createPaneInstance } from "../types/config";

let sharedDataProvider: DataProvider | undefined;
let sharedMarkdownStore: MarkdownStore | undefined;
let sharedRegistry: PluginRegistry | undefined;

export function getSharedDataProvider(): DataProvider | undefined { return sharedDataProvider; }
export function getSharedMarkdownStore(): MarkdownStore | undefined { return sharedMarkdownStore; }
export function getSharedRegistry(): PluginRegistry | undefined { return sharedRegistry; }

interface PluginItems {
  panes: string[];
  commands: string[];
  columns: string[];
  brokers: string[];
  dataProviders: string[];
  detailTabs: string[];
  shortcuts: string[];
  tickerActions: string[];
  eventDisposers: Array<() => void>;
}

export class PluginRegistry {
  private slotRegistry;
  private plugins = new Map<string, GloomPlugin>();
  private unregisterFns = new Map<string, () => void>();
  private pluginItems = new Map<string, PluginItems>();
  private commandOwners = new Map<string, string>();
  private shortcutOwners = new Map<string, string>();

  private panesMap = new Map<string, PaneDef>();
  private commandsMap = new Map<string, CommandDef>();
  private columnsMap = new Map<string, CustomColumnDef>();
  private brokersMap = new Map<string, BrokerAdapter>();
  private dataProvidersMap = new Map<string, DataProvider>();
  private detailTabsMap = new Map<string, DetailTabDef>();
  private shortcutsMap = new Map<string, KeyboardShortcut>();
  private tickerActionsMap = new Map<string, TickerAction>();

  readonly events: EventBus;
  readonly dataProvider: DataProvider;
  readonly markdownStore: MarkdownStore;
  readonly sqliteCache: SqliteCache;

  getTickerFn: ((symbol: string) => TickerFile | null) = () => null;
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
  showPaneFn: ((paneId: string) => void) = () => {};
  hidePaneFn: ((paneId: string) => void) = () => {};
  focusPaneFn: ((paneId: string) => void) = () => {};
  pinTickerFn: ((symbol: string, options?: { floating?: boolean; paneType?: string }) => void) = () => {};

  getLayoutFn: (() => LayoutConfig) = () => ({ columns: [], instances: [], docked: [], floating: [] });
  updateLayoutFn: ((layout: LayoutConfig) => void) = () => {};
  getTermSizeFn: (() => { width: number; height: number }) = () => ({ width: 120, height: 40 });

  showToastFn: ((message: string, options?: { duration?: number; type?: "info" | "success" | "error" }) => void) = () => {};

  readonly Slot;

  constructor(renderer: CliRenderer, dataProvider: DataProvider, markdownStore: MarkdownStore, sqliteCache: SqliteCache) {
    this.dataProvider = dataProvider;
    this.markdownStore = markdownStore;
    this.sqliteCache = sqliteCache;
    this.events = new EventBus();

    sharedDataProvider = dataProvider;
    sharedMarkdownStore = markdownStore;
    sharedRegistry = this;

    this.slotRegistry = createReactSlotRegistry<GloomSlots & Record<string, object>>(renderer, {});
    this.Slot = createSlot(this.slotRegistry) as any;
  }

  get panes(): ReadonlyMap<string, PaneDef> { return this.panesMap; }
  get commands(): ReadonlyMap<string, CommandDef> { return this.commandsMap; }
  get columns(): ReadonlyMap<string, CustomColumnDef> { return this.columnsMap; }
  get brokers(): ReadonlyMap<string, BrokerAdapter> { return this.brokersMap; }
  get dataProviders(): ReadonlyMap<string, DataProvider> { return this.dataProvidersMap; }
  get detailTabs(): ReadonlyMap<string, DetailTabDef> { return this.detailTabsMap; }
  get shortcuts(): ReadonlyMap<string, KeyboardShortcut> { return this.shortcutsMap; }
  get tickerActions(): ReadonlyMap<string, TickerAction> { return this.tickerActionsMap; }
  get allPlugins(): ReadonlyMap<string, GloomPlugin> { return this.plugins; }

  getActiveProvider(): DataProvider | undefined {
    let active: DataProvider | undefined;
    for (const provider of this.dataProvidersMap.values()) active = provider;
    return active;
  }

  getPluginPaneIds(pluginId: string): string[] {
    return this.pluginItems.get(pluginId)?.panes ?? [];
  }

  private resolvePrimaryPaneInstanceId(paneId: string): string | undefined {
    const layout = this.getLayoutFn();
    return layout.instances.find((instance) => instance.paneId === paneId)?.instanceId;
  }

  private resolvePaneTarget(paneId: string): string | undefined {
    const layout = this.getLayoutFn();
    const isInstanceId = layout.instances.some((instance) => instance.instanceId === paneId);
    if (isInstanceId) return paneId;
    return this.resolvePrimaryPaneInstanceId(paneId);
  }

  getCommandPluginId(commandId: string): string | undefined {
    return this.commandOwners.get(commandId);
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
    const nextLayout = addPaneFloating(
      { ...layout, docked: layout.docked.filter((entry) => entry.instanceId !== instance.instanceId) },
      instance,
      width,
      height,
      def,
    );
    this.updateLayoutFn(nextLayout);
    this.focusPaneFn(instance.instanceId);
  }

  hideWidget(paneId: string): void {
    const target = this.resolvePaneTarget(paneId);
    if (!target) return;
    this.updateLayoutFn(removePane(this.getLayoutFn(), target));
  }

  private createContext(pluginId: string): GloomPluginContext {
    const items: PluginItems = {
      panes: [],
      commands: [],
      columns: [],
      brokers: [],
      dataProviders: [],
      detailTabs: [],
      shortcuts: [],
      tickerActions: [],
      eventDisposers: [],
    };
    this.pluginItems.set(pluginId, items);

    const storage: PluginStorage = {
      get: <T,>(key: string): T | null => {
        const raw = this.sqliteCache.getPluginData(pluginId, key);
        return raw ? JSON.parse(raw) : null;
      },
      set: (key: string, value: unknown) => {
        this.sqliteCache.setPluginData(pluginId, key, JSON.stringify(value));
      },
      delete: (key: string) => {
        this.sqliteCache.deletePluginData(pluginId, key);
      },
      keys: () => this.sqliteCache.getPluginKeys(pluginId),
    };

    return {
      registerPane: (pane) => { this.panesMap.set(pane.id, pane); items.panes.push(pane.id); },
      registerCommand: (command) => {
        this.commandsMap.set(command.id, command);
        this.commandOwners.set(command.id, pluginId);
        items.commands.push(command.id);
      },
      registerColumn: (column) => { this.columnsMap.set(column.id, column); items.columns.push(column.id); },
      registerBroker: (broker) => { this.brokersMap.set(broker.id, broker); items.brokers.push(broker.id); },
      registerDataProvider: (provider) => { this.dataProvidersMap.set(provider.id, provider); items.dataProviders.push(provider.id); },
      registerDetailTab: (tab) => { this.detailTabsMap.set(tab.id, tab); items.detailTabs.push(tab.id); },
      registerShortcut: (shortcut) => {
        this.shortcutsMap.set(shortcut.id, shortcut);
        this.shortcutOwners.set(shortcut.id, pluginId);
        items.shortcuts.push(shortcut.id);
      },
      registerTickerAction: (action) => { this.tickerActionsMap.set(action.id, action); items.tickerActions.push(action.id); },

      getData: (ticker) => this.getDataFn(ticker),
      getTicker: (ticker) => this.getTickerFn(ticker),
      getConfig: () => this.getConfigFn(),

      dataProvider: this.dataProvider,
      markdownStore: this.markdownStore,
      storage,

      createBrokerInstance: (brokerType, label, values) => this.createBrokerInstanceFn(brokerType, label, values),
      updateBrokerInstance: (instanceId, values) => this.updateBrokerInstanceFn(instanceId, values),
      syncBrokerInstance: (instanceId) => this.syncBrokerInstanceFn(instanceId),
      removeBrokerInstance: (instanceId) => this.removeBrokerInstanceFn(instanceId),

      selectTicker: (symbol, paneId) => this.selectTickerFn(symbol, paneId),
      switchPanel: (panel) => this.switchPanelFn(panel),
      switchTab: (tabId, paneId) => this.switchTabFn(tabId, paneId),
      openCommandBar: (query) => this.openCommandBarFn(query),
      showPane: (paneId) => this.showPaneFn(paneId),
      hidePane: (paneId) => this.hidePaneFn(paneId),
      focusPane: (paneId) => this.focusPaneFn(paneId),
      pinTicker: (symbol, options) => this.pinTickerFn(symbol, options),

      on: <K extends keyof PluginEvents>(event: K, handler: (payload: PluginEvents[K]) => void) => {
        const dispose = this.events.on(event, handler);
        items.eventDisposers.push(dispose);
        return dispose;
      },
      emit: (event, payload) => this.events.emit(event, payload),

      showWidget: (widgetId) => this.showWidget(widgetId),
      hideWidget: (widgetId) => this.hideWidget(widgetId),
      showToast: (message, options) => this.showToastFn(message, options),
    };
  }

  async register(plugin: GloomPlugin): Promise<void> {
    if (plugin.panes) {
      for (const pane of plugin.panes) {
        this.panesMap.set(pane.id, pane);
      }
    }

    if (plugin.broker) {
      this.brokersMap.set(plugin.broker.id, plugin.broker);
    }

    if (plugin.dataProvider) {
      this.dataProvidersMap.set(plugin.dataProvider.id, plugin.dataProvider);
    }

    if (plugin.slots) {
      const corePlugin = {
        id: plugin.id,
        order: plugin.order,
        slots: {} as Record<string, unknown>,
      };

      for (const [slotName, renderer] of Object.entries(plugin.slots)) {
        if (renderer) {
          corePlugin.slots[slotName] = (_ctx: unknown, props: unknown) => (renderer as any)(props);
        }
      }

      const unregister = this.slotRegistry.register(corePlugin as any);
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

    plugin.dispose?.();
    this.unregisterFns.get(pluginId)?.();
    this.unregisterFns.delete(pluginId);

    const items = this.pluginItems.get(pluginId);
    if (items) {
      for (const paneId of items.panes) this.panesMap.delete(paneId);
      for (const commandId of items.commands) {
        this.commandsMap.delete(commandId);
        this.commandOwners.delete(commandId);
      }
      for (const columnId of items.columns) this.columnsMap.delete(columnId);
      for (const brokerId of items.brokers) this.brokersMap.delete(brokerId);
      for (const providerId of items.dataProviders) this.dataProvidersMap.delete(providerId);
      for (const tabId of items.detailTabs) this.detailTabsMap.delete(tabId);
      for (const shortcutId of items.shortcuts) {
        this.shortcutsMap.delete(shortcutId);
        this.shortcutOwners.delete(shortcutId);
      }
      for (const actionId of items.tickerActions) this.tickerActionsMap.delete(actionId);
      for (const dispose of items.eventDisposers) dispose();
      this.pluginItems.delete(pluginId);
    }

    if (plugin.panes) {
      for (const pane of plugin.panes) this.panesMap.delete(pane.id);
    }
    if (plugin.broker) this.brokersMap.delete(plugin.broker.id);
    if (plugin.dataProvider) this.dataProvidersMap.delete(plugin.dataProvider.id);

    this.plugins.delete(pluginId);
    this.events.emit("plugin:unregistered", { pluginId });
  }
}
