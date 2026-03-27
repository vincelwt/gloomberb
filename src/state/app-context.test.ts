import { describe, expect, test } from "bun:test";
import { createInitialState, resolveTickerForPane } from "./app-context";
import { createDefaultConfig, createPaneInstance } from "../types/config";

describe("resolveTickerForPane", () => {
  test("uses a portfolio pane cursor for inspector follow panes", () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    const state = createInitialState(config);

    state.paneState["portfolio-list:main"] = {
      collectionId: "main",
      cursorSymbol: "AAPL",
    };

    expect(resolveTickerForPane(state, "portfolio-list:main")).toBe("AAPL");
    expect(resolveTickerForPane(state, "ticker-detail:main")).toBe("AAPL");
  });

  test("uses fixed ticker bindings for pinned panes", () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    const instance = createPaneInstance("ticker-detail", {
      instanceId: "ticker-detail:msft",
      binding: { kind: "fixed", symbol: "MSFT" },
    });
    config.layout.instances.push(instance);
    config.layout.floating.push({
      instanceId: instance.instanceId,
      x: 0,
      y: 0,
      width: 40,
      height: 12,
    });

    const state = createInitialState(config);
    expect(resolveTickerForPane(state, instance.instanceId)).toBe("MSFT");
  });
});
