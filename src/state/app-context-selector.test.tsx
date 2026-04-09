import { afterEach, describe, expect, test } from "bun:test";
import { act, useRef, type Dispatch } from "react";
import { testRender } from "@opentui/react/test-utils";
import { AppProvider, PaneInstanceProvider, useAppDispatch, useAppSelector, usePaneTicker, type AppAction } from "./app-context";
import { cloneLayout, createDefaultConfig, type AppConfig } from "../types/config";
import { applyTheme, getCurrentThemeId } from "../theme/colors";

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
  return <text>{`${focusedPaneId ?? "none"}:${getCurrentThemeId()}`}</text>;
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

  test("rerenders selector consumers when the theme changes", async () => {
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
});
