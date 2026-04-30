import { describe, expect, test } from "bun:test";
import { createDesktopBuiltinPlugins } from "./desktop-plugins";

describe("desktop builtin plugins", () => {
  test("includes broker manager after the IBKR broker adapter", () => {
    const pluginIds = createDesktopBuiltinPlugins(async () => []).map((plugin) => plugin.id);

    expect(pluginIds).toContain("ibkr");
    expect(pluginIds).toContain("broker-manager");
    expect(pluginIds.indexOf("ibkr")).toBeLessThan(pluginIds.indexOf("broker-manager"));
  });
});
