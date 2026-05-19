import { afterEach, describe, expect, test } from "bun:test";
import { act, useRef, type Dispatch } from "react";
import { testRender } from "../renderers/opentui/test-utils";
import { AppProvider, PaneInstanceProvider, useAppDispatch, useAppSelector, usePaneTicker, type AppAction } from "./app-context";
import { cloneLayout, createDefaultConfig, type AppConfig } from "../types/config";
import { applyTheme } from "../theme/colors";
import { useThemeId } from "../theme/theme-context";
import type { DesktopSharedStateSnapshot, DesktopThemePreviewState, DesktopWindowBridge } from "../types/desktop-window";

const TEST_PANE_ID = "ticker-detail:test";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;
let capturedDispatch: Dispatch<AppAction> | null = null;

function createTickerDetailConfig(symbol: string): AppConfig {
  const config = createDefaultConfig("/tmp/gloomberb-test");
  const layout = {
    dockRoot: { kind: "pane" as const, instanceId: TEST_PANE_ID },
    instances: [{
      instanceId: TEST_PANE_ID,
      paneId: "ticker-detail",
      binding: { kind: "fixed" as const, symbol },
    }],
    floating: [],
    detached: [],
  };

  return {
    ...config,
    layout,
    layouts: [{ name: "Default", layout: cloneLayout(layout) }],
  };
}

function DispatchCapture() {
  capturedDispatch = useAppDispatch();
  return null;
}

function PaneTickerHarness() {
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  const { symbol } = usePaneTicker();
  return <text>{`${symbol ?? "none"}:${renderCountRef.current}`}</text>;
}

function ThemeSelectorHarness() {
  const focusedPaneId = useAppSelector((state) => state.focusedPaneId);
  const themeId = useThemeId();
  return <text>{`${focusedPaneId ?? "none"}:${themeId}`}</text>;
}

function createDesktopBridge(
  kind: "main" | "detached",
  calls: {
    mainSnapshots?: DesktopSharedStateSnapshot[];
    themePreviews?: DesktopThemePreviewState[];
    onThemePreviewSubscribe?: (listener: (preview: DesktopThemePreviewState) => void) => void;
  } = {},
): DesktopWindowBridge {
  return {
    kind,
    paneId: kind === "detached" ? TEST_PANE_ID : undefined,
    syncMainState: kind === "main"
      ? async (snapshot) => {
        calls.mainSnapshots?.push(snapshot);
      }
      : undefined,
    syncThemePreview: kind === "main"
      ? async (preview) => {
        calls.themePreviews?.push(preview);
      }
      : undefined,
    subscribeState: () => () => {},
    subscribeThemePreview: kind === "detached"
      ? (listener) => {
        calls.onThemePreviewSubscribe?.(listener);
        return () => {};
      }
      : undefined,
  };
}

