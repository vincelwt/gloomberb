import { afterEach, describe, expect, test } from "bun:test";
import { TestDialogProvider, testRender } from "../../../renderers/opentui/test-utils";
import { openTuiUiHost } from "../../../renderers/opentui/ui-host";
import type { ReactNode } from "react";
import { act, useReducer } from "react";
import { AppContext, appReducer, createInitialState } from "../../../state/app/context";
import { cloneLayout, createDefaultConfig, type LayoutConfig } from "../../../types/config";
import type { PluginRegistry } from "../../../plugins/registry";
import type { PaneProps } from "../../../types/plugin";
import { Header } from "../header";
import {
  buildNativeWindowState,
  resolvePaneManagementShortcut,
  resolveAppHeaderHeightCells,
  Shell,
} from "./index";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
});

function createShellPluginRegistry(options?: {
  portfolioListComponent?: (props: PaneProps) => ReactNode;
  tickerDetailComponent?: (props: PaneProps) => ReactNode;
}): PluginRegistry {
  return {
    panes: new Map([
      ["portfolio-list", {
        id: "portfolio-list",
        name: "Portfolio List",
        component: options?.portfolioListComponent ?? (() => <text>Portfolio Body</text>),
        defaultPosition: "left",
      }],
      ["ticker-detail", {
        id: "ticker-detail",
        name: "Ticker Research",
        component: options?.tickerDetailComponent ?? (() => <text>Ticker Research Body</text>),
        defaultPosition: "right",
        defaultMode: "floating",
      }],
    ]),
    paneTemplates: new Map(),
    commands: new Map(),
    tickerActions: new Map(),
    brokers: new Map(),
    allPlugins: new Map(),
    getPluginPaneIds: () => [],
    getPluginPaneTemplateIds: () => [],
    hasPaneSettings: (paneId: string) => paneId === "portfolio-list:main",
    openPaneSettingsFn: () => {},
    openCommandBar: () => {},
    openWindowMode: () => {},
    openWindowModeFn: () => {},
    updateLayoutFn: () => {},
    hidePane: () => {},
  } as unknown as PluginRegistry;
}

async function emitKeypress(event: { name?: string; sequence?: string; ctrl?: boolean; meta?: boolean; shift?: boolean }) {
  await act(async () => {
    const keyEvent = {
      ctrl: false,
      meta: false,
      option: false,
      shift: false,
      eventType: "press",
      repeated: false,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.propagationStopped = true;
      },
      ...event,
    };
    testSetup!.renderer.keyInput.emit("keypress", keyEvent as any);
    await testSetup!.renderOnce();
    await testSetup!.renderOnce();
  });
}

type ShellTestAction = { type: string; [key: string]: any };

function requireLayoutInstance(config: ReturnType<typeof createDefaultConfig>, instanceId: string) {
  const instance = config.layout.instances.find((entry) => entry.instanceId === instanceId);
  if (!instance) throw new Error(`missing default pane ${instanceId}`);
  return instance;
}

function createShellStateWithLayout(
  config: ReturnType<typeof createDefaultConfig>,
  layout: LayoutConfig,
  focusedPaneId: string | null,
) {
  return {
    ...createInitialState({
      ...config,
      layout,
      layouts: [{ name: "Default", layout: cloneLayout(layout) }],
    }),
    focusedPaneId,
  };
}

async function renderShellForWindowModeTest(
  state: ReturnType<typeof createInitialState>,
  options: {
    registry?: PluginRegistry;
    width?: number;
    height?: number;
    dispatch?: (action: ShellTestAction) => void;
  } = {},
) {
  const actions: ShellTestAction[] = [];
  const registry = options.registry ?? createShellPluginRegistry();
  testSetup = await testRender(
    <AppContext value={{ state, dispatch: options.dispatch ?? ((action) => actions.push(action)) }}>
      <TestDialogProvider>
        <Shell pluginRegistry={registry} />
      </TestDialogProvider>
    </AppContext>,
    { width: options.width ?? 80, height: options.height ?? 24 },
  );
  await testSetup.renderOnce();
  return { actions, registry };
}

function findUpdateLayout(actions: ShellTestAction[]) {
  return actions.find((action) => action.type === "UPDATE_LAYOUT");
}

