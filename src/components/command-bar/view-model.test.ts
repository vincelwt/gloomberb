import { describe, expect, test } from "bun:test";
import {
  buildSections,
  getEmptyState,
  getFooterHints,
  getRowPresentation,
  rankTickerSearchItems,
  resolveCommandBarMode,
} from "./view-model";

describe("command bar view model helpers", () => {
  test("resolves prefix-driven modes", () => {
    expect(resolveCommandBarMode("")).toMatchObject({ kind: "default", badge: "BROWSE" });
    expect(resolveCommandBarMode("T NVDA")).toMatchObject({ kind: "search", badge: "SEARCH" });
    expect(resolveCommandBarMode("TH ")).toMatchObject({ kind: "themes", badge: "THEMES" });
    expect(resolveCommandBarMode("PL notes")).toMatchObject({ kind: "plugins", badge: "PLUGINS" });
    expect(resolveCommandBarMode("LAY ")).toMatchObject({ kind: "layout", badge: "LAYOUT" });
    expect(resolveCommandBarMode("NP ")).toMatchObject({ kind: "new-pane", badge: "NEW PANE" });
    expect(resolveCommandBarMode("PS")).toMatchObject({ kind: "direct-command", badge: "COMMAND" });
    expect(resolveCommandBarMode("AW")).toMatchObject({ kind: "direct-command", badge: "COMMAND" });
  });

  test("builds sections while preserving order", () => {
    const sections = buildSections([
      { id: "a", category: "Tickers" },
      { id: "b", category: "Commands" },
      { id: "c", category: "Tickers" },
    ]);

    expect(sections.map((section) => section.category)).toEqual(["Tickers", "Commands"]);
    expect(sections[0]?.items.map((item) => item.id)).toEqual(["a", "c"]);
  });

  test("moves danger and debug sections to the end", () => {
    const sections = buildSections([
      { id: "a", category: "Tickers" },
      { id: "b", category: "Danger" },
      { id: "c", category: "Debug" },
      { id: "d", category: "Config" },
    ]);

    expect(sections.map((section) => section.category)).toEqual(["Tickers", "Config", "Danger", "Debug"]);
  });

  test("returns footer hints for plugin toggles", () => {
    expect(getFooterHints("plugins", false)).toEqual({
      left: "up/down move  enter select  space toggle",
      right: "esc cancel",
    });
    expect(getFooterHints("layout", false)).toEqual({
      left: "up/down move  enter select",
      right: "esc cancel",
    });
    expect(getFooterHints("new-pane", false)).toEqual({
      left: "up/down move  enter select",
      right: "esc cancel",
    });
  });

  test("returns specific empty states", () => {
    expect(getEmptyState("search", "T ", "")).toEqual({
      label: "Type a ticker symbol",
      detail: "Search Yahoo Finance and connected brokers",
    });
    expect(getEmptyState("search", "T zom", "zom")).toEqual({
      label: 'No matches for "zom"',
      detail: "Try a symbol, company name, or exchange variant",
    });
    expect(getEmptyState("default", "abc")).toEqual({
      label: 'No matches for "abc"',
      detail: "Try a ticker, command name, or prefix",
    });
    expect(getEmptyState("layout", "LAY ")).toEqual({
      label: "No layout actions match",
      detail: "LAY",
    });
    expect(getEmptyState("new-pane", "NP ")).toEqual({
      label: "No pane templates match",
      detail: "NP",
    });
  });

  test("derives row presentation for toggles and current theme rows", () => {
    expect(getRowPresentation({
      id: "plugin:news",
      label: "News",
      detail: "Latest headlines",
      category: "Plugins",
      kind: "plugin",
      checked: true,
    }, false, true)).toMatchObject({
      glyph: " ",
      trailing: "on",
      primaryMuted: false,
    });

    expect(getRowPresentation({
      id: "theme:amber",
      label: "Amber",
      detail: "Warm terminal palette",
      category: "Themes",
      kind: "theme",
      right: "amber",
      current: true,
    }, false, true)).toMatchObject({
      glyph: " ",
      trailing: "current",
    });
  });

  test("ranks ticker search matches by symbol relevance and hides duplicate open symbols", () => {
    const items = rankTickerSearchItems([
      {
        id: "search:IVSX",
        label: "IVSX",
        detail: "Invsivx Holdings | ETF",
        category: "Search Results",
        kind: "search",
        right: "NYSE",
      },
      {
        id: "goto:AAPL",
        label: "AAPL",
        detail: "Apple Inc.",
        category: "Open",
        kind: "ticker",
        right: "NASDAQ",
      },
      {
        id: "search:APP",
        label: "APP",
        detail: "AppLovin Corp | EQUITY",
        category: "Search Results",
        kind: "search",
        right: "NASDAQ",
      },
      {
        id: "search:AAPL",
        label: "AAPL",
        detail: "Apple Inc | EQUITY",
        category: "Search Results",
        kind: "search",
        right: "NASDAQ",
      },
    ], "appl");

    expect(items.map((item) => item.id)).toEqual([
      "goto:AAPL",
      "search:APP",
    ]);
  });
});
