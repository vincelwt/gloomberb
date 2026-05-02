import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "../../renderers/opentui/test-utils";
import { createTestPluginRuntime } from "../../test-support/plugin-runtime";
import { setSharedRegistryForTests } from "../registry";
import { PluginRenderProvider } from "../plugin-runtime";
import { HelpPane } from "./help";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
  setSharedRegistryForTests(undefined);
});

async function renderHelpPane(runtime = createTestPluginRuntime()) {
  testSetup = await testRender(
    <PluginRenderProvider pluginId="help" runtime={runtime}>
      <HelpPane
        paneId="help:main"
        paneType="help"
        focused
        width={88}
        height={36}
        close={() => {}}
      />
    </PluginRenderProvider>,
    { width: 88, height: 36 },
  );

  await testSetup.renderOnce();
  return testSetup;
}

function withoutScrollbar(line: string) {
  const scrollThumb = String.fromCharCode(0x2588);
  return (line.endsWith(scrollThumb) ? line.slice(0, -1) : line).trimEnd();
}

describe("HelpPane", () => {
  test("puts section spacing before headings instead of after them", async () => {
    await renderHelpPane();

    const lines = testSetup!.captureCharFrame().split("\n").map(withoutScrollbar);
    const commandBarRow = lines.findIndex((line) => line.includes("Command Bar"));
    const templatesRow = lines.findIndex((line) => line.includes("Window Templates"));

    expect(commandBarRow).toBeGreaterThan(0);
    expect(templatesRow).toBeGreaterThan(commandBarRow);
    expect(lines[commandBarRow - 1]?.trim()).toBe("");
    expect(lines[commandBarRow + 1]).toContain("Open or toggle the command bar");
    expect(lines[templatesRow - 1]?.trim()).toBe("");
    expect(lines[templatesRow + 1]?.trim()).not.toBe("");
  });

  test("lists core, plugin command, template, and keyboard shortcuts", async () => {
    setSharedRegistryForTests({
      commands: new Map([[
        "set-alert",
        {
          id: "set-alert",
          label: "Add Alert",
          description: "Create a price alert",
          keywords: [],
          category: "data",
          shortcut: "SA",
          shortcutArg: { placeholder: "symbol condition price" },
          execute: () => {},
        },
      ]]),
      paneTemplates: new Map([[
        "quote",
        {
          id: "quote",
          paneId: "ticker-detail",
          label: "Quote Monitor",
          description: "Open ticker detail",
          shortcut: { prefix: "QQ", argPlaceholder: "ticker" },
        },
      ]]),
      shortcuts: new Map([[
        "toggle-chat",
        {
          id: "toggle-chat",
          key: "c",
          shift: true,
          description: "Toggle chat",
          execute: () => {},
        },
      ]]),
      allPlugins: new Map([
        ["alerts", { name: "Alerts" }],
        ["ticker-detail", { name: "Ticker Detail" }],
        ["gloomberb-cloud", { name: "Gloomberb Cloud" }],
      ]),
      getConfigFn: () => ({ disabledPlugins: [] }),
      getCommandPluginId: () => "alerts",
      getPaneTemplatePluginId: () => "ticker-detail",
      getShortcutPluginId: () => "gloomberb-cloud",
    } as any);

    await renderHelpPane();

    const frame = testSetup!.captureCharFrame();
    expect(frame).toMatch(/AW\s+<ticker>/);
    expect(frame).toMatch(/SA\s+<symbol condition price>/);
    expect(frame).toMatch(/QQ\s+<ticker>/);
    expect(frame).toContain("Add Alert (Alerts)");
    expect(frame).toContain("Shift+C");
    expect(frame).toContain("Toggle chat (Gloomberb Cloud)");
    expect(frame).not.toContain("Cmd/Ctrl");
    expect(frame).not.toContain("CmdOrCtrl");
  });

  test("opens the debug log from the mouse action", async () => {
    const calls: string[] = [];
    const runtime = createTestPluginRuntime({
      openCommandBar: (query?: string) => calls.push(`command:${query ?? ""}`),
      showWidget: (paneId: string) => calls.push(`widget:${paneId}`),
    });

    await renderHelpPane(runtime);

    const lines = testSetup.captureCharFrame().split("\n");
    const row = lines.findIndex((line) => line.includes("Open Debug Log"));
    const col = lines[row]?.indexOf("Open Debug Log") ?? -1;

    expect(row).toBeGreaterThanOrEqual(0);
    expect(col).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(col + 1, row);
      await testSetup!.renderOnce();
    });

    expect(calls).toEqual(["widget:debug"]);
  });
});