function HeaderHarness({
  updateAvailable = null,
  updateProgress = null,
  updateCheckInProgress = false,
  updateNotice = null,
}: {
  updateAvailable?: ReturnType<typeof createInitialState>["updateAvailable"];
  updateProgress?: ReturnType<typeof createInitialState>["updateProgress"];
  updateCheckInProgress?: boolean;
  updateNotice?: string | null;
}) {
  const initialState = createInitialState(createDefaultConfig("/tmp/gloomberb-header-test"));
  initialState.updateAvailable = updateAvailable;
  initialState.updateProgress = updateProgress;
  initialState.updateCheckInProgress = updateCheckInProgress;
  initialState.updateNotice = updateNotice;
  const [state, dispatch] = useReducer(appReducer, initialState);

  return (
    <AppContext value={{ state, dispatch }}>
      <Header />
    </AppContext>
  );
}

describe("Header", () => {
  test("shows automatic self-update status for standalone binaries", async () => {
    testSetup = await testRender(
      <HeaderHarness updateAvailable={{
        version: "0.3.0",
        tagName: "v0.3.0",
        downloadUrl: "https://example.com/gloomberb",
        publishedAt: "2026-04-01T00:00:00.000Z",
        updateAction: { kind: "self" },
      }} />,
      { width: 120, height: 2 },
    );

    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    expect(frame).toContain("v0.3.0 available");
    expect(frame).toContain("starting download");
    expect(frame).not.toContain("press u to update");
  });

  test("shows the manual npm command when self-update is disabled", async () => {
    testSetup = await testRender(
      <HeaderHarness updateAvailable={{
        version: "0.3.0",
        tagName: "v0.3.0",
        downloadUrl: "https://example.com/gloomberb",
        publishedAt: "2026-04-01T00:00:00.000Z",
        updateAction: { kind: "manual", command: "npm install -g gloomberb@latest" },
      }} />,
      { width: 120, height: 2 },
    );

    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    expect(frame).toContain("v0.3.0 available");
    expect(frame).toContain("run npm install -g gloomberb@latest");
    expect(frame).not.toContain("press u to update");
  });

  test("shows update download progress and notices", async () => {
    testSetup = await testRender(
      <HeaderHarness
        updateAvailable={{
          version: "0.3.0",
          tagName: "v0.3.0",
          downloadUrl: "https://example.com/gloomberb",
          publishedAt: "2026-04-01T00:00:00.000Z",
          updateAction: { kind: "self" },
        }}
        updateProgress={{ phase: "downloading", percent: 42 }}
      />,
      { width: 120, height: 2 },
    );

    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain("Downloading v0.3.0: 42%");

    testSetup.renderer.destroy();

    testSetup = await testRender(
      <HeaderHarness updateCheckInProgress />,
      { width: 120, height: 2 },
    );

    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain("Checking for updates...");

    testSetup.renderer.destroy();

    testSetup = await testRender(
      <HeaderHarness updateNotice="Already on v0.3.1" />,
      { width: 120, height: 2 },
    );

    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain("Already on v0.3.1");
  });
});

