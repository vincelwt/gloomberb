import { describe, expect, test } from "bun:test";
import { createTickerSurfacePaneTemplate } from "./ticker-surface";
import type { PaneTemplateContext } from "../../../types/plugin";

const context: PaneTemplateContext = {
  config: {} as PaneTemplateContext["config"],
  layout: { dockRoot: null, instances: [], floating: [], detached: [] },
  focusedPaneId: null,
  activeTicker: null,
  activeCollectionId: null,
};

describe("createTickerSurfacePaneTemplate", () => {
  test("creates a stable ticker-specific instance id for shortcut pane reuse", () => {
    const template = createTickerSurfacePaneTemplate({
      id: "financial-analysis-pane",
      paneId: "financial-analysis",
      label: "Financial Analysis",
      description: "Open financial statements.",
      keywords: ["fa"],
      shortcut: "FA",
    });

    const instance = template.createInstance?.(context, { symbol: "AAPL" }) as any;

    expect(instance).toEqual(expect.objectContaining({
      instanceId: "financial-analysis:AAPL",
      title: "FA AAPL",
      binding: { kind: "fixed", symbol: "AAPL" },
      placement: "floating",
    }));
  });

  test("keeps chart shortcut variants separate with view keys", () => {
    const price = createTickerSurfacePaneTemplate({
      id: "graph-price-pane",
      paneId: "ticker-chart",
      label: "Graph Price",
      description: "Open a price chart.",
      keywords: ["gp"],
      shortcut: "GP",
      viewKey: "price",
    });
    const intraday = createTickerSurfacePaneTemplate({
      id: "graph-intraday-price-pane",
      paneId: "ticker-chart",
      label: "Intraday Price Graph",
      description: "Open an intraday chart.",
      keywords: ["gip"],
      shortcut: "GIP",
      viewKey: "intraday",
    });

    expect((price.createInstance?.(context, { symbol: "AAPL" }) as any)?.instanceId).toBe("ticker-chart:AAPL:PRICE");
    expect((intraday.createInstance?.(context, { symbol: "AAPL" }) as any)?.instanceId).toBe("ticker-chart:AAPL:INTRADAY");
  });
});
