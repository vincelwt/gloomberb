import { describe, expect, test } from "bun:test";
import { createDefaultConfig } from "../../../types/config";
import type { GloomPluginContext, PaneDef, PaneTemplateDef, DetailTabDef } from "../../../types/plugin";
import { aiPlugin } from "./index";
import { __setDetectedProvidersForTests, type AiProvider } from "./providers";

function createPluginContext() {
  const panes: PaneDef[] = [];
  const templates: PaneTemplateDef[] = [];
  const detailTabs: DetailTabDef[] = [];

  const ctx = {
    registerPane: (pane: PaneDef) => { panes.push(pane); },
    registerPaneTemplate: (template: PaneTemplateDef) => { templates.push(template); },
    registerCommand: () => {},
    registerColumn: () => {},
    registerBroker: () => {},
    registerDataProvider: () => {},
    registerDetailTab: (tab: DetailTabDef) => { detailTabs.push(tab); },
    registerShortcut: () => {},
    registerTickerAction: () => {},
    getData: () => null,
    getTicker: () => null,
    getConfig: () => createDefaultConfig("/tmp/gloomberb-ai-plugin"),
    dataProvider: {} as any,
    tickerRepository: {} as any,
    persistence: {} as any,
    log: { info() {}, warn() {}, error() {}, debug() {} },
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
    createBrokerInstance: async () => { throw new Error("unused"); },
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
    openPaneSettings: () => {},
    on: () => () => {},
    emit: () => {},
    showWidget: () => {},
    hideWidget: () => {},
    notify: () => {},
  } satisfies GloomPluginContext;

  return { ctx, panes, templates, detailTabs };
}

describe("aiPlugin", () => {
  test("registers the Ask AI detail tab and AI screener pane template", async () => {
    const providers: AiProvider[] = [
      { id: "claude", name: "Claude", command: "claude", available: true, buildArgs: () => [] },
      { id: "gemini", name: "Gemini", command: "gemini", available: false, buildArgs: () => [] },
    ];
    __setDetectedProvidersForTests(providers);

    const { ctx, panes, templates, detailTabs } = createPluginContext();
    await aiPlugin.setup?.(ctx);

    const detailTab = detailTabs.find((entry) => entry.id === "ai-chat");
    const pane = panes.find((entry) => entry.id === "ai-screener");
    const template = templates.find((entry) => entry.id === "new-ai-screener-pane");

    expect(detailTab?.name).toBe("Ask AI");
    expect(pane?.name).toBe("AI Screener");
    expect(pane?.settings?.({
      config: createDefaultConfig("/tmp/gloomberb-ai-plugin"),
      layout: createDefaultConfig("/tmp/gloomberb-ai-plugin").layout,
      paneId: "ai-screener:test",
      paneType: "ai-screener",
      pane: {
        instanceId: "ai-screener:test",
        paneId: "ai-screener",
        settings: {},
      },
      settings: {},
      paneState: {},
      activeTicker: null,
      activeCollectionId: null,
    })?.fields[0]?.key).toBe("columnIds");
    expect(template?.shortcut).toEqual({
      prefix: "AI",
      argPlaceholder: "prompt",
      argKind: "text",
    });
    expect(template?.wizard?.map((step) => step.type)).toEqual(["select", "textarea"]);
    expect(template?.wizard?.[0]?.defaultValue).toBe("claude");
    expect(template?.wizard?.[0]?.options).toEqual([
      { label: "Claude", value: "claude" },
    ]);
    expect(template?.createInstance?.(
      {
        config: createDefaultConfig("/tmp/gloomberb-ai-plugin"),
        layout: createDefaultConfig("/tmp/gloomberb-ai-plugin").layout,
        focusedPaneId: null,
        activeTicker: null,
        activeCollectionId: null,
      },
      {
        values: {
          providerId: "claude",
          prompt: "high-ROIC compounders",
        },
      },
    )).toEqual({
      title: "AI Screener",
      placement: "floating",
      params: {
        prompt: "high-ROIC compounders",
        providerId: "claude",
      },
    });

    __setDetectedProvidersForTests(null);
  });
});