describe("Shell", () => {
  test("uses the desktop titlebar overlay height for shell chrome math", () => {
    expect(resolveAppHeaderHeightCells({ titleBarOverlay: true, cellHeightPx: 18 })).toBe(28 / 18);
    expect(resolveAppHeaderHeightCells({ titleBarOverlay: false, cellHeightPx: 18 })).toBe(1);
  });

  test("keeps command bar native occlusion scoped to the panel", () => {
    const state = buildNativeWindowState(
      ["portfolio-list:main"],
      [],
      null,
      { open: false, width: 120, contentHeight: 40 },
      [
        {
          id: "command-bar:panel",
          rect: { x: 24, y: 8, width: 72, height: 14 },
          zIndex: Number.MAX_SAFE_INTEGER,
        },
      ],
    );

    expect(state.occluders).toEqual([
      {
        id: "command-bar:panel",
        paneId: null,
        rect: { x: 24, y: 9, width: 72, height: 14 },
        zIndex: Number.MAX_SAFE_INTEGER,
      },
    ]);
    expect(state.occluders.some((occluder) => occluder.id === "overlay:global")).toBe(false);
  });

  test("opens the pane menu when clicking the docked header action area", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-shell-test");
    const mainPane = config.layout.instances.find((instance) => instance.instanceId === "portfolio-list:main");
    if (!mainPane) throw new Error("missing default portfolio pane");

    const singlePaneLayout = {
      dockRoot: { kind: "pane" as const, instanceId: "portfolio-list:main" },
      instances: [{ ...mainPane }],
      floating: [],
    };
    const nextConfig = {
      ...config,
      layout: cloneLayout(singlePaneLayout),
      layouts: [{ name: "Default", layout: cloneLayout(singlePaneLayout) }],
    };
    const state = createInitialState(nextConfig);
    const pluginRegistry = createShellPluginRegistry();

    testSetup = await testRender(
      <AppContext value={{ state, dispatch: () => {} }}>
        <TestDialogProvider>
          <Shell pluginRegistry={pluginRegistry} />
        </TestDialogProvider>
      </AppContext>,
      { width: 40, height: 10 },
    );

    await testSetup.renderOnce();
    const actionCol = testSetup.captureCharFrame().split("\n")[0]?.indexOf("...");
    expect(actionCol).toBeGreaterThanOrEqual(0);
    await act(async () => {
      await testSetup!.mockMouse.click(actionCol! + 1, 1);
    });
    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Settings");
    expect(frame).toContain("Ctrl+,");
    expect(frame).not.toContain("CmdOrCtrl");
  });

  test("shows a Pop Out action in the pane menu when a desktop bridge is available", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-shell-test");
    const mainPane = config.layout.instances.find((instance) => instance.instanceId === "portfolio-list:main");
    if (!mainPane) throw new Error("missing default portfolio pane");

    const singlePaneLayout = {
      dockRoot: { kind: "pane" as const, instanceId: "portfolio-list:main" },
      instances: [{ ...mainPane }],
      floating: [],
      detached: [],
    };
    const nextConfig = {
      ...config,
      layout: cloneLayout(singlePaneLayout),
      layouts: [{ name: "Default", layout: cloneLayout(singlePaneLayout) }],
    };
    const state = createInitialState(nextConfig);
    const pluginRegistry = createShellPluginRegistry();

    testSetup = await testRender(
      <AppContext value={{ state, dispatch: () => {} }}>
        <TestDialogProvider>
          <Shell
            pluginRegistry={pluginRegistry}
            desktopWindowBridge={{
              kind: "main",
              popOutPane: async () => {},
              subscribeState: () => () => {},
              subscribeDockPreview: () => () => {},
            }}
          />
        </TestDialogProvider>
      </AppContext>,
      { width: 40, height: 10 },
    );

    await testSetup.renderOnce();
    const floatingActionCol = testSetup.captureCharFrame().split("\n")[0]?.indexOf("...");
    expect(floatingActionCol).toBeGreaterThanOrEqual(0);
    await act(async () => {
      await testSetup!.mockMouse.click(floatingActionCol! + 1, 1);
    });
    await testSetup.renderOnce();

    expect(testSetup.captureCharFrame()).toContain("Pop Out");
  });

  test("shows the pane menu above a high z-index floating pane", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-shell-test");
    const detailPane = config.layout.instances.find((instance) => instance.instanceId === "ticker-detail:main");
    if (!detailPane) throw new Error("missing default Ticker Research pane");

    const floatingOnlyLayout = {
      dockRoot: null,
      instances: [{ ...detailPane }],
      floating: [{ instanceId: "ticker-detail:main", x: 0, y: 0, width: 40, height: 8, zIndex: 195 }],
    };
    const nextConfig = {
      ...config,
      layout: cloneLayout(floatingOnlyLayout),
      layouts: [{ name: "Default", layout: cloneLayout(floatingOnlyLayout) }],
    };
    const state = {
      ...createInitialState(nextConfig),
      focusedPaneId: "ticker-detail:main",
    };
    const pluginRegistry = createShellPluginRegistry();

    testSetup = await testRender(
      <AppContext value={{ state, dispatch: () => {} }}>
        <TestDialogProvider>
          <Shell pluginRegistry={pluginRegistry} />
        </TestDialogProvider>
      </AppContext>,
      { width: 40, height: 10 },
    );

    await testSetup.renderOnce();
    const highZActionCol = testSetup.captureCharFrame().split("\n")[0]?.indexOf("...");
    expect(highZActionCol).toBeGreaterThanOrEqual(0);
    await act(async () => {
      await testSetup!.mockMouse.click(highZActionCol! + 1, 1);
    });
    await testSetup.renderOnce();

    expect(testSetup.captureCharFrame()).toContain("Dock Pane");
  });

  test("resolves pane management shortcuts", () => {
    const base = { ctrl: false, meta: true, super: true, shift: true, alt: false };
    expect(resolvePaneManagementShortcut({ ...base, name: ",", key: ",", shift: false })).toBe("settings");
    expect(resolvePaneManagementShortcut({ ...base, name: "w", key: "w", ctrl: true, meta: false, super: false, shift: false })).toBe("close");
    expect(resolvePaneManagementShortcut({ ...base, name: "D", key: "D" })).toBe("toggle-floating");
    expect(resolvePaneManagementShortcut({ ...base, name: "o", key: "o" })).toBe("pop-out");
    expect(resolvePaneManagementShortcut({ ...base, name: "c", key: "c" })).toBe("copy-screenshot");
    expect(resolvePaneManagementShortcut({ ...base, name: "l", key: "l" })).toBe("layout-actions");
    expect(resolvePaneManagementShortcut({ ...base, name: "g", key: "g" })).toBe("gridlock-all");
    expect(resolvePaneManagementShortcut({ ...base, name: "m", key: "m" })).toBe("window-mode");
    expect(resolvePaneManagementShortcut({ ...base, name: "n", key: "n" })).toBeNull();
    expect(resolvePaneManagementShortcut({ ...base, name: "d", key: "d", alt: true })).toBeNull();
    expect(resolvePaneManagementShortcut({ ...base, name: "d", key: "d", meta: false, super: false })).toBeNull();
  });

  test("moves a floating pane in window mode and commits once", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-shell-window-mode-test");
    const floatingLayout = cloneLayout(config.layout);
    floatingLayout.dockRoot = { kind: "pane", instanceId: "portfolio-list:main" };
    floatingLayout.floating = [{ instanceId: "ticker-detail:main", x: 8, y: 2, width: 32, height: 10, zIndex: 75 }];
    const { actions } = await renderShellForWindowModeTest(
      createShellStateWithLayout(config, floatingLayout, "ticker-detail:main"),
    );

    await emitKeypress({ name: "m", ctrl: true, shift: true });
    await emitKeypress({ name: "right" });
    await emitKeypress({ name: "right" });
    await emitKeypress({ name: "enter" });
    await act(async () => {
      await testSetup!.renderOnce();
    });

    expect(testSetup.captureCharFrame()).toContain("Committed");
    const updateLayout = findUpdateLayout(actions);
    expect(actions.filter((action) => action.type === "PUSH_LAYOUT_HISTORY")).toHaveLength(1);
    expect(updateLayout?.layout.floating.find((entry: any) => entry.instanceId === "ticker-detail:main")).toEqual(expect.objectContaining({
      x: 12,
      y: 2,
    }));
  });

  test("returns to window selection after commit for editing another window", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-shell-window-mode-repeat-test");
    const floatingLayout = cloneLayout(config.layout);
    floatingLayout.dockRoot = null;
    floatingLayout.floating = [
      { instanceId: "portfolio-list:main", x: 2, y: 1, width: 32, height: 10, zIndex: 50 },
      { instanceId: "ticker-detail:main", x: 8, y: 2, width: 32, height: 10, zIndex: 75 },
    ];
    const { actions } = await renderShellForWindowModeTest(
      createShellStateWithLayout(config, floatingLayout, "ticker-detail:main"),
    );

    await emitKeypress({ name: "m", ctrl: true, shift: true });
    await emitKeypress({ name: "right" });
    await emitKeypress({ name: "enter" });

    expect(testSetup.captureCharFrame()).toContain("WINDOW MOVE");

    await emitKeypress({ name: "tab" });
    await emitKeypress({ name: "right" });
    await emitKeypress({ name: "enter" });

    const updates = actions.filter((action) => action.type === "UPDATE_LAYOUT");
    expect(updates).toHaveLength(2);
    expect(updates[0]?.layout.floating.find((entry: any) => entry.instanceId === "ticker-detail:main")).toEqual(expect.objectContaining({
      x: 10,
      y: 2,
    }));
    expect(updates[1]?.layout.floating.find((entry: any) => entry.instanceId === "ticker-detail:main")).toEqual(expect.objectContaining({
      x: 10,
      y: 2,
    }));
    expect(updates[1]?.layout.floating.find((entry: any) => entry.instanceId === "portfolio-list:main")).toEqual(expect.objectContaining({
      x: 4,
      y: 1,
    }));
    const movedPortfolio = updates[1]?.layout.floating.find((entry: any) => entry.instanceId === "portfolio-list:main");
    const movedTicker = updates[1]?.layout.floating.find((entry: any) => entry.instanceId === "ticker-detail:main");
    expect(movedPortfolio?.zIndex).toBeGreaterThan(movedTicker?.zIndex ?? 0);
  });

  test("cycles windows with Tab while staying in window move mode", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-shell-window-mode-cycle-test");
    const floatingLayout = cloneLayout(config.layout);
    floatingLayout.dockRoot = { kind: "pane", instanceId: "portfolio-list:main" };
    floatingLayout.floating = [{ instanceId: "ticker-detail:main", x: 8, y: 2, width: 32, height: 10, zIndex: 75 }];
    const { actions } = await renderShellForWindowModeTest(
      createShellStateWithLayout(config, floatingLayout, "portfolio-list:main"),
    );

    await emitKeypress({ name: "m", ctrl: true, shift: true });
    await emitKeypress({ name: "tab" });
    await emitKeypress({ name: "right" });
    await emitKeypress({ name: "enter" });

    const updateLayout = findUpdateLayout(actions);
    expect(updateLayout?.layout.floating.find((entry: any) => entry.instanceId === "ticker-detail:main")).toEqual(expect.objectContaining({
      x: 10,
      y: 2,
    }));
  });

  test("toggles the selected window between docked and floating in window move mode", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-shell-window-mode-dock-toggle-test");
    const mainPane = requireLayoutInstance(config, "portfolio-list:main");
    const dockedLayout = {
      dockRoot: { kind: "pane" as const, instanceId: "portfolio-list:main" },
      instances: [{ ...mainPane }],
      floating: [],
    };
    const { actions } = await renderShellForWindowModeTest(
      createShellStateWithLayout(config, dockedLayout, "portfolio-list:main"),
    );

    await emitKeypress({ name: "m", ctrl: true, shift: true });
    expect(testSetup.captureCharFrame()).toContain("d dock/float");

    await emitKeypress({ name: "d" });
    await emitKeypress({ name: "enter" });
    await emitKeypress({ name: "d" });
    await emitKeypress({ name: "enter" });

    const updates = actions.filter((action) => action.type === "UPDATE_LAYOUT");
    expect(updates).toHaveLength(2);
    expect(updates[0]?.layout.floating.some((entry: any) => entry.instanceId === "portfolio-list:main")).toBe(true);
    expect(updates[1]?.layout.floating.some((entry: any) => entry.instanceId === "portfolio-list:main")).toBe(false);
    expect(updates[1]?.layout.dockRoot).toEqual({ kind: "pane", instanceId: "portfolio-list:main" });
  });

  test("previews a directional docked window move before committing it", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-shell-window-mode-docked-move-test");
    const mainPane = requireLayoutInstance(config, "portfolio-list:main");
    const detailPane = requireLayoutInstance(config, "ticker-detail:main");
    const dockedLayout = {
      dockRoot: {
        kind: "split" as const,
        axis: "horizontal" as const,
        ratio: 0.5,
        first: { kind: "pane" as const, instanceId: "portfolio-list:main" },
        second: { kind: "pane" as const, instanceId: "ticker-detail:main" },
      },
      instances: [{ ...mainPane }, { ...detailPane, binding: { kind: "fixed" as const, symbol: "MSFT" } }],
      floating: [],
      detached: [],
    };
    const { actions } = await renderShellForWindowModeTest(
      createShellStateWithLayout(config, dockedLayout, "portfolio-list:main"),
    );

    await emitKeypress({ name: "m", ctrl: true, shift: true });
    await emitKeypress({ name: "right" });
    await testSetup.renderOnce();

    expect(actions.some((action) => action.type === "UPDATE_LAYOUT")).toBe(false);
    expect(testSetup.captureCharFrame()).toContain("-> MSFT right");

    await emitKeypress({ name: "enter" });

    const updateLayout = findUpdateLayout(actions);
    const root = updateLayout?.layout.dockRoot;
    expect(root).toEqual(expect.objectContaining({
      kind: "split",
      axis: "horizontal",
    }));
    expect(root?.first).toEqual({ kind: "pane", instanceId: "ticker-detail:main" });
    expect(root?.second).toEqual({ kind: "pane", instanceId: "portfolio-list:main" });
  });

  test("shows desktop window mode status and selected window title", async () => {
    const previousCapabilities = openTuiUiHost.capabilities;
    openTuiUiHost.capabilities = {
      ...previousCapabilities,
      nativePaneChrome: true,
      titleBarOverlay: false,
      precisePointer: true,
      cellWidthPx: 8,
      cellHeightPx: 18,
    };

    try {
      const config = createDefaultConfig("/tmp/gloomberb-shell-native-window-mode-test");
      const desktopLayout = cloneLayout(config.layout);
      desktopLayout.dockRoot = {
        kind: "split",
        direction: "horizontal",
        ratio: 0.5,
        first: { kind: "pane", instanceId: "portfolio-list:main" },
        second: { kind: "pane", instanceId: "ticker-detail:main" },
      };
      desktopLayout.floating = [];
      const registry = createShellPluginRegistry();
      await renderShellForWindowModeTest(
        createShellStateWithLayout(config, desktopLayout, null),
        { registry, width: 100, height: 26, dispatch: () => {} },
      );

      await act(async () => {
        registry.openWindowModeFn("portfolio-list:main", "move");
        await testSetup!.renderOnce();
        await testSetup!.renderOnce();
      });

      const frame = testSetup.captureCharFrame();
      expect(frame).toContain("WINDOW MOVE");
      expect(frame).toContain("WINDOW MOVE · Main Portfolio");
      expect(frame).toContain("Tab/w window");
    } finally {
      openTuiUiHost.capabilities = previousCapabilities;
    }
  });

  test("closes the focused docked pane with Ctrl+W", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-shell-test");
    const mainPane = config.layout.instances.find((instance) => instance.instanceId === "portfolio-list:main");
    if (!mainPane) throw new Error("missing default portfolio pane");

    const singlePaneLayout = {
      dockRoot: { kind: "pane" as const, instanceId: "portfolio-list:main" },
      instances: [{ ...mainPane }],
      floating: [],
    };
    const state = {
      ...createInitialState({
        ...config,
        layout: cloneLayout(singlePaneLayout),
        layouts: [{ name: "Default", layout: cloneLayout(singlePaneLayout) }],
      }),
      focusedPaneId: "portfolio-list:main",
    };
    const actions: Array<any> = [];

    testSetup = await testRender(
      <AppContext value={{ state, dispatch: (action) => actions.push(action) }}>
        <TestDialogProvider>
          <Shell pluginRegistry={createShellPluginRegistry()} />
        </TestDialogProvider>
      </AppContext>,
      { width: 40, height: 10 },
    );

    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressKey("w", { ctrl: true });
      await testSetup!.renderOnce();
    });

    const updateLayout = actions.find((action) => action.type === "UPDATE_LAYOUT");
    expect(actions).toContainEqual({ type: "PUSH_LAYOUT_HISTORY" });
    expect(updateLayout?.layout.instances).toEqual([]);
    expect(updateLayout?.layout.floating).toEqual([]);
    expect(updateLayout?.layout.dockRoot).toBeNull();
  });

  test("closes the focused pane after double Escape", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-shell-test");
    const mainPane = config.layout.instances.find((instance) => instance.instanceId === "portfolio-list:main");
    if (!mainPane) throw new Error("missing default portfolio pane");

    const singlePaneLayout = {
      dockRoot: { kind: "pane" as const, instanceId: "portfolio-list:main" },
      instances: [{ ...mainPane }],
      floating: [],
    };
    const state = {
      ...createInitialState({
        ...config,
        layout: cloneLayout(singlePaneLayout),
        layouts: [{ name: "Default", layout: cloneLayout(singlePaneLayout) }],
      }),
      focusedPaneId: "portfolio-list:main",
    };
    const actions: Array<any> = [];

    testSetup = await testRender(
      <AppContext value={{ state, dispatch: (action) => actions.push(action) }}>
        <TestDialogProvider>
          <Shell pluginRegistry={createShellPluginRegistry()} />
        </TestDialogProvider>
      </AppContext>,
      { width: 40, height: 10 },
    );

    await testSetup.renderOnce();
    await emitKeypress({ name: "escape", sequence: "\u001b" });
    expect(actions.some((action) => action.type === "UPDATE_LAYOUT")).toBe(false);

    await emitKeypress({ name: "escape", sequence: "\u001b" });

    const updateLayout = actions.find((action) => action.type === "UPDATE_LAYOUT");
    expect(actions).toContainEqual({ type: "PUSH_LAYOUT_HISTORY" });
    expect(updateLayout?.layout.instances).toEqual([]);
    expect(updateLayout?.layout.floating).toEqual([]);
    expect(updateLayout?.layout.dockRoot).toBeNull();
  });

  test("closes the focused floating pane with Ctrl+W", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-shell-test");
    const mainPane = config.layout.instances.find((instance) => instance.instanceId === "portfolio-list:main");
    const detailPane = config.layout.instances.find((instance) => instance.instanceId === "ticker-detail:main");
    if (!mainPane || !detailPane) throw new Error("missing default panes");

    const mixedLayout = {
      dockRoot: { kind: "pane" as const, instanceId: "portfolio-list:main" },
      instances: [{ ...mainPane }, { ...detailPane }],
      floating: [{ instanceId: "ticker-detail:main", x: 4, y: 2, width: 30, height: 8 }],
      detached: [],
    };
    const state = {
      ...createInitialState({
        ...config,
        layout: cloneLayout(mixedLayout),
        layouts: [{ name: "Default", layout: cloneLayout(mixedLayout) }],
      }),
      focusedPaneId: "ticker-detail:main",
    };
    const actions: Array<any> = [];

    testSetup = await testRender(
      <AppContext value={{ state, dispatch: (action) => actions.push(action) }}>
        <TestDialogProvider>
          <Shell pluginRegistry={createShellPluginRegistry()} />
        </TestDialogProvider>
      </AppContext>,
      { width: 40, height: 12 },
    );

    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressKey("w", { ctrl: true });
      await testSetup!.renderOnce();
    });

    const updateLayout = actions.find((action) => action.type === "UPDATE_LAYOUT");
    expect(actions).toContainEqual({ type: "PUSH_LAYOUT_HISTORY" });
    expect(updateLayout?.layout.instances.map((instance: { instanceId: string }) => instance.instanceId)).toEqual(["portfolio-list:main"]);
    expect(updateLayout?.layout.floating).toEqual([]);
    expect(updateLayout?.layout.dockRoot).toEqual({ kind: "pane", instanceId: "portfolio-list:main" });
  });

  test("closes the focused floating pane with Cmd+W", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-shell-test");
    const mainPane = config.layout.instances.find((instance) => instance.instanceId === "portfolio-list:main");
    const detailPane = config.layout.instances.find((instance) => instance.instanceId === "ticker-detail:main");
    if (!mainPane || !detailPane) throw new Error("missing default panes");

    const mixedLayout = {
      dockRoot: { kind: "pane" as const, instanceId: "portfolio-list:main" },
      instances: [{ ...mainPane }, { ...detailPane }],
      floating: [{ instanceId: "ticker-detail:main", x: 4, y: 2, width: 30, height: 8 }],
      detached: [],
    };
    const state = {
      ...createInitialState({
        ...config,
        layout: cloneLayout(mixedLayout),
        layouts: [{ name: "Default", layout: cloneLayout(mixedLayout) }],
      }),
      focusedPaneId: "ticker-detail:main",
    };
    const actions: Array<any> = [];

    testSetup = await testRender(
      <AppContext value={{ state, dispatch: (action) => actions.push(action) }}>
        <TestDialogProvider>
          <Shell pluginRegistry={createShellPluginRegistry()} />
        </TestDialogProvider>
      </AppContext>,
      { width: 40, height: 12 },
    );

    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressKey("w", { meta: true });
      await testSetup!.renderOnce();
    });

    const updateLayout = actions.find((action) => action.type === "UPDATE_LAYOUT");
    expect(updateLayout?.layout.instances.map((instance: { instanceId: string }) => instance.instanceId)).toEqual(["portfolio-list:main"]);
    expect(updateLayout?.layout.floating).toEqual([]);
  });

});
