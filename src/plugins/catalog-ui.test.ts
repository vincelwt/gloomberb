import { describe, expect, test } from "bun:test";
import { getRendererBuiltinPlugins } from "./catalog-ui";

describe("renderer builtin plugins", () => {
  test("includes broker manager after the IBKR broker adapter", () => {
    const pluginIds = getRendererBuiltinPlugins().map((plugin) => plugin.id);

    expect(pluginIds).toContain("ibkr");
    expect(pluginIds).toContain("broker-manager");
    expect(pluginIds.indexOf("ibkr")).toBeLessThan(pluginIds.indexOf("broker-manager"));
  });
});
