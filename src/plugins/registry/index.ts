import type { ReactNode } from "react";
import type { AppPersistence } from "../../data/app-persistence";
import type { TickerRepository } from "../../data/ticker-repository";
import type { BrokerAdapter } from "../../types/broker";
import {
  CapabilityRegistry,
  type NewsCapability,
  type PluginCapability,
} from "../../capabilities";
import type { BrokerInstanceConfig, LayoutConfig } from "../../types/config";
import type { DataProvider } from "../../types/data-provider";
import type { TickerFinancials } from "../../types/financials";
import type {
  AppNotificationRequest,
  BrokerInstanceUpdateOptions,
  CommandDef,
  CustomColumnDef,
  GloomPlugin,
  GloomSlots,
  KeyboardShortcut,
  PaneDef,
  PaneTemplateCreateOptions,
  PaneTemplateDef,
  PinTickerOptions,
  TickerAction,
  TickerResearchTabDef,
} from "../../types/plugin";
import type { ContextMenuContext, ContextMenuItem } from "../../types/context-menu";
import type { TickerRecord } from "../../types/ticker";
import { EventBus } from "../event-bus";
import { resolvePaneInstance } from "../../types/config";
import { debugLog } from "../../utils/debug-log";
import {
  wrapTickerResearchTabDefWithRuntime,
  wrapPaneDefWithRuntime,
  type PluginRuntimeAccess,
} from "../runtime";
import type { PaneRuntimeState } from "../../core/state/app/state";
import {
  resolveRegistryPaneSettings,
  type ResolvedRegistryPaneSettings,
} from "./pane-settings";
import { RegistrySlots } from "./slots";
import { RegistryContributions, type PluginItems } from "./contributions";
import { createRegistryPluginContext } from "./context";
import { resolveRegistryContextMenuItems } from "./context-menu";
import {
  bindSharedRegistry,
  releaseSharedRegistry,
} from "./shared";
import { RegistryResumeStateListeners } from "./plugin-state";

interface PluginRegistryOptions {
  enableCapabilityHandlers?: boolean;
  wrapBrokerAdapter?: (broker: BrokerAdapter, pluginId: string) => BrokerAdapter;
}

export type WindowEditMode = "move" | "resize";
export {
  getSharedMarketData,
  getSharedRegistry,
  setSharedMarketDataForTests,
  setSharedRegistryForTests,
} from "./shared";

export class PluginRegistry implements PluginRuntimeAccess {
  private slots = new RegistrySlots();
  private readonly contributions: RegistryContributions;
  private plugins = new Map<string, GloomPlugin>();
  private readonly resumeStateListeners = new RegistryResumeStateListeners();

  readonly events: EventBus;
  readonly capabilities: CapabilityRegistry;
  readonly marketData: DataProvider;
  readonly tickerRepository: TickerRepository;
  readonly persistence: AppPersistence;
  private readonly enableCapabilityHandlers: boolean;
  private readonly wrapBrokerAdapter?: (broker: BrokerAdapter, pluginId: string) => BrokerAdapter;

  getTickerFn: ((symbol: string) => TickerRecord | null) = () => null;
  getDataFn: ((symbol: string) => TickerFinancials | null) = () => null;
  getConfigFn: (() => import("../../types/config").AppConfig) = () => { throw new Error("getConfigFn not set"); };
  createBrokerInstanceFn: ((brokerType: string, label: string, values: Record<string, unknown>) => Promise<BrokerInstanceConfig>) = async () => {
    throw new Error("createBrokerInstanceFn not set");
  };
  connectBrokerInstanceFn: ((instanceId: string) => Promise<void>) = async () => {};
  updateBrokerInstanceFn: ((instanceId: string, values: Record<string, unknown>, options?: BrokerInstanceUpdateOptions) => Promise<void>) = async () => {};
  syncBrokerInstanceFn: ((instanceId: string) => Promise<void>) = async () => {};
  removeBrokerInstanceFn: ((instanceId: string) => Promise<void>) = async () => {};

