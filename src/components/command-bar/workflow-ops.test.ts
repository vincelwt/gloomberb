import { describe, expect, test } from "bun:test";
import { createDefaultConfig } from "../../types/config";
import { createInitialState } from "../../state/app-context";
import { createTestDataProvider } from "../../test-support/data-provider";
import { createPaneTemplateOrThrow } from "./workflow-ops";

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
