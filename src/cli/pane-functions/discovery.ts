import type { GloomPlugin, PaneDef, PaneTemplateDef } from "../../types/plugin";
import type { MarketContext } from "../types";
import type { PaneFunctionCatalog } from "./catalog";

export async function createPaneCatalog(context: MarketContext, plugins: GloomPlugin[]): Promise<PaneFunctionCatalog> {
  const panes = new Map<string, PaneDef>();
  const paneTemplates = new Map<string, PaneTemplateDef>();
  const setupPlugins: GloomPlugin[] = [];
  const fakePersistence = createFakePluginPersistence();
  // Collect setup-registered panes without booting the real plugin runtime or polling engines.
  const fakeContext = {
    registerPane: (pane: PaneDef) => panes.set(pane.id, pane),
    registerPaneTemplate: (template: PaneTemplateDef) => paneTemplates.set(template.id, template),
    registerCommand: () => {},
    registerColumn: () => {},
    registerBroker: () => {},
    registerCapability: () => {},
    registerDetailTab: () => {},
    registerShortcut: () => {},
    registerTickerAction: () => {},
    registerContextMenuProvider: () => {},
    watchNewsQuery: () => () => {},
    getData: () => null,
    getTicker: () => null,
    getConfig: () => context.config,
    getPaneDef: (paneId: string) => panes.get(paneId),
    marketData: context.dataProvider,
    tickerRepository: context.store,
    persistence: fakePersistence,
    log: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    resume: {
      getState: () => null,
      setState: () => {},
      deleteState: () => {},
      getPaneState: () => null,
      setPaneState: () => {},
      deletePaneState: () => {},
    },
    configState: {
      get: () => null,
      set: async () => {},
      delete: async () => {},
      keys: () => [],
    },
    paneSettings: {
      get: () => null,
      set: async () => {},
      delete: async () => {},
    },
    createBrokerInstance: async () => {
      throw new Error("Broker creation is unavailable during CLI pane discovery.");
    },
    updateBrokerInstance: async () => {},
    syncBrokerInstance: async () => {},
    removeBrokerInstance: async () => {},
    selectTicker: () => {},
    switchPanel: () => {},
    switchTab: () => {},
    openCommandBar: () => {},
    showPane: () => {},
    createPaneFromTemplate: () => {},
    hidePane: () => {},
    focusPane: () => {},
    pinTicker: () => {},
    navigateTicker: () => {},
    openPaneSettings: () => {},
    on: () => () => {},
    emit: () => {},
    notify: () => {},
  };

  for (const plugin of plugins) {
    for (const pane of plugin.panes ?? []) panes.set(pane.id, pane);
    for (const template of plugin.paneTemplates ?? []) paneTemplates.set(template.id, template);
    if (plugin.setup) {
      setupPlugins.push(plugin);
      await plugin.setup(fakeContext as never);
    }
  }

  return {
    panes,
    paneTemplates,
    destroy() {
      for (const plugin of setupPlugins.reverse()) {
        plugin.dispose?.();
      }
    },
  };
}

function createFakePluginPersistence() {
  const resources = new Map<string, unknown>();
  return {
    getState: () => null,
    setState: () => {},
    deleteState: () => {},
    getResource: (kind: string, key: string) => resources.get(`${kind}:${key}`) ?? null,
    setResource: (kind: string, key: string, value: unknown) => {
      const entry = { value, updatedAt: Date.now(), expiresAt: null, provenance: null };
      resources.set(`${kind}:${key}`, entry);
      return entry;
    },
    deleteResource: (kind: string, key: string) => {
      resources.delete(`${kind}:${key}`);
    },
  };
}
