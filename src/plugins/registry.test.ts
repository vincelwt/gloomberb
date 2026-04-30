import { afterEach, describe, expect, test } from "bun:test";
import { AppPersistence } from "../data/app-persistence";
import { TickerRepository } from "../data/ticker-repository";
import { createDefaultConfig } from "../types/config";
import type { DataProvider } from "../types/data-provider";
import type { DataSource } from "../types/data-source";
import type { GloomPlugin, GloomPluginContext } from "../types/plugin";
import { PluginRegistry } from "./registry";

const dataProvider: DataProvider = {
  id: "test-provider",
  name: "Test Provider",
  getTickerFinancials: async () => ({ annualStatements: [], quarterlyStatements: [], priceHistory: [] }),
  getQuote: async (symbol) => ({
    symbol,
    price: 1,
    currency: "USD",
    change: 0,
    changePercent: 0,
    lastUpdated: Date.now(),
  }),
  getExchangeRate: async () => 1,
  search: async () => [],
  getArticleSummary: async () => null,
  getPriceHistory: async () => [],
};

let currentRegistry: PluginRegistry | null = null;
let currentPersistence: AppPersistence | null = null;

function createRegistry(options: { disabledPlugins?: string[]; disabledSources?: string[] } = {}): PluginRegistry {
  const persistence = new AppPersistence(":memory:");
  const registry = new PluginRegistry(
    dataProvider,
    new TickerRepository(persistence.tickers),
    persistence,
  );
  registry.getConfigFn = () => ({
    ...createDefaultConfig("/tmp/gloomberb-context-menu-test"),
    disabledPlugins: options.disabledPlugins ?? [],
    disabledSources: options.disabledSources ?? [],
  });
  currentRegistry = registry;
  currentPersistence = persistence;
  return registry;
}

function plugin(id: string, setup: (ctx: GloomPluginContext) => void): GloomPlugin {
  return {
    id,
    name: id,
    version: "1.0.0",
    setup,
  };
}

function contextMenuLabels(items: ReturnType<PluginRegistry["getContextMenuItems"]>): string[] {
  return items.flatMap((item) => item.type === "divider" || !item.label ? [] : [item.label]);
}

afterEach(() => {
  currentRegistry?.destroy();
  currentRegistry = null;
  currentPersistence?.close();
  currentPersistence = null;
});

describe("PluginRegistry context menu providers", () => {
  test("registers and unregisters context menu providers", async () => {
    const registry = createRegistry();
    await registry.register(plugin("tools", (ctx) => {
      ctx.registerContextMenuProvider({
        id: "app-menu",
        contexts: ["app"],
        getItems: () => [{ id: "tools:item", label: "Tools Item" }],
      });
    }));

    expect(contextMenuLabels(registry.getContextMenuItems({ kind: "app" }))).toEqual(["Tools Item"]);

    registry.unregister("tools");
    expect(registry.getContextMenuItems({ kind: "app" })).toEqual([]);
  });

  test("orders providers by order, plugin id, and provider id", async () => {
    const registry = createRegistry();
    await registry.register(plugin("z-plugin", (ctx) => {
      ctx.registerContextMenuProvider({
        id: "z-provider",
        order: 20,
        getItems: () => [{ id: "z", label: "Z" }],
      });
    }));
    await registry.register(plugin("a-plugin", (ctx) => {
      ctx.registerContextMenuProvider({
        id: "b-provider",
        order: 10,
        getItems: () => [{ id: "a-b", label: "A/B" }],
      });
      ctx.registerContextMenuProvider({
        id: "a-provider",
        order: 10,
        getItems: () => [{ id: "a-a", label: "A/A" }],
      });
    }));

    expect(contextMenuLabels(registry.getContextMenuItems({ kind: "app" }))).toEqual([
      "A/A",
      "A/B",
      "Z",
    ]);
  });

  test("filters providers from disabled plugins", async () => {
    const registry = createRegistry({ disabledPlugins: ["disabled-tools"] });
    await registry.register(plugin("disabled-tools", (ctx) => {
      ctx.registerContextMenuProvider({
        id: "hidden",
        getItems: () => [{ id: "hidden", label: "Hidden" }],
      });
    }));
    await registry.register(plugin("enabled-tools", (ctx) => {
      ctx.registerContextMenuProvider({
        id: "visible",
        getItems: () => [{ id: "visible", label: "Visible" }],
      });
    }));

    expect(contextMenuLabels(registry.getContextMenuItems({ kind: "app" }))).toEqual(["Visible"]);
  });

  test("provider exceptions do not prevent other provider items", async () => {
    const registry = createRegistry();
    await registry.register(plugin("bad-tools", (ctx) => {
      ctx.registerContextMenuProvider({
        id: "throws",
        getItems: () => {
          throw new Error("boom");
        },
      });
    }));
    await registry.register(plugin("good-tools", (ctx) => {
      ctx.registerContextMenuProvider({
        id: "works",
        getItems: () => [{ id: "works", label: "Works" }],
      });
    }));

    expect(contextMenuLabels(registry.getContextMenuItems({ kind: "app" }))).toEqual(["Works"]);
  });
});

describe("PluginRegistry data sources", () => {
  const source = (id: string): DataSource => ({
    id,
    name: id,
    market: dataProvider,
  });

  test("disabled plugins disable their contributed data sources", async () => {
    const registry = createRegistry({ disabledPlugins: ["source-plugin"] });
    await registry.register({
      id: "source-plugin",
      name: "Source Plugin",
      version: "1.0.0",
      dataSources: [source("source-a")],
    });

    expect([...registry.dataSources.keys()]).toEqual(["source-a"]);
    expect(registry.getEnabledDataSources()).toEqual([]);
  });

  test("disabledSources disables only the matching source", async () => {
    const registry = createRegistry({ disabledSources: ["source-a"] });
    await registry.register({
      id: "source-plugin",
      name: "Source Plugin",
      version: "1.0.0",
      dataSources: [source("source-a"), source("source-b")],
    });

    expect(registry.getEnabledDataSources().map((entry) => entry.id)).toEqual(["source-b"]);
  });
});

describe("PluginRegistry pane settings", () => {
  test("resolves plugin-scoped pane setting values from plugin config", async () => {
    const registry = createRegistry();
    const config = createDefaultConfig("/tmp/gloomberb-pane-settings-test");
    config.layout = {
      dockRoot: { kind: "pane", instanceId: "test-pane:main" },
      instances: [{
        instanceId: "test-pane:main",
        paneId: "test-pane",
        binding: { kind: "none" },
        settings: { breakingNewsNotificationsEnabled: false },
      }],
      floating: [],
      detached: [],
    };
    config.pluginConfig = {
      news: { breakingNewsNotificationsEnabled: true },
    };
    registry.getConfigFn = () => config;
    registry.getLayoutFn = () => config.layout;

    await registry.register(plugin("news", (ctx) => {
      ctx.registerPane({
        id: "test-pane",
        name: "Test Pane",
        defaultPosition: "right",
        component: () => null,
        settings: {
          fields: [{
            key: "breakingNewsNotificationsEnabled",
            label: "Notifications",
            type: "toggle",
            storage: "plugin",
          }],
        },
      });
    }));

    const descriptor = registry.resolvePaneSettings("test-pane:main");

    expect(descriptor?.pluginId).toBe("news");
    expect(descriptor?.context.settings.breakingNewsNotificationsEnabled).toBe(true);
  });
});
