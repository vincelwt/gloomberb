import { afterEach, describe, expect, test } from "bun:test";
import { act, useReducer } from "react";
import { testRender } from "../../../renderers/opentui/test-utils";
import {
  AppContext,
  PaneInstanceProvider,
  appReducer,
  createInitialState,
  type AppState,
} from "../../../state/app-context";
import { cloneLayout, createDefaultConfig, type AppConfig } from "../../../types/config";
import { PluginRenderProvider, type PluginRuntimeAccess } from "../../plugin-runtime";
import { PaneFooterBar, PaneFooterProvider } from "../../../components/layout/pane-footer";
import { Box } from "../../../ui";
import { setSharedRegistryForTests } from "../../registry";
import { deserializeAlerts, serializeAlerts } from "./alert-engine";
import { AlertsPane, alertsPlugin } from "./index";
import type { AlertCondition, AlertRule, AlertStatus } from "./types";

const TEST_PANE_ID = "alerts:test";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;
let harnessState: AppState | null = null;
let harnessDispatch: ((action: any) => void) | null = null;

function makeAlert(
  id: string,
  symbol: string,
  condition: AlertCondition,
  targetPrice: number,
  status: AlertStatus = "active",
): AlertRule {
  return {
    id,
    symbol,
    condition,
    targetPrice,
    createdAt: 1_700_000_000_000,
    status,
    triggeredAt: status === "triggered" ? Date.now() - 30_000 : undefined,
    lastCheckedPrice: status === "triggered" ? targetPrice + 1 : undefined,
  };
}

function createAlertsConfig(alerts: AlertRule[]): AppConfig {
  const baseConfig = createDefaultConfig("/tmp/gloomberb-alerts");
  const layout: AppConfig["layout"] = {
    dockRoot: { kind: "pane", instanceId: TEST_PANE_ID },
    instances: [{
      instanceId: TEST_PANE_ID,
      paneId: "alerts",
      binding: { kind: "none" },
    }],
    floating: [],
  };

  return {
    ...baseConfig,
    layout,
    layouts: [{ name: "Default", layout: cloneLayout(layout) }],
    pluginConfig: {
      ...baseConfig.pluginConfig,
      alerts: {
        alerts: serializeAlerts(alerts),
      },
    },
  };
}

function makeRuntime(): PluginRuntimeAccess {
  const resumeState = new Map<string, unknown>();
  const listeners = new Map<string, Set<() => void>>();

  return {
    pinTicker() {},
    navigateTicker() {},
    subscribeResumeState(pluginId, key, listener) {
      const storeKey = `${pluginId}:${key}`;
      if (!listeners.has(storeKey)) listeners.set(storeKey, new Set());
      listeners.get(storeKey)!.add(listener);
      return () => listeners.get(storeKey)?.delete(listener);
    },
    getResumeState(pluginId, key) {
      return (resumeState.get(`${pluginId}:${key}`) as any) ?? null;
    },
    setResumeState(pluginId, key, value) {
      const storeKey = `${pluginId}:${key}`;
      resumeState.set(storeKey, value);
      for (const listener of listeners.get(storeKey) ?? []) listener();
    },
    deleteResumeState(pluginId, key) {
      const storeKey = `${pluginId}:${key}`;
      resumeState.delete(storeKey);
      for (const listener of listeners.get(storeKey) ?? []) listener();
    },
    getConfigState(pluginId, key) {
      return (harnessState?.config.pluginConfig[pluginId]?.[key] as any) ?? null;
    },
    async setConfigState(pluginId, key, value) {
      const currentState = harnessState!;
      harnessDispatch?.({
        type: "SET_CONFIG",
        config: {
          ...currentState.config,
          pluginConfig: {
            ...currentState.config.pluginConfig,
            [pluginId]: {
              ...(currentState.config.pluginConfig[pluginId] ?? {}),
              [key]: value,
            },
          },
        },
      });
    },
    async deleteConfigState(pluginId, key) {
      const currentState = harnessState!;
      const currentPluginConfig = { ...(currentState.config.pluginConfig[pluginId] ?? {}) };
      delete currentPluginConfig[key];
      const pluginConfig = { ...currentState.config.pluginConfig };
      if (Object.keys(currentPluginConfig).length === 0) delete pluginConfig[pluginId];
      else pluginConfig[pluginId] = currentPluginConfig;
      harnessDispatch?.({
        type: "SET_CONFIG",
        config: {
          ...currentState.config,
          pluginConfig,
        },
      });
    },
    getConfigStateKeys(pluginId) {
      return Object.keys(harnessState?.config.pluginConfig[pluginId] ?? {}).sort();
    },
  };
}

function AlertsHarness({
  alerts,
  width = 110,
  height = 12,
}: {
  alerts: AlertRule[];
  width?: number;
  height?: number;
}) {
  const initialState = createInitialState(createAlertsConfig(alerts));
  initialState.focusedPaneId = TEST_PANE_ID;
  const [state, dispatch] = useReducer(appReducer, initialState);
  harnessState = state;
  harnessDispatch = dispatch;

  return (
    <AppContext value={{ state, dispatch }}>
      <PaneInstanceProvider paneId={TEST_PANE_ID}>
        <PluginRenderProvider pluginId="alerts" runtime={makeRuntime()}>
          <PaneFooterProvider>
            {(footer) => (
              <Box flexDirection="column" width={width} height={height}>
                <AlertsPane focused width={width} height={Math.max(1, height - 1)} />
                <PaneFooterBar footer={footer} focused width={width} />
              </Box>
            )}
          </PaneFooterProvider>
        </PluginRenderProvider>
      </PaneInstanceProvider>
    </AppContext>
  );
}

