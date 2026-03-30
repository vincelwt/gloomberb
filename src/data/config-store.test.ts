import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { loadConfig, sanitizeLayout, saveConfig } from "./config-store";
import { DEFAULT_LAYOUT, findPaneInstance } from "../types/config";
import { getDockedPaneIds } from "../plugins/pane-manager";

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
    }, DEFAULT_LAYOUT);

    expect(findPaneInstance(layout, "ticker-detail:main")?.binding).toEqual({
      kind: "follow",
      sourceInstanceId: "portfolio-list:main",
    });
    expect(getDockedPaneIds(layout)).toEqual(["portfolio-list:main", "ticker-detail:main"]);
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
    }, DEFAULT_LAYOUT);

    expect(findPaneInstance(layout, "ticker-detail:main")).toBeUndefined();
    expect(getDockedPaneIds(layout)).toHaveLength(0);
    expect(layout.dockRoot).toBeNull();
  });

  test("migrates legacy columns into a split tree and clamps floating placement memory", () => {
    const layout = sanitizeLayout({
      columns: [{ width: "100%" }],
      instances: [
        {
          instanceId: "portfolio-list:main",
          paneId: "portfolio-list",
          binding: { kind: "none" },
          params: { collectionId: "main" },
          placementMemory: {
            docked: {
              columnIndex: "left",
              order: 0,
            },
          },
        },
        {
          instanceId: "ticker-detail:main",
          paneId: "ticker-detail",
          binding: { kind: "follow", sourceInstanceId: "portfolio-list:main" },
          placementMemory: {
            docked: {
              columnIndex: 3,
              order: 2,
              height: "120%",
            },
            floating: {
              x: -5,
              y: 4,
              width: 0,
              height: 7,
            },
          },
        },
      ],
      docked: [
        { instanceId: "portfolio-list:main", columnIndex: 0, height: "130%" },
        { instanceId: "ticker-detail:main", columnIndex: 0, height: "55%" },
      ],
      floating: [],
    }, DEFAULT_LAYOUT);

    expect(layout.dockRoot?.kind).toBe("split");
    expect(layout.dockRoot && layout.dockRoot.kind === "split" ? layout.dockRoot.axis : null).toBe("vertical");
    expect(findPaneInstance(layout, "portfolio-list:main")?.placementMemory).toBeUndefined();
    expect(findPaneInstance(layout, "ticker-detail:main")?.placementMemory).toEqual({
      floating: {
        x: 0,
        y: 4,
        width: 1,
        height: 7,
      },
    });
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
      renderer: "auto",
    });
  });

  test("sanitizes invalid chart renderer values back to auto", async () => {
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
      theme: "amber",
      chartPreferences: {
        defaultRenderMode: "line",
        renderer: "nope",
      },
      recentTickers: [],
    }), "utf-8");

    const config = await loadConfig(dataDir);

    expect(config.chartPreferences).toEqual({
      defaultRenderMode: "line",
      renderer: "auto",
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

  test("migrates disabled chat plugin state to gloomberb-cloud", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "gloomberb-config-"));
    tempDirs.push(dataDir);

    await writeFile(join(dataDir, "config.json"), JSON.stringify({
      configVersion: 9,
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
      disabledPlugins: ["chat"],
      theme: "amber",
      chartPreferences: { defaultRenderMode: "area", renderer: "auto" },
      recentTickers: [],
      onboardingComplete: true,
    }), "utf-8");

    const config = await loadConfig(dataDir);

    expect(config.disabledPlugins).toContain("gloomberb-cloud");
    expect(config.disabledPlugins).not.toContain("chat");
  });

  test("keeps cloud opt-in for older completed installs", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "gloomberb-config-"));
    tempDirs.push(dataDir);

    await writeFile(join(dataDir, "config.json"), JSON.stringify({
      configVersion: 9,
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
      chartPreferences: { defaultRenderMode: "area", renderer: "auto" },
      recentTickers: [],
      onboardingComplete: true,
    }), "utf-8");

    const config = await loadConfig(dataDir);

    expect(config.disabledPlugins).toContain("gloomberb-cloud");
  });

  test("migrates version-6 configs forward without losing saved layouts", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "gloomberb-config-"));
    tempDirs.push(dataDir);

    const researchLayout = {
      columns: [{ width: "100%" }],
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
          binding: { kind: "follow", sourceInstanceId: "portfolio-list:main" },
        },
      ],
      docked: [{ instanceId: "portfolio-list:main", columnIndex: 0 }],
      floating: [{ instanceId: "ticker-detail:main", x: 8, y: 2, width: 36, height: 12 }],
    };

    await writeFile(join(dataDir, "config.json"), JSON.stringify({
      configVersion: 6,
      baseCurrency: "USD",
      refreshIntervalMinutes: 30,
      portfolios: [{ id: "main", name: "Main Portfolio", currency: "USD" }],
      watchlists: [{ id: "watchlist", name: "Watchlist" }],
      columns: [],
      layout: DEFAULT_LAYOUT,
      layouts: [
        { name: "Default", layout: DEFAULT_LAYOUT },
        { name: "Research", layout: researchLayout },
      ],
      activeLayoutIndex: 1,
      brokerInstances: [],
      plugins: [],
      disabledPlugins: [],
      theme: "amber",
      chartPreferences: { defaultRenderMode: "area" },
      recentTickers: [],
    }), "utf-8");

    const config = await loadConfig(dataDir);

    expect(config.configVersion).toBe(10);
    expect(config.activeLayoutIndex).toBe(1);
    expect(config.layouts.map((layout) => layout.name)).toEqual(["Default", "Research"]);
    expect(getDockedPaneIds(config.layout)).toEqual(["portfolio-list:main"]);
    expect(config.layout.floating).toHaveLength(1);

    await saveConfig(config);
    const persisted = JSON.parse(await readFile(join(dataDir, "config.json"), "utf-8")) as {
      configVersion: number;
      layouts: Array<{ name: string; layout: Record<string, unknown> }>;
      activeLayoutIndex: number;
    };

    expect(persisted.configVersion).toBe(10);
    expect(persisted.activeLayoutIndex).toBe(1);
    expect(persisted.layouts.map((layout) => layout.name)).toEqual(["Default", "Research"]);
    expect(persisted.layouts[1]?.layout.dockRoot).toBeDefined();
    expect(persisted.layouts[1]?.layout.docked).toBeUndefined();
  });
});
