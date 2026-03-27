import { createReactSlotRegistry, createSlot } from "@opentui/react";
import type { CliRenderer } from "@opentui/core";
import type {
  GloomSlots, GloomPlugin, GloomPluginContext, PaneDef, CommandDef,
  CustomColumnDef, DetailTabDef, KeyboardShortcut, TickerAction,
  PluginStorage,
} from "../types/plugin";
import type { BrokerAdapter } from "../types/broker";
import type { TickerFile } from "../types/ticker";
import type { TickerFinancials } from "../types/financials";
import type { DataProvider } from "../types/data-provider";
import type { MarkdownStore } from "../data/markdown-store";
import type { SqliteCache } from "../data/sqlite-cache";
import type { LayoutConfig } from "../types/config";
import { addPaneFloating, removePane } from "./pane-manager";
import { EventBus, type PluginEvents } from "./event-bus";

// Shared references for React components (which can't access setup context)
let _sharedDataProvider: DataProvider | undefined;
let _sharedMarkdownStore: MarkdownStore | undefined;
let _sharedRegistry: PluginRegistry | undefined;

export function getSharedDataProvider(): DataProvider | undefined { return _sharedDataProvider; }
export function getSharedMarkdownStore(): MarkdownStore | undefined { return _sharedMarkdownStore; }
export function getSharedRegistry(): PluginRegistry | undefined { return _sharedRegistry; }