async function renderSettled(): Promise<void> {
  await act(async () => {
    await testSetup!.renderOnce();
    await testSetup!.renderOnce();
  });
}

async function clickFrameText(text: string): Promise<void> {
  const frame = testSetup!.captureCharFrame();
  const rows = frame.split("\n");
  const row = rows.findIndex((line) => line.includes(text));
  const col = row >= 0 ? rows[row]!.indexOf(text) : -1;

  expect(row).toBeGreaterThanOrEqual(0);
  expect(col).toBeGreaterThanOrEqual(0);

  await act(async () => {
    await testSetup!.mockMouse.click(col + 1, row);
    await testSetup!.renderOnce();
    await testSetup!.renderOnce();
  });
}

function storedAlerts(): AlertRule[] {
  const value = (harnessState?.config.pluginConfig.alerts as any)?.alerts;
  expect(typeof value).toBe("string");
  return JSON.parse(value);
}

afterEach(() => {
  setSharedRegistryForTests(undefined);
  harnessState = null;
  harnessDispatch = null;
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
});

describe("AlertsPane", () => {
  test("renders alerts in a data table with action hints only in the footer", async () => {
    testSetup = await testRender(
      <AlertsHarness
        alerts={[
          makeAlert("alert-aapl", "AAPL", "above", 200),
          makeAlert("alert-msft", "MSFT", "below", 300, "triggered"),
        ]}
      />,
      { width: 110, height: 12 },
    );

    await renderSettled();
    const frame = testSetup.captureCharFrame();

    expect(frame).toContain("Status");
    expect(frame).toContain("Symbol");
    expect(frame).toContain("Condition");
    expect(frame).toContain("AAPL");
    expect(frame).toContain("MSFT");
    expect(frame).toContain("[a]dd alert");
    expect(frame).toContain("[d]elete");
    expect(frame).not.toContain("Add Alert");
    expect(frame).not.toContain("Enter");
    expect(frame).not.toContain("Esc");
    expect(frame).not.toContain("move field");
    expect(frame).not.toContain("change condition");
    expect(frame).not.toContain("↑/↓");
    expect(frame).not.toContain("←/→");
  });

  test("keeps alert targets visible at the default floating pane width", async () => {
    testSetup = await testRender(
      <AlertsHarness
        width={65}
        height={8}
        alerts={[makeAlert("alert-aapl", "AAPL", "above", 200)]}
      />,
      { width: 65, height: 8 },
    );

    await renderSettled();
    const frame = testSetup.captureCharFrame();

    expect(frame).toContain("Status");
    expect(frame).toContain("Condition");
    expect(frame).toContain("Target");
    expect(frame).toContain("200");
    expect(frame).toContain("[a]dd alert");
  });

  test("opens the command-bar alert workflow from keyboard and mouse", async () => {
    const workflowCalls: string[] = [];
    setSharedRegistryForTests({
      openPluginCommandWorkflow(commandId: string) {
        workflowCalls.push(commandId);
      },
    } as any);

    testSetup = await testRender(<AlertsHarness alerts={[]} />, {
      width: 110,
      height: 12,
    });

    await renderSettled();
    await act(async () => {
      await testSetup!.mockInput.typeText("a");
      await testSetup!.renderOnce();
    });
    await clickFrameText("[a]");

    expect(workflowCalls).toEqual(["set-alert", "set-alert"]);
  });

  test("updates alerts from table action clicks", async () => {
    testSetup = await testRender(
      <AlertsHarness
        alerts={[
          makeAlert("alert-aapl", "AAPL", "above", 200),
          makeAlert("alert-msft", "MSFT", "below", 300, "triggered"),
        ]}
      />,
      { width: 110, height: 12 },
    );

    await renderSettled();
    await clickFrameText("Re-arm");

    expect(storedAlerts().find((alert) => alert.id === "alert-msft")?.status).toBe("active");

    await clickFrameText("[d]");

    expect(storedAlerts().map((alert) => alert.id)).toEqual(["alert-msft"]);
  });
});

describe("alertsPlugin command", () => {
  test("registers a searchable add command with direct shortcut arguments", async () => {
    const store = new Map<string, unknown>();
    const commands: any[] = [];
    const notifications: any[] = [];
    const ctx = {
      registerCommand(command: any) {
        commands.push(command);
      },
      registerPane() {},
      registerPaneTemplate() {},
      configState: {
        get(key: string) {
          return store.get(key);
        },
        set(key: string, value: unknown) {
          store.set(key, value);
        },
      },
      dataProvider: {
        getQuote: async () => null,
      },
      notify(notification: any) {
        notifications.push(notification);
      },
      log: {
        info() {},
        warn() {},
        error() {},
      },
    };

    try {
      alertsPlugin.setup(ctx as any);
      const command = commands.find((entry) => entry.id === "set-alert");

      expect(command?.label).toBe("Add Alert");
      expect(command?.keywords).toContain("add");
      expect(command?.shortcut).toBe("SA");
      expect(command?.shortcutArg?.placeholder).toBe("symbol condition price");
      expect(command?.shortcutArg?.parse("AMD")).toEqual({ symbol: "AMD" });
      expect(command?.shortcutArg?.parse("AMD above 200")).toEqual({
        symbol: "AMD",
        condition: "above",
        price: "200",
      });

      await command.execute({ shortcut: "AAPL above 200" });

      const alerts = deserializeAlerts(String(store.get("alerts")));
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({
        symbol: "AAPL",
        condition: "above",
        targetPrice: 200,
        status: "active",
      });
      expect(notifications[0]?.body).toContain("AAPL");
    } finally {
      alertsPlugin.dispose?.();
    }
  });
});
