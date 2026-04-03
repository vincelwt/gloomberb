import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { loadConfig, sanitizeLayout, saveConfig } from "./config-store";
import { CURRENT_CONFIG_VERSION, DEFAULT_LAYOUT, findPaneInstance } from "../types/config";
import { getDockedPaneIds } from "../plugins/pane-manager";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempConfigDir(): Promise<string> {
  const dataDir = await mkdtemp(join(tmpdir(), "gloomberb-config-"));
  tempDirs.push(dataDir);
  return dataDir;
}

function createSavedConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    configVersion: CURRENT_CONFIG_VERSION,
    baseCurrency: "USD",
    refreshIntervalMinutes: 30,
    portfolios: [{ id: "main", name: "Main Portfolio", currency: "USD" }],
    watchlists: [{ id: "watchlist", name: "Watchlist" }],
    layout: DEFAULT_LAYOUT,
    layouts: [{ name: "Default", layout: DEFAULT_LAYOUT }],
    activeLayoutIndex: 0,
    brokerInstances: [],
    plugins: [],
    disabledPlugins: [],
    theme: "amber",
    chartPreferences: { defaultRenderMode: "area", renderer: "auto" },
    recentTickers: [],
    ...overrides,
  };
}

async function writeConfigJson(dataDir: string, config: Record<string, unknown>): Promise<void> {
  await writeFile(join(dataDir, "config.json"), JSON.stringify(config), "utf-8");
}

describe("sanitizeLayout", () => {
  test("rewrites unbound ticker-detail panes to follow the first portfolio pane", () => {
    const layout = sanitizeLayout({
      dockRoot: {
        kind: "split",
        axis: "horizontal",
        ratio: 0.5,
        first: { kind: "pane", instanceId: "portfolio-list:main" },
        second: { kind: "pane", instanceId: "ticker-detail:main" },
      },
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
      dockRoot: { kind: "pane", instanceId: "ticker-detail:main" },
      instances: [
        {
          instanceId: "ticker-detail:main",
          paneId: "ticker-detail",
          binding: { kind: "follow", sourceInstanceId: "portfolio-list:missing" },
        },
      ],
      floating: [],
    }, DEFAULT_LAYOUT);

    expect(findPaneInstance(layout, "ticker-detail:main")).toBeUndefined();
    expect(getDockedPaneIds(layout)).toHaveLength(0);
    expect(layout.dockRoot).toBeNull();
  });

  test("clamps floating placement memory and drops invalid docked placement hints", () => {
    const layout = sanitizeLayout({
      dockRoot: {
        kind: "split",
        axis: "vertical",
        ratio: 0.55,
        first: { kind: "pane", instanceId: "portfolio-list:main" },
        second: { kind: "pane", instanceId: "ticker-detail:main" },
      },
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

  test("falls back to the default layout when given an obsolete column layout", () => {
    const layout = sanitizeLayout({
      columns: [{ width: "100%" }],
      instances: [
        {
          instanceId: "portfolio-list:main",
          paneId: "portfolio-list",
          binding: { kind: "none" },
        },
      ],
      docked: [{ instanceId: "portfolio-list:main", columnIndex: 0 }],
      floating: [],
    }, DEFAULT_LAYOUT);

    expect(layout).toEqual(DEFAULT_LAYOUT);
  });
});

describe("loadConfig", () => {
  test("fills in missing chart preferences for older configs", async () => {
    const dataDir = await createTempConfigDir();
    await writeConfigJson(dataDir, createSavedConfig({
      configVersion: 5,
      recentTickers: [],
      chartPreferences: undefined,
    }));

    const config = await loadConfig(dataDir);

    expect(config.chartPreferences).toEqual({
      defaultRenderMode: "area",
      renderer: "auto",
    });
  });

  test("sanitizes invalid chart renderer values back to auto", async () => {
    const dataDir = await createTempConfigDir();
    await writeConfigJson(dataDir, createSavedConfig({
      configVersion: 7,
      chartPreferences: {
        defaultRenderMode: "line",
        renderer: "nope",
      },
    }));

    const config = await loadConfig(dataDir);

    expect(config.chartPreferences).toEqual({
      defaultRenderMode: "line",
      renderer: "auto",
    });
    expect(config.pluginConfig).toEqual({});
  });

  test("preserves plugin config state from disk", async () => {
    const dataDir = await createTempConfigDir();
    await writeConfigJson(dataDir, createSavedConfig({
      configVersion: 7,
      pluginConfig: {
        news: {
          displayMode: "expanded",
        },
      },
      chartPreferences: { defaultRenderMode: "line" },
    }));

    const config = await loadConfig(dataDir);

    expect(config.pluginConfig).toEqual({
      news: {
        displayMode: "expanded",
      },
    });
  });

  test("preserves disabled plugin ids without migration rewrites", async () => {
    const dataDir = await createTempConfigDir();
    await writeConfigJson(dataDir, createSavedConfig({
      configVersion: 9,
      disabledPlugins: ["chat", "news", "chat"],
    }));

    const config = await loadConfig(dataDir);

    expect(config.disabledPlugins).toEqual(["chat", "news"]);
  });

  test("preserves IBKR gateway configs without migration rewrites", async () => {
    const dataDir = await createTempConfigDir();
    await writeConfigJson(dataDir, createSavedConfig({
      configVersion: 10,
      brokerInstances: [{
        id: "ibkr-interactive-brokers",
        brokerType: "ibkr",
        label: "Interactive Brokers",
        connectionMode: "gateway",
        config: {
          connectionMode: "gateway",
          host: "127.0.0.1",
          port: 4002,
          clientId: 1,
        },
      }],
    }));

    const config = await loadConfig(dataDir);

    expect(config.brokerInstances[0]?.config).toEqual({
      connectionMode: "gateway",
      host: "127.0.0.1",
      port: 4002,
      clientId: 1,
    });
  });

  test("falls back to the default layout when persisted layouts use the obsolete column shape", async () => {
    const dataDir = await createTempConfigDir();
    const obsoleteLayout = {
      columns: [{ width: "100%" }],
      instances: [
        {
          instanceId: "portfolio-list:main",
          paneId: "portfolio-list",
          binding: { kind: "none" },
        },
      ],
      docked: [{ instanceId: "portfolio-list:main", columnIndex: 0 }],
      floating: [],
    };

    await writeConfigJson(dataDir, createSavedConfig({
      configVersion: 6,
      layouts: [
        { name: "Default", layout: DEFAULT_LAYOUT },
        { name: "Research", layout: obsoleteLayout },
      ],
      activeLayoutIndex: 1,
    }));

    const config = await loadConfig(dataDir);

    expect(config.configVersion).toBe(CURRENT_CONFIG_VERSION);
    expect(config.activeLayoutIndex).toBe(1);
    expect(config.layouts.map((layout) => layout.name)).toEqual(["Default", "Research"]);
    expect(config.layout).toEqual(DEFAULT_LAYOUT);

    await saveConfig(config);
    const persisted = JSON.parse(await readFile(join(dataDir, "config.json"), "utf-8")) as {
      configVersion: number;
      layouts: Array<{ name: string; layout: Record<string, unknown> }>;
      activeLayoutIndex: number;
    };

    expect(persisted.configVersion).toBe(CURRENT_CONFIG_VERSION);
    expect(persisted.activeLayoutIndex).toBe(1);
    expect(persisted.layouts[1]?.layout).toEqual(DEFAULT_LAYOUT);
  });
});