  selectTickerFn: ((symbol: string, paneId?: string) => void) = () => {};
  switchPanelFn: ((panel: "left" | "right") => void) = () => {};
  switchTabFn: ((tabId: string, paneId?: string) => void) = () => {};
  openCommandBarFn: ((query?: string) => void) = () => {};
  openPluginCommandWorkflowFn: ((commandId: string) => void) = () => {};
  openPaneSettingsFn: ((paneId?: string) => void) = () => {};
  openWindowModeFn: ((paneId?: string, mode?: WindowEditMode) => void) = () => {};
  showPaneFn: ((paneId: string) => void) = () => {};
  createPaneFromTemplateFn: ((templateId: string, options?: PaneTemplateCreateOptions) => void) = () => {};
  createPaneFromTemplateAsyncFn: ((templateId: string, options?: PaneTemplateCreateOptions) => Promise<void>) = async () => {};
  hidePaneFn: ((paneId: string) => void) = () => {};
  focusPaneFn: ((paneId: string) => void) = () => {};
  pinTickerFn: ((symbol: string, options?: PinTickerOptions) => void) = () => {};
  navigateTickerFn: ((symbol: string, options?: { sourcePaneId?: string | null }) => void) = () => {};
  getMarketData = () => this.marketData;
  getCapability = (capabilityId: string) => this.capabilities.get(capabilityId)?.capability ?? null;
  getBrokerAdapter = (brokerType: string) => this.contributions.brokersMap.get(brokerType) ?? null;
  connectBrokerInstance = (instanceId: string) => this.connectBrokerInstanceFn(instanceId);
  updateBrokerInstance = (instanceId: string, values: Record<string, unknown>, options?: BrokerInstanceUpdateOptions) => (
    this.updateBrokerInstanceFn(instanceId, values, options)
  );
  syncBrokerInstance = (instanceId: string) => this.syncBrokerInstanceFn(instanceId);
  removeBrokerInstance = (instanceId: string) => this.removeBrokerInstanceFn(instanceId);
  pinTicker = (symbol: string, options?: PinTickerOptions) => {
    this.pinTickerFn(symbol, options);
  };
  navigateTicker = (symbol: string, options?: { sourcePaneId?: string | null }) => {
    this.navigateTickerFn(symbol, options);
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
  openPaneSettings = (paneId?: string) => {
    this.openPaneSettingsFn(paneId);
  };
  openWindowMode = (paneId?: string, mode?: WindowEditMode) => {
    this.openWindowModeFn(paneId, mode);
  };
  openPluginCommandWorkflow = (commandId: string) => {
    this.openPluginCommandWorkflowFn(commandId);
  };
  showPane = (paneId: string) => {
    this.showPaneFn(paneId);
  };
  createPaneFromTemplate = (templateId: string, options?: PaneTemplateCreateOptions) => {
    this.createPaneFromTemplateFn(templateId, options);
  };
  hidePane = (paneId: string) => {
    this.hidePaneFn(paneId);
  };

  getLayoutFn: (() => LayoutConfig) = () => ({ dockRoot: null, instances: [], floating: [], detached: [] });
  updateLayoutFn: ((layout: LayoutConfig) => void) = () => {};
  getTermSizeFn: (() => { width: number; height: number }) = () => ({ width: 120, height: 40 });

  registerNewsCapabilityFn: ((capability: NewsCapability) => () => void) = () => () => {};
  watchNewsQueryFn: ((
    query: import("../../types/news-source").NewsQuery,
    listener: (state: import("../../types/news-source").NewsQueryState) => void,
  ) => () => void) = () => () => {};

  notifyFn: ((notification: AppNotificationRequest) => void) = () => {};
  getPaneRuntimeStateFn: ((paneId: string) => PaneRuntimeState | null) = () => null;
  updatePaneRuntimeStateFn: ((paneId: string, patch: Partial<PaneRuntimeState>) => void) = () => {};
  applyPaneSettingValueFn: ((paneId: string, field: import("../../types/plugin").PaneSettingField, value: unknown) => Promise<void>) = async () => {};
  getPluginConfigValueFn: (<T = unknown>(pluginId: string, key: string) => T | null) = <T = unknown>(pluginId: string, key: string): T | null => (
    (this.getConfigFn().pluginConfig[pluginId]?.[key] as T | undefined) ?? null
  );
  setPluginConfigValueFn: ((pluginId: string, key: string, value: unknown) => Promise<void>) = async () => {};
  setPluginConfigValuesFn: ((pluginId: string, values: Record<string, unknown>) => Promise<void>) = async () => {};
  deletePluginConfigValueFn: ((pluginId: string, key: string) => Promise<void>) = async () => {};

  readonly Slot;

  constructor(
    marketData: DataProvider,
    tickerRepository: TickerRepository,
    persistence: AppPersistence,
    options: PluginRegistryOptions = {},
  ) {
    this.marketData = marketData;
    this.tickerRepository = tickerRepository;
    this.persistence = persistence;
    this.enableCapabilityHandlers = options.enableCapabilityHandlers ?? true;
    this.wrapBrokerAdapter = options.wrapBrokerAdapter;
    this.events = new EventBus();
    this.contributions = new RegistryContributions({
      wrapPaneDef: (pluginId, pane) => wrapPaneDefWithRuntime(pluginId, pane, this),
      wrapTickerResearchTabDef: (pluginId, tab) => wrapTickerResearchTabDefWithRuntime(pluginId, tab, this),
      wrapBrokerAdapter: this.wrapBrokerAdapter,
    });

    bindSharedRegistry(this, marketData);
    this.capabilities = new CapabilityRegistry({
      isPluginEnabled: (pluginId) => !this.getConfigFn().disabledPlugins.includes(pluginId),
      isCapabilityEnabled: (capability, pluginId) => {
        const disabledSources = this.getConfigFn().disabledSources ?? [];
        return !disabledSources.includes(capability.sourceId ?? capability.id) && !this.getConfigFn().disabledPlugins.includes(pluginId);
      },
    });
    this.Slot = ({ name, ...props }: { name: keyof GloomSlots } & Record<string, unknown>) => (
      this.renderSlot(name, props as any)
    );
  }

  get panes(): ReadonlyMap<string, PaneDef> { return this.contributions.panesMap; }
  get paneTemplates(): ReadonlyMap<string, PaneTemplateDef> { return this.contributions.paneTemplatesMap; }
  get commands(): ReadonlyMap<string, CommandDef> { return this.contributions.commandsMap; }
  get columns(): ReadonlyMap<string, CustomColumnDef> { return this.contributions.columnsMap; }
  get brokers(): ReadonlyMap<string, BrokerAdapter> { return this.contributions.brokersMap; }
  get tickerResearchTabs(): ReadonlyMap<string, TickerResearchTabDef> { return this.contributions.tickerResearchTabsMap; }
  get shortcuts(): ReadonlyMap<string, KeyboardShortcut> { return this.contributions.shortcutsMap; }
  get tickerActions(): ReadonlyMap<string, TickerAction> { return this.contributions.tickerActionsMap; }
  get allPlugins(): ReadonlyMap<string, GloomPlugin> { return this.plugins; }

  getContextMenuItems(context: ContextMenuContext): ContextMenuItem[] {
    return resolveRegistryContextMenuItems({
      context,
      disabledPlugins: new Set(this.getConfigFn().disabledPlugins ?? []),
      providers: this.contributions.contextMenuProvidersMap.entries(),
      onProviderError: (entry, error) => {
        this.registryLog.error("Context menu provider failed", {
          pluginId: entry.pluginId,
          providerId: entry.provider.id,
          context: context.kind,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });
  }

  getCapabilityPluginId(capabilityId: string): string | undefined {
    return this.contributions.capabilityOwners.get(capabilityId);
  }

  getEnabledCapabilities(kind?: string): PluginCapability[] {
    return this.capabilities.list(kind).map((entry) => entry.capability);
  }

  getPluginPaneIds(pluginId: string): string[] {
    return this.contributions.pluginItems.get(pluginId)?.panes ?? [];
  }

  getPluginPaneTemplateIds(pluginId: string): string[] {
    return this.contributions.pluginItems.get(pluginId)?.paneTemplates ?? [];
  }

  notify(notification: AppNotificationRequest): void {
    this.notifyFn(notification);
  }

  renderSlot<K extends keyof GloomSlots>(name: K, props: GloomSlots[K]): ReactNode {
    return this.slots.render(name, props);
  }

  private registerCapabilityForPlugin(pluginId: string, capability: PluginCapability, items: PluginItems): void {
    const ownedCapability: PluginCapability = {
      ...capability,
      isEnabled: () => {
        const config = this.getConfigFn();
        const disabledPlugin = config.disabledPlugins.includes(pluginId);
        const disabledSource = config.disabledSources?.includes(capability.sourceId ?? capability.id) ?? false;
        return !disabledPlugin && !disabledSource && (capability.isEnabled?.() ?? true);
      },
    };
    const disposeCapability = this.capabilities.register(pluginId, ownedCapability);
    this.contributions.registerCapability(pluginId, capability.id, items);
    items.capabilityDisposers.push(disposeCapability);

    if (ownedCapability.kind === "news") {
      const dispose = this.registerNewsCapabilityFn(ownedCapability as NewsCapability);
      items.capabilityDisposers.push(dispose);
    }
  }

  subscribeResumeState(pluginId: string, key: string, listener: () => void): () => void {
    return this.resumeStateListeners.subscribe(pluginId, key, listener);
  }

  getResumeState<T = unknown>(pluginId: string, key: string, schemaVersion?: number): T | null {
    return this.persistence.pluginState.get<T>(pluginId, `resume:${key}`, schemaVersion)?.value ?? null;
  }

  setResumeState(pluginId: string, key: string, value: unknown, schemaVersion?: number): void {
    this.persistence.pluginState.set(pluginId, `resume:${key}`, value, schemaVersion);
    this.resumeStateListeners.emit(pluginId, key);
  }

  deleteResumeState(pluginId: string, key: string): void {
    this.persistence.pluginState.delete(pluginId, `resume:${key}`);
    this.resumeStateListeners.emit(pluginId, key);
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

  resolvePaneSettings(paneId: string): ResolvedRegistryPaneSettings | null {
    return resolveRegistryPaneSettings({
      config: this.getConfigFn(),
      getConfigState: (pluginId, key) => this.getConfigState(pluginId, key),
      getPaneRuntimeState: this.getPaneRuntimeStateFn,
      layout: this.getLayoutFn(),
      paneDefs: this.contributions.panesMap,
      paneOwners: this.contributions.paneOwners,
      resolvePaneTarget: (targetPaneId) => this.resolvePaneTarget(targetPaneId),
      requestedPaneId: paneId,
    });
  }

  hasPaneSettings(paneId: string): boolean {
    return this.resolvePaneSettings(paneId) !== null;
  }

  getCommandPluginId(commandId: string): string | undefined {
    return this.contributions.commandOwners.get(commandId);
  }

  getPaneTemplatePluginId(templateId: string): string | undefined {
    return this.contributions.paneTemplateOwners.get(templateId);
  }

  getShortcutPluginId(shortcutId: string): string | undefined {
    return this.contributions.shortcutOwners.get(shortcutId);
  }

  getTickerResearchTabPluginId(tabId: string): string | undefined {
    return this.contributions.tickerResearchTabOwners.get(tabId);
  }

  isPaneFloating(paneId: string): boolean {
    try {
      const target = this.resolvePaneTarget(paneId);
      return !!target && this.getLayoutFn().floating.some((entry) => entry.instanceId === target);
    } catch {
      return false;
    }
  }

  private createContext(pluginId: string) {
    const items = this.contributions.getOrCreatePluginItems(pluginId);
    return createRegistryPluginContext({
      pluginId,
      items,
      contributions: this.contributions,
      enableCapabilityHandlers: this.enableCapabilityHandlers,
      marketData: this.marketData,
      tickerRepository: this.tickerRepository,
      persistence: this.persistence,
      getLayout: this.getLayoutFn,
      updateLayout: this.updateLayoutFn,
      resolvePaneTarget: (paneId) => this.resolvePaneTarget(paneId),
      registerCapabilityForPlugin: (targetPluginId, capability, pluginItems) => this.registerCapabilityForPlugin(targetPluginId, capability, pluginItems),
      watchNewsQuery: this.watchNewsQueryFn,
      getData: this.getDataFn,
      getTicker: this.getTickerFn,
      getConfig: this.getConfigFn,
      getResumeState: (key, schemaVersion) => this.getResumeState(pluginId, key, schemaVersion),
      setResumeState: (key, value, schemaVersion) => this.setResumeState(pluginId, key, value, schemaVersion),
      deleteResumeState: (key) => this.deleteResumeState(pluginId, key),
      getPaneRuntimeState: this.getPaneRuntimeStateFn,
      updatePaneRuntimeState: this.updatePaneRuntimeStateFn,
      getConfigState: (key) => this.getConfigState(pluginId, key),
      setConfigState: (key, value) => this.setConfigState(pluginId, key, value),
      deleteConfigState: (key) => this.deleteConfigState(pluginId, key),
      getConfigStateKeys: () => this.getConfigStateKeys(pluginId),
      createBrokerInstance: this.createBrokerInstanceFn,
      updateBrokerInstance: this.updateBrokerInstanceFn,
      syncBrokerInstance: this.syncBrokerInstanceFn,
      removeBrokerInstance: this.removeBrokerInstanceFn,
      selectTicker: this.selectTicker,
      switchPanel: this.switchPanel,
      switchTab: this.switchTab,
      openCommandBar: this.openCommandBar,
      showPane: this.showPaneFn,
      createPaneFromTemplate: this.createPaneFromTemplateFn,
      hidePane: this.hidePaneFn,
      focusPane: this.focusPaneFn,
      pinTicker: this.pinTicker,
      navigateTicker: this.navigateTicker,
      openPaneSettings: this.openPaneSettingsFn,
      events: this.events,
      notify: this.notifyFn,
    });
  }

  private registryLog = debugLog.createLogger("registry");

  async register(plugin: GloomPlugin): Promise<void> {
    this.registryLog.info(`Registering plugin: ${plugin.id} v${plugin.version ?? "?"}`);
    const items = this.contributions.getOrCreatePluginItems(plugin.id);
    if (plugin.panes) {
      for (const pane of plugin.panes) {
        this.contributions.registerPane(plugin.id, pane, items);
      }
    }

    if (plugin.paneTemplates) {
      for (const template of plugin.paneTemplates) {
        this.contributions.registerPaneTemplate(plugin.id, template, items);
      }
    }

    if (plugin.broker) {
      this.contributions.registerBroker(plugin.id, plugin.broker, items);
    }

    if (this.enableCapabilityHandlers && plugin.capabilities) {
      for (const capability of plugin.capabilities) {
        this.registerCapabilityForPlugin(plugin.id, capability, items);
      }
    }

    this.slots.register(plugin, this);

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
    this.slots.unregister(pluginId);

    this.contributions.unregister(pluginId);

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
    this.capabilities.destroy();
    this.contributions.capabilityOwners.clear();
    this.resumeStateListeners.clear();
    releaseSharedRegistry(this, this.marketData);
  }
}
