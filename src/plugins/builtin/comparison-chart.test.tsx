import { describe, expect, test } from "bun:test";
import { createDefaultConfig } from "../../types/config";
import {
  buildComparisonChartPaneTitle,
  comparisonChartPlugin,
  COMPARISON_CHART_TEMPLATE_ID,
  getComparisonChartPaneSettings,
} from "./comparison-chart";

describe("comparisonChartPlugin", () => {
  test("creates a configured comparison pane from resolved symbols", () => {
    const template = comparisonChartPlugin.paneTemplates?.find((entry) => entry.id === COMPARISON_CHART_TEMPLATE_ID);

    expect(template).toBeDefined();
    expect(template?.createInstance?.({
      config: createDefaultConfig("/tmp/gloomberb-compare"),
      layout: createDefaultConfig("/tmp/gloomberb-compare").layout,
      focusedPaneId: "ticker-detail:main",
      activeTicker: null,
      activeCollectionId: null,
    }, {
      symbols: ["AAPL", "MSFT", "NVDA"],
    })).toEqual({
      title: "AAPL · MSFT · NVDA",
      settings: {
        axisMode: "price",
        symbols: ["AAPL", "MSFT", "NVDA"],
        symbolsText: "AAPL, MSFT, NVDA",
      },
    });
  });

  test("parses stored pane settings and backfills the text form", () => {
    expect(getComparisonChartPaneSettings({
      axisMode: "percent",
      symbols: ["AAPL", "MSFT"],
    })).toEqual({
      axisMode: "percent",
      symbols: ["AAPL", "MSFT"],
      symbolsText: "AAPL, MSFT",
    });
  });
});

describe("buildComparisonChartPaneTitle", () => {
  test("summarizes longer symbol lists", () => {
    expect(buildComparisonChartPaneTitle(["AAPL", "MSFT", "NVDA", "META"])).toBe("AAPL · MSFT +2");
  });
});
