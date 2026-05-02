import { describe, expect, test } from "bun:test";
import { getRendererBuiltinPlugins } from "./catalog-ui";

describe("renderer builtin plugins", () => {
  test("includes broker manager after the IBKR broker adapter", () => {
    const pluginIds = getRendererBuiltinPlugins().map((plugin) => plugin.id);

    expect(pluginIds).toContain("ibkr");
    expect(pluginIds).toContain("broker-manager");
    expect(pluginIds.indexOf("ibkr")).toBeLessThan(pluginIds.indexOf("broker-manager"));
  });

  test("groups related built-in panes into domain plugins", () => {
    const pluginIds = getRendererBuiltinPlugins().map((plugin) => plugin.id);

    expect(pluginIds).toContain("company-research");
    expect(pluginIds).toContain("market-overview");
    expect(pluginIds).toContain("macro");
    expect(pluginIds).not.toContain("options");
    expect(pluginIds).not.toContain("sec");
    expect(pluginIds).not.toContain("world-indices");
    expect(pluginIds).not.toContain("earnings-calendar");
  });
});
