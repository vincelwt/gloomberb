import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { loadConfig, sanitizeLayout } from "./config-store";
import { DEFAULT_LAYOUT, findPaneInstance, type LayoutConfig } from "../types/config";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("sanitizeLayout", () => {
  test("rewrites unbound ticker-detail panes to follow the first portfolio pane", () => {
    const layout = sanitizeLayout({
      columns: [{ width: "50%" }, { width: "50%" }],
      instances: [
        {
          instanceId: "portfolio-list:main",
          paneId: "portfolio-list",
          binding: { kind: "none" },
          params: { collectionId: "main" },
        },
        {
          instanceId: "ticker-detail:main",
          paneId: "ticker-detail",
          binding: { kind: "none" },
        },
      ],
      docked: [
        { instanceId: "portfolio-list:main", columnIndex: 0 },
        { instanceId: "ticker-detail:main", columnIndex: 1 },
      ],
      floating: [],
    } satisfies LayoutConfig, DEFAULT_LAYOUT);

    expect(findPaneInstance(layout, "ticker-detail:main")?.binding).toEqual({
      kind: "follow",
      sourceInstanceId: "portfolio-list:main",
    });
  });

  test("removes follow panes whose source pane is missing", () => {
    const layout = sanitizeLayout({
      columns: [{ width: "100%" }],
      instances: [
        {
          instanceId: "ticker-detail:main",
          paneId: "ticker-detail",
          binding: { kind: "follow", sourceInstanceId: "portfolio-list:missing" },
        },
      ],
      docked: [{ instanceId: "ticker-detail:main", columnIndex: 0 }],
      floating: [],
    } satisfies LayoutConfig, DEFAULT_LAYOUT);

    expect(findPaneInstance(layout, "ticker-detail:main")).toBeUndefined();
    expect(layout.docked).toHaveLength(0);
  });
});

describe("loadConfig", () => {
  test("fills in missing chart preferences for older configs", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "gloomberb-config-"));
    tempDirs.push(dataDir);

    await writeFile(join(dataDir, "config.json"), JSON.stringify({
      configVersion: 5,
      baseCurrency: "USD",
      refreshIntervalMinutes: 30,
      portfolios: [{ id: "main", name: "Main Portfolio", currency: "USD" }],
      watchlists: [{ id: "watchlist", name: "Watchlist" }],
      columns: [],
      layout: DEFAULT_LAYOUT,
      layouts: [{ name: "Default", layout: DEFAULT_LAYOUT }],
      activeLayoutIndex: 0,
      brokerInstances: [],
      plugins: [],
      disabledPlugins: [],
      theme: "amber",
      recentTickers: [],
    }), "utf-8");

    const config = await loadConfig(dataDir);

    expect(config.chartPreferences).toEqual({
      defaultRenderMode: "area",
    });
    expect(config.pluginConfig).toEqual({});
  });

  test("preserves plugin config state from disk", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "gloomberb-config-"));
    tempDirs.push(dataDir);

    await writeFile(join(dataDir, "config.json"), JSON.stringify({
      configVersion: 7,
      baseCurrency: "USD",
      refreshIntervalMinutes: 30,
      portfolios: [{ id: "main", name: "Main Portfolio", currency: "USD" }],
      watchlists: [{ id: "watchlist", name: "Watchlist" }],
      columns: [],
      layout: DEFAULT_LAYOUT,
      layouts: [{ name: "Default", layout: DEFAULT_LAYOUT }],
      activeLayoutIndex: 0,
      brokerInstances: [],
      plugins: [],
      disabledPlugins: [],
      pluginConfig: {
        news: {
          displayMode: "expanded",
        },
      },
      theme: "amber",
      chartPreferences: { defaultRenderMode: "line" },
      recentTickers: [],
    }), "utf-8");

    const config = await loadConfig(dataDir);

    expect(config.pluginConfig).toEqual({
      news: {
        displayMode: "expanded",
      },
    });
  });
});
