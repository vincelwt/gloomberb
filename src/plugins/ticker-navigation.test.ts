import { describe, expect, test } from "bun:test";
import { createPaneInstance, type LayoutConfig, type PaneInstanceConfig } from "../types/config";
import {
  resolveTickerNavigationDetailPane,
  shouldFocusTickerNavigationTarget,
} from "./ticker-navigation";

function createLayout(instances: PaneInstanceConfig[]): LayoutConfig {
  return {
    dockRoot: { kind: "pane", instanceId: instances[0]?.instanceId ?? "" },
    instances,
    floating: instances.slice(1).map((instance, index) => ({
      instanceId: instance.instanceId,
      x: 2 + index,
      y: 2 + index,
      width: 40,
      height: 12,
    })),
    detached: [],
  };
}

describe("resolveTickerNavigationDetailPane", () => {
  test("prefers the detail pane following the pane that opened ticker navigation", () => {
    const layout = createLayout([
      createPaneInstance("portfolio-list", {
        instanceId: "portfolio-list:main",
        binding: { kind: "none" },
      }),
      createPaneInstance("comparison-chart", {
        instanceId: "comparison-chart:main",
        binding: { kind: "none" },
      }),
      createPaneInstance("ticker-detail", {
        instanceId: "ticker-detail:portfolio",
        binding: { kind: "follow", sourceInstanceId: "portfolio-list:main" },
      }),
      createPaneInstance("ticker-detail", {
        instanceId: "ticker-detail:compare",
        binding: { kind: "follow", sourceInstanceId: "comparison-chart:main" },
      }),
    ]);

    expect(
      resolveTickerNavigationDetailPane(layout, "comparison-chart:main")?.instanceId,
    ).toBe("ticker-detail:compare");
  });
});

describe("shouldFocusTickerNavigationTarget", () => {
  test("does not focus stale async ticker navigation after the user moves to another pane", () => {
    expect(shouldFocusTickerNavigationTarget({
      sourcePaneId: "comparison-chart:main",
      currentFocusedPaneId: "portfolio-list:main",
      targetPaneId: "ticker-detail:compare",
    })).toBe(false);
  });

  test("keeps focusing when the source pane still owns the latest interaction", () => {
    expect(shouldFocusTickerNavigationTarget({
      sourcePaneId: "comparison-chart:main",
      currentFocusedPaneId: "comparison-chart:main",
      targetPaneId: "ticker-detail:compare",
    })).toBe(true);
  });
});
