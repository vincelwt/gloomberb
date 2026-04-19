import { afterEach, expect, test } from "bun:test";
import { DialogProvider } from "@opentui-ui/dialog/react";
import { testRender } from "../../renderers/opentui/test-utils";
import { AppContext, createInitialState } from "../../state/app-context";
import { cloneLayout, createDefaultConfig } from "../../types/config";
import type { PluginRegistry } from "../../plugins/registry";
import { Shell } from "./shell";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
});

test("renders the ascii logo in the pane background", async () => {
  const emptyLayout = {
    dockRoot: null,
    instances: [],
    floating: [],
    detached: [],
  };
  const config = createDefaultConfig("/tmp/gloomberb-shell-empty-state-test");
  config.layout = cloneLayout(emptyLayout);
  config.layouts = [{ name: "Default", layout: cloneLayout(emptyLayout) }];
  const state = createInitialState(config);
  const pluginRegistry = {
    panes: new Map(),
    paneTemplates: new Map(),
    commands: new Map(),
    tickerActions: new Map(),
    brokers: new Map(),
    allPlugins: new Map(),
    getPluginPaneIds: () => [],
    getPluginPaneTemplateIds: () => [],
    hasPaneSettings: () => false,
    openPaneSettingsFn: () => {},
    openCommandBarFn: () => {},
    updateLayoutFn: () => {},
    hideWidget: () => {},
  } as unknown as PluginRegistry;

  testSetup = await testRender(
    <AppContext value={{ state, dispatch: () => {} }}>
      <DialogProvider dialogOptions={{ style: { backgroundColor: "#000000", borderColor: "#ffffff", borderStyle: "single" } }}>
        <Shell pluginRegistry={pluginRegistry} />
      </DialogProvider>
    </AppContext>,
    { width: 120, height: 20 },
  );

  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();

  expect(frame).toContain("▌▄▖▐ ▞▀▖▞▀▖");
  expect(frame).toContain("Ctrl+P to get started.");
});
