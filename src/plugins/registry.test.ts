import { afterEach, describe, expect, test } from "bun:test";
import { AppPersistence } from "../data/app-persistence";
import { TickerRepository } from "../data/ticker-repository";
import { createDefaultConfig } from "../types/config";
import type { DataProvider } from "../types/data-provider";
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
  getNews: async () => [],
  getArticleSummary: async () => null,
  getPriceHistory: async () => [],
};

let currentRegistry: PluginRegistry | null = null;
let currentPersistence: AppPersistence | null = null;

function createRegistry(disabledPlugins: string[] = []): PluginRegistry {
  const persistence = new AppPersistence(":memory:");
  const registry = new PluginRegistry(
    dataProvider,
    new TickerRepository(persistence.tickers),
    persistence,
  );
  registry.getConfigFn = () => ({
    ...createDefaultConfig("/tmp/gloomberb-context-menu-test"),
    disabledPlugins,
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

    expect(registry.getContextMenuItems({ kind: "app" }).map((item) => item.label)).toEqual(["Tools Item"]);

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

    expect(registry.getContextMenuItems({ kind: "app" }).map((item) => item.label)).toEqual([
      "A/A",
      "A/B",
      "Z",
    ]);
  });

  test("filters providers from disabled plugins", async () => {
    const registry = createRegistry(["disabled-tools"]);
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

    expect(registry.getContextMenuItems({ kind: "app" }).map((item) => item.label)).toEqual(["Visible"]);
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

    expect(registry.getContextMenuItems({ kind: "app" }).map((item) => item.label)).toEqual(["Works"]);
  });
});
