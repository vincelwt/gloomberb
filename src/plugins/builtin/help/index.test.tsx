import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "../../../renderers/opentui/test-utils";
import { createTestPluginRuntime } from "../../../test-support/plugin-runtime";
import { setSharedRegistryForTests } from "../../registry";
import { PluginRenderProvider } from "../../runtime";
import { HelpPane } from ".";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
  setSharedRegistryForTests(undefined);
});

async function renderHelpPane(
  runtime = createTestPluginRuntime(),
  size = { width: 88, height: 36 },
) {
  testSetup = await testRender(
    <PluginRenderProvider pluginId="help" runtime={runtime}>
      <HelpPane
        paneId="help:main"
        paneType="help"
        focused
        width={size.width}
        height={size.height}
        close={() => {}}
      />
    </PluginRenderProvider>,
    size,
  );

  await testSetup.renderOnce();
  await testSetup.renderOnce();
  return testSetup;
}

async function moveHelpTabRight(count = 1) {
  await act(async () => {
    for (let index = 0; index < count; index += 1) {
      testSetup!.mockInput.pressArrow("right");
    }
    await testSetup!.renderOnce();
    await testSetup!.renderOnce();
  });
}

async function resetRenderedHelpPane(
  runtime = createTestPluginRuntime(),
  size = { width: 88, height: 36 },
) {
  if (testSetup) {
    act(() => {
      testSetup!.renderer.destroy();
    });
    testSetup = undefined;
  }
  return renderHelpPane(runtime, size);
}

function withoutScrollbar(line: string) {
  const scrollThumb = String.fromCharCode(0x2588);
  return (line.endsWith(scrollThumb) ? line.slice(0, -1) : line).trimEnd();
}

