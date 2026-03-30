import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { HelpPane } from "./help";
import { setSharedRegistryForTests } from "../registry";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
  setSharedRegistryForTests(undefined);
});

describe("HelpPane", () => {
  test("renders shortcut, layout, and bug-report guidance", async () => {
    setSharedRegistryForTests({
      paneTemplates: new Map([
        ["quote-monitor-pane", {
          id: "quote-monitor-pane",
          paneId: "quote-monitor",
          label: "Quote Monitor",
          description: "Open a compact quote monitor",
          shortcut: { prefix: "QQ", argPlaceholder: "ticker" },
        }],
        ["notes-pane", {
          id: "notes-pane",
          paneId: "notes",
          label: "Quick Notes",
          description: "Open a notes window",
          shortcut: { prefix: "NOTE" },
        }],
      ]),
      allPlugins: new Map([
        ["ticker-detail", { id: "ticker-detail", name: "Ticker Detail" }],
        ["notes", { id: "notes", name: "Notes" }],
      ]),
      getPaneTemplatePluginId: (templateId: string) => (
        templateId === "quote-monitor-pane" ? "ticker-detail" : "notes"
      ),
      getConfigFn: () => ({ disabledPlugins: [] }),
    } as any);

    testSetup = await testRender(
      <HelpPane
        paneId="help:main"
        paneType="help"
        focused
        width={88}
        height={36}
        close={() => {}}
      />,
      { width: 88, height: 36 },
    );

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("How To Use Gloomberb");
    expect(frame).toContain("Window Templates");
    expect(frame).toContain("QQ");
    expect(frame).toContain("Quote Monitor");
    expect(frame).toContain("Layout System");
    expect(frame).toContain("Ctrl+W");
    expect(frame).toContain("Open Debug Log");
  });

  test("opens the debug log from the mouse action", async () => {
    const calls: string[] = [];
    let closed = 0;

    setSharedRegistryForTests({
      showWidget: (paneId: string) => calls.push(`widget:${paneId}`),
      openCommandBarFn: (query?: string) => calls.push(`command:${query ?? ""}`),
    } as any);

    testSetup = await testRender(
      <HelpPane
        paneId="help:main"
        paneType="help"
        focused
        width={88}
        height={36}
        close={() => {
          closed += 1;
        }}
      />,
      { width: 88, height: 36 },
    );

    await testSetup.renderOnce();

    const lines = testSetup.captureCharFrame().split("\n");
    const row = lines.findIndex((line) => line.includes("Open Debug Log"));
    const col = lines[row]?.indexOf("Open Debug Log") ?? -1;

    expect(row).toBeGreaterThanOrEqual(0);
    expect(col).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(col + 1, row);
      await testSetup!.renderOnce();
    });

    expect(closed).toBe(1);
    expect(calls).toEqual(["widget:debug"]);
  });
});