/** Per-plugin tracking of all registered items for lifecycle cleanup */
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
  private _pluginItems = new Map<string, PluginItems>();

  private _panes = new Map<string, PaneDef>();
  private _commands = new Map<string, CommandDef>();
  private _columns = new Map<string, CustomColumnDef>();
  private _brokers = new Map<string, BrokerAdapter>();
  private _dataProviders = new Map<string, DataProvider>();
  private _detailTabs = new Map<string, DetailTabDef>();
  private _shortcuts = new Map<string, KeyboardShortcut>();
  private _tickerActions = new Map<string, TickerAction>();

  readonly events: EventBus;
  readonly dataProvider: DataProvider;
  readonly markdownStore: MarkdownStore;
  readonly sqliteCache: SqliteCache;

  // External data accessors (set by app)
  getTickerFn: ((symbol: string) => TickerFile | null) = () => null;
  getDataFn: ((symbol: string) => TickerFinancials | null) = () => null;
  getConfigFn: (() => import("../types/config").AppConfig) = () => { throw new Error("getConfigFn not set"); };
  updateBrokerConfigFn: ((brokerId: string, values: Record<string, unknown>) => Promise<void>) = async () => {};
  syncBrokerFn: ((brokerId: string) => Promise<void>) = async () => {};

  // Navigation functions (set by app after render)
  selectTickerFn: ((symbol: string) => void) = () => {};
  switchPanelFn: ((panel: "left" | "right") => void) = () => {};
  switchTabFn: ((tabId: string) => void) = () => {};
  openCommandBarFn: ((query?: string) => void) = () => {};
  focusPaneFn: ((paneId: string) => void) = () => {};

  // Layout functions (set by app after render)
  getLayoutFn: (() => LayoutConfig) = () => ({ columns: [], docked: [], floating: [] });
  updateLayoutFn: ((layout: LayoutConfig) => void) = () => {};
  getTermSizeFn: (() => { width: number; height: number }) = () => ({ width: 120, height: 40 });

  // Toast function (set by app after ToastProvider mounts)
  showToastFn: ((message: string, options?: { duration?: number; type?: "info" | "success" | "error" }) => void) = () => {};

  readonly Slot;

  constructor(renderer: CliRenderer, dataProvider: DataProvider, markdownStore: MarkdownStore, sqliteCache: SqliteCache) {
    this.dataProvider = dataProvider;
    this.markdownStore = markdownStore;
    this.sqliteCache = sqliteCache;
    this.events = new EventBus();

    // Set shared refs for React components
    _sharedDataProvider = dataProvider;
    _sharedMarkdownStore = markdownStore;
    _sharedRegistry = this;

    this.slotRegistry = createReactSlotRegistry<GloomSlots & Record<string, object>>(renderer, {});
    this.Slot = createSlot(this.slotRegistry) as any;
  }

  // --- Getters ---

  get panes(): ReadonlyMap<string, PaneDef> { return this._panes; }
  get commands(): ReadonlyMap<string, CommandDef> { return this._commands; }
  get columns(): ReadonlyMap<string, CustomColumnDef> { return this._columns; }
  get brokers(): ReadonlyMap<string, BrokerAdapter> { return this._brokers; }
  get dataProviders(): ReadonlyMap<string, DataProvider> { return this._dataProviders; }
  get detailTabs(): ReadonlyMap<string, DetailTabDef> { return this._detailTabs; }
  get shortcuts(): ReadonlyMap<string, KeyboardShortcut> { return this._shortcuts; }
  get tickerActions(): ReadonlyMap<string, TickerAction> { return this._tickerActions; }
  get allPlugins(): ReadonlyMap<string, GloomPlugin> { return this.plugins; }

  /** Returns the last registered provider (paid providers override the default Yahoo) */
  getActiveProvider(): DataProvider | undefined {
    let last: DataProvider | undefined;
    for (const p of this._dataProviders.values()) last = p;
    return last;
  }

  /** Get pane IDs registered by a specific plugin */
  getPluginPaneIds(pluginId: string): string[] {
    return this._pluginItems.get(pluginId)?.panes ?? [];
  }

  /** Check if a pane is currently visible as a floating pane in the layout */
  isPaneFloating(paneId: string): boolean {
    try {
      return this.getLayoutFn().floating.some((f) => f.paneId === paneId);
    } catch { return false; }
  }

  /** Show a pane as a floating window (adds to layout.floating if not already present) */
  showWidget(paneId: string): void {
    // Don't show panes from disabled plugins
    try {
      const disabledPlugins = new Set(this.getConfigFn().disabledPlugins || []);
      for (const [pluginId, items] of this._pluginItems) {
        if (items.panes.includes(paneId) && disabledPlugins.has(pluginId)) {
          return;
        }
      }
    } catch { /* getConfigFn not set yet during init — allow */ }

    const layout = this.getLayoutFn();
    // Already floating — just focus
    if (layout.floating.some((f) => f.paneId === paneId)) {
      this.focusPaneFn(paneId);
      return;
    }

    // Remove from docked if present, then add as floating
    const def = this._panes.get(paneId);
    const { width, height } = this.getTermSizeFn();
    const newLayout = addPaneFloating(
      { ...layout, docked: layout.docked.filter((d) => d.paneId !== paneId) },
      paneId, width, height, def,
    );
    this.updateLayoutFn(newLayout);
    this.focusPaneFn(paneId);
  }

  /** Hide a floating pane (removes from layout) */
  hideWidget(paneId: string): void {
    const layout = this.getLayoutFn();
    const newLayout = removePane(layout, paneId);
    this.updateLayoutFn(newLayout);
  }

  private createContext(pluginId: string): GloomPluginContext {
    const items: PluginItems = {
      panes: [], commands: [], columns: [], brokers: [],
      dataProviders: [], detailTabs: [], shortcuts: [],
      tickerActions: [], eventDisposers: [],
    };
    this._pluginItems.set(pluginId, items);

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
      // Registration
      registerPane: (pane) => { this._panes.set(pane.id, pane); items.panes.push(pane.id); },
      registerCommand: (cmd) => { this._commands.set(cmd.id, cmd); items.commands.push(cmd.id); },
      registerColumn: (col) => { this._columns.set(col.id, col); items.columns.push(col.id); },
      registerBroker: (broker) => { this._brokers.set(broker.id, broker); items.brokers.push(broker.id); },
      registerDataProvider: (provider) => { this._dataProviders.set(provider.id, provider); items.dataProviders.push(provider.id); },
      registerDetailTab: (tab) => { this._detailTabs.set(tab.id, tab); items.detailTabs.push(tab.id); },
      registerShortcut: (shortcut) => { this._shortcuts.set(shortcut.id, shortcut); items.shortcuts.push(shortcut.id); },
      registerTickerAction: (action) => { this._tickerActions.set(action.id, action); items.tickerActions.push(action.id); },

      // Data access
      getData: (ticker) => this.getDataFn(ticker),
      getTicker: (ticker) => this.getTickerFn(ticker),
      getConfig: () => this.getConfigFn(),

      // Services
      dataProvider: this.dataProvider,
      markdownStore: this.markdownStore,
      storage,

      // Broker
      updateBrokerConfig: (brokerId, values) => this.updateBrokerConfigFn(brokerId, values),
      syncBroker: (brokerId) => this.syncBrokerFn(brokerId),

      // Navigation
      selectTicker: (symbol) => this.selectTickerFn(symbol),
      switchPanel: (panel) => this.switchPanelFn(panel),
      switchTab: (tabId) => this.switchTabFn(tabId),
      openCommandBar: (query) => this.openCommandBarFn(query),

      // Events
      on: <K extends keyof PluginEvents>(event: K, handler: (payload: PluginEvents[K]) => void) => {
        const disposer = this.events.on(event, handler);
        items.eventDisposers.push(disposer);
        return disposer;
      },
      emit: (event, payload) => this.events.emit(event, payload),

      // UI
      showWidget: (paneId) => this.showWidget(paneId),
      hideWidget: (paneId) => this.hideWidget(paneId),
      showToast: (message, options) => this.showToastFn(message, options),
    };
  }

  async register(plugin: GloomPlugin): Promise<void> {
    // Register declarative panes
    if (plugin.panes) {
      for (const pane of plugin.panes) {
        this._panes.set(pane.id, pane);
      }
    }

    // Register broker
    if (plugin.broker) {
      this._brokers.set(plugin.broker.id, plugin.broker);
    }

    // Register data provider
    if (plugin.dataProvider) {
      this._dataProviders.set(plugin.dataProvider.id, plugin.dataProvider);
    }

    // Register slot renderers with OpenTUI's registry
    if (plugin.slots) {
      const corePlugin = {
        id: plugin.id,
        order: plugin.order,
        slots: {} as Record<string, any>,
      };
      for (const [slotName, renderer] of Object.entries(plugin.slots)) {
        if (renderer) {
          corePlugin.slots[slotName] = (_ctx: any, props: any) => (renderer as any)(props);
        }
      }
      const unregister = this.slotRegistry.register(corePlugin as any);
      this.unregisterFns.set(plugin.id, unregister);
    }

    // Add to plugin map before async setup so allPlugins is available synchronously
    this.plugins.set(plugin.id, plugin);

    // Call setup with enriched context
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

    // Clean up all items tracked via createContext
    const items = this._pluginItems.get(pluginId);
    if (items) {
      for (const id of items.panes) this._panes.delete(id);
      for (const id of items.commands) this._commands.delete(id);
      for (const id of items.columns) this._columns.delete(id);
      for (const id of items.brokers) this._brokers.delete(id);
      for (const id of items.dataProviders) this._dataProviders.delete(id);
      for (const id of items.detailTabs) this._detailTabs.delete(id);
      for (const id of items.shortcuts) this._shortcuts.delete(id);
      for (const id of items.tickerActions) this._tickerActions.delete(id);
      for (const dispose of items.eventDisposers) dispose();
      this._pluginItems.delete(pluginId);
    }

    // Clean up declarative properties
    if (plugin.panes) {
      for (const pane of plugin.panes) this._panes.delete(pane.id);
    }
    if (plugin.broker) this._brokers.delete(plugin.broker.id);
    if (plugin.dataProvider) this._dataProviders.delete(plugin.dataProvider.id);

    this.plugins.delete(pluginId);
    this.events.emit("plugin:unregistered", { pluginId });
  }
}