describe("HelpPane", () => {
  test("starts on basics and puts section spacing before headings instead of after them", async () => {
    await renderHelpPane(createTestPluginRuntime(), { width: 88, height: 80 });

    const lines = testSetup!.captureCharFrame().split("\n").map(withoutScrollbar);
    const commandBarRow = lines.findIndex((line) => line.includes("Command Bar"));
    const layoutRow = lines.findIndex((line) => line.includes("Layout Basics"));

    expect(lines[0]).toContain("Basics");
    expect(testSetup!.captureCharFrame()).toContain("Basics");
    expect(testSetup!.captureCharFrame()).toContain("Functions");
    expect(testSetup!.captureCharFrame()).toContain("Issues");
    expect(testSetup!.captureCharFrame()).not.toContain("Issues/Debug");
    expect(testSetup!.captureCharFrame()).not.toContain("Window Templates");
    expect(testSetup!.captureCharFrame()).not.toContain("Search for a ticker or open the best matching security.");
    expect(commandBarRow).toBeGreaterThan(0);
    expect(layoutRow).toBeGreaterThan(commandBarRow);
    expect(lines[commandBarRow - 1]?.trim()).toBe("");
    expect(lines[commandBarRow + 1]).toContain("Open command mode");
    expect(testSetup!.captureCharFrame()).toContain("Open ticker search directly.");
    expect(testSetup!.captureCharFrame()).toContain("DES");
    expect(testSetup!.captureCharFrame()).toContain("Clear command text.");
    expect(testSetup!.captureCharFrame()).toContain("Delete the previous word");
    expect(testSetup!.captureCharFrame()).toContain("Submit multiline command forms.");
    expect(testSetup!.captureCharFrame()).toContain("close all floating panes");
    expect(lines[layoutRow - 1]?.trim()).toBe("");
    expect(lines[layoutRow + 1]?.trim()).not.toBe("");
  });

  test("separates functions from keyboard shortcuts", async () => {
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
          shortcut: { prefix: "QQ", argPlaceholder: "tickers", argKind: "ticker-list" },
        },
      ]]),
      shortcuts: new Map([[
        "sync-data",
        {
          id: "sync-data",
          key: "x",
          shift: true,
          description: "Sync data",
          execute: () => {},
        },
      ]]),
      allPlugins: new Map([
        ["alerts", { name: "Alerts" }],
        ["ticker-research", { name: "Ticker Research" }],
        ["gloomberb-cloud", { name: "Gloom Cloud" }],
      ]),
      getConfigFn: () => ({ disabledPlugins: [] }),
      getCommandPluginId: () => "alerts",
      getPaneTemplatePluginId: () => "ticker-research",
      getShortcutPluginId: () => "gloomberb-cloud",
    } as any);

    await renderHelpPane(createTestPluginRuntime(), { width: 88, height: 80 });
    await moveHelpTabRight();

    const functionsFrame = testSetup!.captureCharFrame();
    expect(functionsFrame).toContain("Manage Plugins");
    expect(functionsFrame).toMatch(/AW\s+<ticker>/);
    expect(functionsFrame).toMatch(/SA\s+<symbol condition price>/);
    expect(functionsFrame).toMatch(/QQ\s+<tickers>/);
    expect(functionsFrame).toContain("Alerts");
    expect(functionsFrame).toContain("Add Alert");
    expect(functionsFrame).toContain("Shift+X");
    expect(functionsFrame).toContain("Gloom Cloud");
    expect(functionsFrame).toContain("Sync data");
    expect(functionsFrame).toContain("Ticker Research");
    expect(functionsFrame).toContain("Quote Monitor");
    expect(functionsFrame).not.toContain("Add Alert (Alerts)");
    expect(functionsFrame).not.toContain("Sync data (Gloom Cloud)");
    expect(functionsFrame).not.toContain("Quote Monitor (Ticker Research)");
    expect(functionsFrame).not.toContain("Ctrl+W");

    await resetRenderedHelpPane(createTestPluginRuntime(), { width: 88, height: 80 });
    await moveHelpTabRight(2);

    const shortcutsFrame = testSetup!.captureCharFrame();
    expect(shortcutsFrame).toContain("Ctrl+W");
    expect(shortcutsFrame).toContain("Ctrl+Alt+W");
    expect(shortcutsFrame).toContain("Ctrl+Shift+M");
    expect(shortcutsFrame).toContain("Ctrl+Shift+R");
    expect(shortcutsFrame).toContain("Ctrl+,");
    expect(shortcutsFrame).toContain("Navigation");
    expect(shortcutsFrame).toContain("Up/Down");
    expect(shortcutsFrame).toContain("j/k");
    expect(shortcutsFrame).toContain("Left/Right");
    expect(shortcutsFrame).toContain("h/l");
    expect(shortcutsFrame).toContain("PageUp/PageDown");
    expect(shortcutsFrame).toContain("Window Mode");
    expect(shortcutsFrame).toContain("h/j/k/l");
    expect(shortcutsFrame).toContain("Close all floating panes.");
    expect(shortcutsFrame).not.toContain("AW");
    expect(shortcutsFrame).not.toContain("Ctrl+Shift+O");
    expect(shortcutsFrame).not.toContain("Pop the focused pane");
    expect(shortcutsFrame).not.toContain("Cmd+W");
    expect(shortcutsFrame).not.toContain("Cmd+,");
    expect(shortcutsFrame).not.toContain("Cmd+K");
    expect(shortcutsFrame).not.toContain("Cmd/Ctrl");
    expect(shortcutsFrame).not.toContain("CmdOrCtrl");
    expect(shortcutsFrame).not.toContain("Open ticker actions for the focused ticker.");
  });

  test("keeps shortcuts and descriptions on the same row when narrow", async () => {
    await renderHelpPane(createTestPluginRuntime(), { width: 70, height: 80 });

    const lines = testSetup!.captureCharFrame().split("\n").map(withoutScrollbar);
    const closeCommandRow = lines.findIndex((line) => line.includes("Close the command bar."));

    expect(closeCommandRow).toBeGreaterThanOrEqual(0);
    expect(lines[closeCommandRow]).toContain("Esc");
    expect(lines[closeCommandRow]).toContain("`");

    await moveHelpTabRight();

    const functionLines = testSetup!.captureCharFrame().split("\n").map(withoutScrollbar);
    const securityDetailsRow = functionLines.findIndex((line) => line.includes("Open security details"));
    expect(securityDetailsRow).toBeGreaterThanOrEqual(0);
    expect(functionLines[securityDetailsRow]).toContain("DES");
    expect(functionLines[securityDetailsRow]).toContain("<ticker>");
  });

  test("opens the debug log from the mouse action", async () => {
    const calls: string[] = [];
    const runtime = createTestPluginRuntime({
      openCommandBar: (query?: string) => calls.push(`command:${query ?? ""}`),
      showPane: (paneId: string) => calls.push(`pane:${paneId}`),
    });

    await renderHelpPane(runtime);
    await moveHelpTabRight(3);

    const frame = testSetup!.captureCharFrame();
    expect(frame).toContain("GitHub Issues");
    expect(frame).not.toContain("Issues/Debug");
    expect(frame).not.toContain("plugin,\n");

    const lines = frame.split("\n");
    const row = lines.findIndex((line) => line.includes("Open Debug Log"));
    const col = lines[row]?.indexOf("Open Debug Log") ?? -1;

    expect(row).toBeGreaterThanOrEqual(0);
    expect(col).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(col + 1, row);
      await testSetup!.renderOnce();
    });

    expect(calls).toEqual(["pane:debug"]);
  });
});