describe("pane selectors", () => {
  afterEach(() => {
    testSetup?.renderer.destroy();
    testSetup = undefined;
    capturedDispatch = null;
    applyTheme("amber");
  });

  test("does not rerender usePaneTicker consumers for unrelated app state updates", async () => {
    testSetup = await testRender(
      <AppProvider config={createTickerDetailConfig("AAPL")}>
        <PaneInstanceProvider paneId={TEST_PANE_ID}>
          <DispatchCapture />
          <PaneTickerHarness />
        </PaneInstanceProvider>
      </AppProvider>,
      { width: 24, height: 4 },
    );

    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain("AAPL:1");

    await act(() => {
      capturedDispatch?.({ type: "SET_COMMAND_BAR", open: true, query: "ticker" });
    });

    await testSetup.renderOnce();
    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain("AAPL:1");
  });

  test("rerenders theme hook consumers when the theme changes", async () => {
    testSetup = await testRender(
      <AppProvider config={createTickerDetailConfig("AAPL")}>
        <DispatchCapture />
        <ThemeSelectorHarness />
      </AppProvider>,
      { width: 32, height: 4 },
    );

    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain(`${TEST_PANE_ID}:amber`);

    await act(() => {
      capturedDispatch?.({ type: "SET_THEME", theme: "green" });
    });

    await testSetup.renderOnce();
    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain(`${TEST_PANE_ID}:green`);
  });

  test("rerenders theme hook consumers when the theme preview changes", async () => {
    testSetup = await testRender(
      <AppProvider config={createTickerDetailConfig("AAPL")}>
        <DispatchCapture />
        <ThemeSelectorHarness />
      </AppProvider>,
      { width: 32, height: 4 },
    );

    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain(`${TEST_PANE_ID}:amber`);

    await act(() => {
      capturedDispatch?.({ type: "PREVIEW_THEME", theme: "green" });
    });

    await testSetup.renderOnce();
    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain(`${TEST_PANE_ID}:green`);
  });

  test("set theme updates the theme hook and clears the active preview", async () => {
    testSetup = await testRender(
      <AppProvider config={createTickerDetailConfig("AAPL")}>
        <DispatchCapture />
        <ThemeSelectorHarness />
      </AppProvider>,
      { width: 32, height: 4 },
    );

    await testSetup.renderOnce();
    await act(() => {
      capturedDispatch?.({ type: "PREVIEW_THEME", theme: "green" });
    });
    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain(`${TEST_PANE_ID}:green`);

    await act(() => {
      capturedDispatch?.({ type: "SET_THEME", theme: "red" });
    });

    await testSetup.renderOnce();
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain(`${TEST_PANE_ID}:red`);
    expect(frame).not.toContain(`${TEST_PANE_ID}:green`);
  });

  test("falls back to the committed theme when theme preview clears", async () => {
    testSetup = await testRender(
      <AppProvider config={createTickerDetailConfig("AAPL")}>
        <DispatchCapture />
        <ThemeSelectorHarness />
      </AppProvider>,
      { width: 32, height: 4 },
    );

    await testSetup.renderOnce();
    await act(() => {
      capturedDispatch?.({ type: "PREVIEW_THEME", theme: "green" });
    });
    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain(`${TEST_PANE_ID}:green`);

    await act(() => {
      capturedDispatch?.({ type: "PREVIEW_THEME", theme: null });
    });

    await testSetup.renderOnce();
    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain(`${TEST_PANE_ID}:amber`);
  });

  test("uses the configured theme on the first provider render", async () => {
    const config = createTickerDetailConfig("AAPL");
    config.theme = "green";

    testSetup = await testRender(
      <AppProvider config={config}>
        <ThemeSelectorHarness />
      </AppProvider>,
      { width: 32, height: 4 },
    );

    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain(`${TEST_PANE_ID}:green`);
  });

  test("uses the initial desktop theme preview on the first provider render", async () => {
    testSetup = await testRender(
      <AppProvider config={createTickerDetailConfig("AAPL")} initialThemePreview={{ theme: "green" }}>
        <ThemeSelectorHarness />
      </AppProvider>,
      { width: 32, height: 4 },
    );

    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain(`${TEST_PANE_ID}:green`);
  });

  test("desktop committed theme changes still sync through the config snapshot", async () => {
    const mainSnapshots: DesktopSharedStateSnapshot[] = [];
    const themePreviews: DesktopThemePreviewState[] = [];
    const bridge = createDesktopBridge("main", { mainSnapshots, themePreviews });

    testSetup = await testRender(
      <AppProvider config={createTickerDetailConfig("AAPL")} desktopBridge={bridge}>
        <DispatchCapture />
        <ThemeSelectorHarness />
      </AppProvider>,
      { width: 32, height: 4 },
    );

    await testSetup.renderOnce();
    mainSnapshots.length = 0;
    themePreviews.length = 0;

    await act(() => {
      capturedDispatch?.({ type: "SET_THEME", theme: "green" });
    });

    await testSetup.renderOnce();
    await testSetup.renderOnce();
    expect(mainSnapshots).toHaveLength(1);
    expect(mainSnapshots[0]?.config.theme).toBe("green");
    expect(themePreviews).toHaveLength(0);
  });

  test("desktop detached windows apply theme preview messages locally", async () => {
    let previewListener: ((preview: DesktopThemePreviewState) => void) | null = null;
    const bridge = createDesktopBridge("detached", {
      onThemePreviewSubscribe: (listener) => {
        previewListener = listener;
      },
    });

    testSetup = await testRender(
      <AppProvider config={createTickerDetailConfig("AAPL")} desktopBridge={bridge}>
        <ThemeSelectorHarness />
      </AppProvider>,
      { width: 32, height: 4 },
    );

    await testSetup.renderOnce();
    expect(previewListener).not.toBeNull();
    expect(testSetup.captureCharFrame()).toContain(`${TEST_PANE_ID}:amber`);

    await act(() => {
      previewListener?.({ theme: "green" });
    });

    await testSetup.renderOnce();
    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain(`${TEST_PANE_ID}:green`);
  });
});
