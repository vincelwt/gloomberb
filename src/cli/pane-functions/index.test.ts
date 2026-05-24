import { describe, expect, test } from "bun:test";
import { paneFunctionTestInternals } from "./index";

const {
  parsePaneFunctionArgs,
  parsePaneCatalogArgs,
  normalizeLookupToken,
  parseArgumentsOption,
  optionPaneState,
  filterPaneCatalogEntries,
  renderPaneCatalogReport,
} = paneFunctionTestInternals;

describe("pane function CLI args", () => {
  test("parses target, argument, output, size, and pane options", () => {
    const parsed = parsePaneFunctionArgs([
      "FA",
      "$NVDA",
      "--period",
      "quarterly",
      "--statement=balance",
      "--output",
      "/tmp/fa-nvda.png",
      "--width",
      "900",
      "--height=700",
    ]);

    expect(parsed.target).toBe("FA");
    expect(parsed.arg).toBe("$NVDA");
    expect(parsed.outputPath).toBe("/tmp/fa-nvda.png");
    expect(parsed.width).toBe(900);
    expect(parsed.height).toBe(700);
    expect(parsed.options).toEqual({
      period: "quarterly",
      statement: "balance",
    });
  });

  test("normalizes pane ids and shortcuts into one lookup form", () => {
    expect(normalizeLookupToken("comparison-chart-pane")).toBe("comparisonchartpane");
    expect(normalizeLookupToken("CMP")).toBe("cmp");
    expect(normalizeLookupToken("$FA")).toBe("fa");
  });

  test("expands --arguments key-value pairs", () => {
    expect(parseArgumentsOption("range-preset=1Y, axis_mode=percent")).toEqual({
      rangePreset: "1Y",
      axisMode: "percent",
    });
  });

  test("maps generic screenshot options into pane runtime state", () => {
    expect(optionPaneState({
      activeTab: "chart",
      state: "cursorSymbol=NVDA,customFlag=true",
    })).toEqual({
      activeTabId: "chart",
      cursorSymbol: "NVDA",
      customFlag: true,
    });
  });

  test("maps financial statement options into reusable pane state", () => {
    expect(optionPaneState({
      statement: "balance sheet",
      period: "quarterly",
    })).toEqual({
      financialSubTab: "balance",
      financialPeriod: "quarterly",
    });
  });

  test("parses catalog queries and limit options", () => {
    expect(parsePaneCatalogArgs(["chart", "price", "--limit", "3"])).toEqual({
      query: "chart price",
      limit: 3,
    });
  });

  test("searches and renders pane catalog entries", () => {
    const matches = filterPaneCatalogEntries([
      {
        token: "GP",
        label: "Graph Price",
        description: "Open a ticker detail pane locked to a price chart.",
        paneId: "ticker-detail",
        paneName: "Detail",
        templateId: "graph-price-pane",
        shortcut: "GP",
        argKind: "ticker",
        argPlaceholder: "ticker",
        keywords: ["gp", "graph", "price", "chart"],
        defaultSettings: { lockedTabId: "chart", chartRangePreset: "5Y" },
      },
      {
        token: "FA",
        label: "Financial Analysis",
        description: "Open a ticker detail pane locked to financial statements.",
        paneId: "ticker-detail",
        paneName: "Detail",
        templateId: "financial-analysis-pane",
        shortcut: "FA",
        argKind: "ticker",
        argPlaceholder: "ticker",
        keywords: ["fa", "financial", "analysis", "statements"],
        defaultSettings: { lockedTabId: "financials" },
      },
    ], "price chart");

    expect(matches.map((entry) => entry.token)).toEqual(["GP"]);
    expect(renderPaneCatalogReport(matches, { query: "price chart", limit: 10 })).toContain("gloomberb shot GP <ticker>");
  });
});
