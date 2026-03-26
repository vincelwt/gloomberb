import { createReactSlotRegistry, createSlot } from "@opentui/react";
import type { CliRenderer } from "@opentui/core";
import type { ReactNode } from "react";
import type { GloomSlots, GloomPlugin, GloomPluginContext, PaneDef, CommandDef, CustomColumnDef, DetailTabDef } from "../types/plugin";
import type { BrokerAdapter } from "../types/broker";
import type { TickerFile } from "../types/ticker";
import type { TickerFinancials } from "../types/financials";
import type { DataProvider } from "../types/data-provider";

export class PluginRegistry {
  private slotRegistry;
  private plugins = new Map<string, GloomPlugin>();
  private unregisterFns = new Map<string, () => void>();
  private _panes = new Map<string, PaneDef>();
  private _commands = new Map<string, CommandDef>();
  private _columns = new Map<string, CustomColumnDef>();
  private _brokers = new Map<string, BrokerAdapter>();
  private _dataProviders = new Map<string, DataProvider>();
  private _detailTabs = new Map<string, DetailTabDef>();

  // External data accessors (set by app)
  getTickerFn: ((symbol: string) => TickerFile | null) = () => null;
  getDataFn: ((symbol: string) => TickerFinancials | null) = () => null;
  getConfigFn: (() => import("../types/config").AppConfig) = () => { throw new Error("getConfigFn not set"); };
  updateBrokerConfigFn: ((brokerId: string, values: Record<string, unknown>) => Promise<void>) = async () => {};
  syncBrokerFn: ((brokerId: string) => Promise<void>) = async () => {};

  readonly Slot;

  constructor(renderer: CliRenderer) {
    // Cast needed because GloomSlots is a concrete interface, not a generic Record
    this.slotRegistry = createReactSlotRegistry<GloomSlots & Record<string, object>>(renderer, {});
    this.Slot = createSlot(this.slotRegistry) as any;
  }

  get panes(): ReadonlyMap<string, PaneDef> {
    return this._panes;
  }

  get commands(): ReadonlyMap<string, CommandDef> {
    return this._commands;
  }

  get columns(): ReadonlyMap<string, CustomColumnDef> {
    return this._columns;
  }

  get brokers(): ReadonlyMap<string, BrokerAdapter> {
    return this._brokers;
  }

  get dataProviders(): ReadonlyMap<string, DataProvider> {
    return this._dataProviders;
  }

  get detailTabs(): ReadonlyMap<string, DetailTabDef> {
    return this._detailTabs;
  }

  /** Returns all registered plugins */
  get allPlugins(): ReadonlyMap<string, GloomPlugin> {
    return this.plugins;
  }

  /** Returns the last registered provider (paid providers override the default Yahoo) */
  getActiveProvider(): DataProvider | undefined {
    let last: DataProvider | undefined;
    for (const p of this._dataProviders.values()) last = p;
    return last;
  }

  private createContext(): GloomPluginContext {
    return {
      registerPane: (pane) => this._panes.set(pane.id, pane),
      registerCommand: (cmd) => this._commands.set(cmd.id, cmd),
      registerColumn: (col) => this._columns.set(col.id, col),
      registerBroker: (broker) => this._brokers.set(broker.id, broker),
      registerDataProvider: (provider) => this._dataProviders.set(provider.id, provider),
      registerDetailTab: (tab) => this._detailTabs.set(tab.id, tab),
      getData: (ticker) => this.getDataFn(ticker),
      getTicker: (ticker) => this.getTickerFn(ticker),
      getConfig: () => this.getConfigFn(),
      updateBrokerConfig: (brokerId, values) => this.updateBrokerConfigFn(brokerId, values),
      syncBroker: (brokerId) => this.syncBrokerFn(brokerId),
    };
  }

  async register(plugin: GloomPlugin): Promise<void> {
    // Register panes
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

    // Call setup
    if (plugin.setup) {
      await plugin.setup(this.createContext());
    }
  }

  unregister(pluginId: string): void {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;

    plugin.dispose?.();
    this.unregisterFns.get(pluginId)?.();
    this.unregisterFns.delete(pluginId);

    // Clean up panes
    if (plugin.panes) {
      for (const pane of plugin.panes) {
        this._panes.delete(pane.id);
      }
    }

    if (plugin.broker) {
      this._brokers.delete(plugin.broker.id);
    }

    if (plugin.dataProvider) {
      this._dataProviders.delete(plugin.dataProvider.id);
    }

    this.plugins.delete(pluginId);
  }
}
