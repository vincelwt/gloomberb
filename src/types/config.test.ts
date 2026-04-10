import { describe, expect, test } from "bun:test";
import {
  createPaneInstance,
  findPrimaryPaneInstance,
  resolveFollowBindingInstance,
  resolvePaneInstance,
  type LayoutConfig,
  type PaneInstanceConfig,
} from "./config";

function createLayout(instances: PaneInstanceConfig[]): LayoutConfig {
  return {
    dockRoot: null,
    instances,
    floating: [],
  };
}

describe("findPrimaryPaneInstance", () => {
  test("prefers the main non-fixed ticker pane", () => {
    const layout = createLayout([
      createPaneInstance("portfolio-list", {
        instanceId: "portfolio-list:main",
        binding: { kind: "none" },
      }),
      createPaneInstance("ticker-detail", {
        instanceId: "ticker-detail:pinned",
        binding: { kind: "fixed", symbol: "AAPL" },
      }),
      createPaneInstance("ticker-detail", {
        instanceId: "ticker-detail:main",
        binding: { kind: "follow", sourceInstanceId: "portfolio-list:main" },
      }),
    ]);

    expect(findPrimaryPaneInstance(layout, "ticker-detail")?.instanceId).toBe("ticker-detail:main");
  });

  test("does not treat fixed ticker panes as the primary pane", () => {
    const layout = createLayout([
      createPaneInstance("ticker-detail", {
        instanceId: "ticker-detail:aapl",
        binding: { kind: "fixed", symbol: "AAPL" },
      }),
      createPaneInstance("ticker-detail", {
        instanceId: "ticker-detail:msft",
        binding: { kind: "fixed", symbol: "MSFT" },
      }),
    ]);

    expect(findPrimaryPaneInstance(layout, "ticker-detail")).toBeUndefined();
  });
});

describe("resolvePaneInstance", () => {
  test("accepts either an instance id or a pane id", () => {
    const layout = createLayout([
      createPaneInstance("portfolio-list", {
        instanceId: "portfolio-list:main",
        binding: { kind: "none" },
      }),
    ]);

    expect(resolvePaneInstance(layout, "portfolio-list:main")?.instanceId).toBe("portfolio-list:main");
    expect(resolvePaneInstance(layout, "portfolio-list")?.instanceId).toBe("portfolio-list:main");
  });
});

describe("resolveFollowBindingInstance", () => {
  test("walks follow bindings until it finds a matching pane", () => {
    const layout = createLayout([
      createPaneInstance("portfolio-list", {
        instanceId: "portfolio-list:main",
        binding: { kind: "none" },
      }),
      createPaneInstance("ticker-detail", {
        instanceId: "ticker-detail:main",
        binding: { kind: "follow", sourceInstanceId: "portfolio-list:main" },
      }),
      createPaneInstance("quote-monitor", {
        instanceId: "quote-monitor:main",
        binding: { kind: "follow", sourceInstanceId: "ticker-detail:main" },
      }),
    ]);

    expect(
      resolveFollowBindingInstance(layout, "quote-monitor:main", (instance) => instance.paneId === "portfolio-list")?.instanceId,
    ).toBe("portfolio-list:main");
  });

  test("stops on follow cycles", () => {
    const layout = createLayout([
      createPaneInstance("ticker-detail", {
        instanceId: "ticker-detail:first",
        binding: { kind: "follow", sourceInstanceId: "quote-monitor:first" },
      }),
      createPaneInstance("quote-monitor", {
        instanceId: "quote-monitor:first",
        binding: { kind: "follow", sourceInstanceId: "ticker-detail:first" },
      }),
    ]);

    expect(
      resolveFollowBindingInstance(layout, "ticker-detail:first", (instance) => instance.paneId === "portfolio-list"),
    ).toBeUndefined();
  });
});
