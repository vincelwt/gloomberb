import { describe, expect, test } from "bun:test";
import { cloneLayout, createDefaultConfig, createPaneInstance, DEFAULT_PORTFOLIO_COLUMN_IDS, type LayoutConfig } from "./types/config";
import { deletePaneSetting, getPaneSettingValue, setPaneSetting } from "./pane-settings";

describe("pane settings helpers", () => {
  test("seeds built-in default panes with persisted settings", () => {
    const config = createDefaultConfig("/tmp/gloomberb-pane-settings");
    const portfolioPane = config.layout.instances.find((instance) => instance.instanceId === "portfolio-list:main");
    const detailPane = config.layout.instances.find((instance) => instance.instanceId === "ticker-detail:main");

    expect(portfolioPane?.settings).toMatchObject({
      collectionScope: "all",
      hideTabs: false,
      lockedCollectionId: "main",
    });
    expect(portfolioPane?.settings?.columnIds).toEqual(DEFAULT_PORTFOLIO_COLUMN_IDS);
    expect(detailPane?.settings).toEqual({
      chartRangePreset: "5Y",
      chartResolution: "auto",
      hideTabs: false,
      lockedTabId: "overview",
    });
  });

  test("cloneLayout deep-clones pane settings", () => {
    const layout = cloneLayout(createDefaultConfig("/tmp/gloomberb-pane-settings").layout);
    const cloned = cloneLayout(layout);
    const clonedPortfolioSettings = cloned.instances.find((instance) => instance.instanceId === "portfolio-list:main")?.settings;
    const originalPortfolioSettings = layout.instances.find((instance) => instance.instanceId === "portfolio-list:main")?.settings;

    expect(clonedPortfolioSettings).toBeDefined();
    expect(clonedPortfolioSettings).not.toBe(originalPortfolioSettings);

    (clonedPortfolioSettings?.columnIds as string[]).push("change");
    expect(originalPortfolioSettings?.columnIds).toEqual(DEFAULT_PORTFOLIO_COLUMN_IDS);
  });

  test("setPaneSetting and deletePaneSetting update pane-scoped settings immutably", () => {
    const config = createDefaultConfig("/tmp/gloomberb-pane-settings");
    const extraPane = createPaneInstance("quote-monitor", {
      instanceId: "quote-monitor:test",
      binding: { kind: "fixed", symbol: "AAPL" },
      settings: { symbol: "AAPL" },
    });
    const layout: LayoutConfig = {
      ...config.layout,
      instances: [...config.layout.instances, extraPane],
    };

    const updated = setPaneSetting(layout, "quote-monitor:test", "symbol", "MSFT");
    expect(getPaneSettingValue(updated.instances.find((instance) => instance.instanceId === "quote-monitor:test"), "symbol", "")).toBe("MSFT");
    expect(getPaneSettingValue(layout.instances.find((instance) => instance.instanceId === "quote-monitor:test"), "symbol", "")).toBe("AAPL");

    const cleared = deletePaneSetting(updated, "quote-monitor:test", "symbol");
    expect(getPaneSettingValue(cleared.instances.find((instance) => instance.instanceId === "quote-monitor:test"), "symbol", null)).toBeNull();
  });
});
