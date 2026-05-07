import { describe, expect, test } from "bun:test";
import { cloneLayout, createDefaultConfig, findPaneInstance, type LayoutConfig } from "../../types/config";
import { createInitialState } from "../../state/app-context";
import { createTestDataProvider } from "../../test-support/data-provider";
import { applyPaneSettingFieldValue, createPaneTemplateOrThrow } from "./workflow-ops";

function makeDataProvider() {
  return createTestDataProvider({ id: "test" });
}

function makeTickerRepository() {
  return {
    getTicker: async () => null,
    saveTicker: async () => {},
    createTicker: async () => { throw new Error("unused"); },
    deleteTicker: async () => {},
    getAllTickers: async () => [],
  };
}

describe("createPaneTemplateOrThrow", () => {
  test("treats createInstance null as cancellation and does not create a pane", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-workflow-ops-test");
    const state = createInitialState(config);
    const buildCalls: unknown[] = [];
    const placeCalls: unknown[] = [];

    await createPaneTemplateOrThrow("cancelled-pane", undefined, {
      dataProvider: makeDataProvider() as any,
      tickerRepository: makeTickerRepository() as any,
      dispatch: () => {},
      getState: () => state,
      pluginRegistry: {
        paneTemplates: new Map([
          ["cancelled-pane", {
            id: "cancelled-pane",
            paneId: "test-pane",
            label: "Cancelled Pane",
            description: "Should cancel cleanly",
            createInstance: async () => null,
          }],
        ]),
        panes: new Map([
          ["test-pane", {
            id: "test-pane",
            name: "Test Pane",
            component: () => null,
            defaultPosition: "right",
          }],
        ]),
        getPaneTemplatePluginId: () => undefined,
        events: { emit: () => {} },
      } as any,
      buildPaneInstance: (...args) => {
        buildCalls.push(args);
        return {
          instanceId: "test-pane:1",
          paneId: "test-pane",
          title: "Broken Pane",
        } as any;
      },
      placePaneInstance: (...args) => {
        placeCalls.push(args);
      },
    });

    expect(buildCalls).toHaveLength(0);
    expect(placeCalls).toHaveLength(0);
  });
});

describe("applyPaneSettingFieldValue", () => {
  test("keeps portfolio panes on their displayed collection when switching back to all collections", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-workflow-ops-test");
    const layout = cloneLayout(config.layout);
    const portfolioPane = findPaneInstance(layout, "portfolio-list:main");
    if (!portfolioPane) throw new Error("missing portfolio pane");
    portfolioPane.settings = {
      ...(portfolioPane.settings ?? {}),
      collectionScope: "watchlists",
      visibleCollectionIds: ["watchlist"],
      hideTabs: true,
      lockedCollectionId: "watchlist",
    };

    const state = createInitialState({ ...config, layout });
    state.paneState["portfolio-list:main"] = {
      collectionId: "main",
      cursorSymbol: null,
    };

    const persisted: LayoutConfig[] = [];
    const actions: unknown[] = [];

    await applyPaneSettingFieldValue("portfolio-list:main", {
      key: "collectionScope",
      label: "Collections",
      type: "select",
      options: [],
    }, "all", {
      dataProvider: makeDataProvider() as any,
      tickerRepository: makeTickerRepository() as any,
      dispatch: (action) => { actions.push(action); },
      getState: () => state,
      persistLayout: (nextLayout) => { persisted.push(nextLayout); },
      pluginRegistry: {
        resolvePaneSettings: () => ({
          paneId: "portfolio-list:main",
          pane: portfolioPane,
          paneDef: {
            id: "portfolio-list",
            name: "Portfolio",
            component: () => null,
            defaultPosition: "left",
          },
          settingsDef: { title: "Portfolio Pane Settings", fields: [] },
          context: {
            config: state.config,
            layout: state.config.layout,
            paneId: "portfolio-list:main",
            paneType: "portfolio-list",
            pane: portfolioPane,
            settings: portfolioPane.settings ?? {},
            paneState: state.paneState["portfolio-list:main"] ?? {},
            activeTicker: null,
            activeCollectionId: "main",
          },
        }),
      } as any,
    });

    const nextPane = findPaneInstance(persisted[0]!, "portfolio-list:main");
    expect(nextPane?.settings).toMatchObject({ collectionScope: "all" });
    expect("visibleCollectionIds" in (nextPane?.settings ?? {})).toBe(false);
    expect("hideTabs" in (nextPane?.settings ?? {})).toBe(false);
    expect("lockedCollectionId" in (nextPane?.settings ?? {})).toBe(false);
    expect(nextPane?.params?.collectionId).toBe("watchlist");
    expect(actions).toContainEqual({
      type: "UPDATE_PANE_STATE",
      paneId: "portfolio-list:main",
      patch: { collectionId: "watchlist" },
    });
  });
});
