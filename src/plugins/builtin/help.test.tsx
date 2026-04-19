import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "../../renderers/opentui/test-utils";
import { PluginRenderProvider, type PluginRuntimeAccess } from "../plugin-runtime";
import { HelpPane } from "./help";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
});

describe("HelpPane", () => {
  test("opens the debug log from the mouse action", async () => {
    const calls: string[] = [];
    const runtime: PluginRuntimeAccess = {
      getDataProvider: () => null,
      pinTicker() {},
      navigateTicker() {},
      openCommandBar: (query?: string) => calls.push(`command:${query ?? ""}`),
      showWidget: (paneId: string) => calls.push(`widget:${paneId}`),
      hideWidget() {},
      openPluginCommandWorkflow() {},
      notify() {},
      subscribeResumeState: () => () => {},
      getResumeState: () => null,
      setResumeState() {},
      deleteResumeState() {},
      getConfigState: () => null,
      setConfigState: async () => {},
      deleteConfigState: async () => {},
      getConfigStateKeys: () => [],
    };

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
