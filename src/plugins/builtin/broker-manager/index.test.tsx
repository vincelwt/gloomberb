import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { Box } from "../../../ui";
import { PaneFooterBar, PaneFooterProvider } from "../../../components/layout/pane-footer";
import { testRender } from "../../../renderers/opentui/test-utils";
import { AppContext, PaneInstanceProvider, createInitialState } from "../../../state/app-context";
import { createTestPluginRuntime } from "../../../test-support/plugin-runtime";
import { createDefaultConfig, type BrokerInstanceConfig } from "../../../types/config";
import { PluginRenderProvider } from "../../plugin-runtime";
import { ibkrBroker } from "../../ibkr/broker-adapter";
import { BrokersPane } from "./index";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(async () => {
  if (testSetup) {
    await act(async () => {
      testSetup!.renderer.destroy();
    });
    testSetup = undefined;
  }
});

function createGatewayInstance(): BrokerInstanceConfig {
  return {
    id: "ibkr-paper",
    brokerType: "ibkr",
    label: "IBKR Paper",
    connectionMode: "gateway",
    config: {
      connectionMode: "gateway",
      gatewaySetupMode: "manual",
      flex: { token: "", queryId: "", endpoint: "" },
      gateway: { host: "127.0.0.1", port: 4002, marketDataType: "auto" },
    },
    enabled: true,
  };
}

function Harness({
  instance,
  calls,
  paneHeight = 24,
}: {
  instance?: BrokerInstanceConfig;
  calls: string[];
  paneHeight?: number;
}) {
  const config = {
    ...createDefaultConfig("/tmp/gloomberb-broker-manager-pane"),
    brokerInstances: instance ? [instance] : [],
  };
  const state = createInitialState(config);
  if (instance) {
    state.brokerAccounts = {
      [instance.id]: [{
        accountId: "DU12345",
        name: "DU12345",
        currency: "USD",
        netLiquidation: 125000,
        buyingPower: 50000,
      }],
    };
  }
  const runtime = createTestPluginRuntime({
    getBrokerAdapter: (brokerType) => brokerType === "ibkr" ? ibkrBroker : null,
    openCommandBar: (query) => calls.push(`command:${query ?? ""}`),
    showWidget: (paneId) => calls.push(`widget:${paneId}`),
    connectBrokerInstance: async (instanceId) => { calls.push(`connect:${instanceId}`); },
    syncBrokerInstance: async (instanceId) => { calls.push(`sync:${instanceId}`); },
    updateBrokerInstance: async (instanceId) => { calls.push(`update:${instanceId}`); },
  });

  return (
    <AppContext value={{ state, dispatch: () => {} }}>
      <PluginRenderProvider pluginId="broker-manager" runtime={runtime}>
        <PaneInstanceProvider paneId="brokers:test">
          <BrokersPane focused width={92} height={paneHeight} />
        </PaneInstanceProvider>
      </PluginRenderProvider>
    </AppContext>
  );
}

function FooterHarness({
  height = 25,
  ...props
}: {
  instance?: BrokerInstanceConfig;
  calls: string[];
  height?: number;
}) {
  return (
    <PaneFooterProvider>
      {(footer) => (
        <Box width={92} height={height} flexDirection="column">
          <Harness {...props} paneHeight={height - 1} />
          <PaneFooterBar footer={footer} focused width={92} />
        </Box>
      )}
    </PaneFooterProvider>
  );
}

async function clickText(text: string) {
  const lines = testSetup!.captureCharFrame().split("\n");
  const row = lines.findIndex((line) => line.includes(text));
  const col = lines[row]?.indexOf(text) ?? -1;
  expect(row).toBeGreaterThanOrEqual(0);
  expect(col).toBeGreaterThanOrEqual(0);
  await act(async () => {
    await testSetup!.mockMouse.click(col + 1, row);
    await Promise.resolve();
    await testSetup!.renderOnce();
    await testSetup!.renderOnce();
  });
}

describe("BrokersPane", () => {
  test("shows empty state and opens add broker flow", async () => {
    const calls: string[] = [];
    testSetup = await testRender(<Harness calls={calls} />, { width: 92, height: 24 });
    await act(async () => {
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("No broker profiles.");
    expect(frame).not.toContain("Press a or click Add Broker.");
    await act(async () => {
      testSetup!.mockInput.pressKey("a");
      await testSetup!.renderOnce();
    });

    expect(calls).toEqual(["command:Add Broker Account"]);
  });

  test("hides unavailable footer actions with no broker profile", async () => {
    const calls: string[] = [];
    testSetup = await testRender(<FooterHarness calls={calls} />, { width: 92, height: 25 });
    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("[a]dd");
    expect(frame).not.toContain("[c]onnect");
    expect(frame).not.toContain("[d]isconnect");
  });

  test("renders IBKR details and invokes broker actions", async () => {
    const calls: string[] = [];
    testSetup = await testRender(<FooterHarness calls={calls} instance={createGatewayInstance()} height={35} />, { width: 92, height: 35 });
    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    let frame = testSetup.captureCharFrame();
    expect(frame).toContain("PROFILE");
    expect(frame).toContain("STATUS");
    expect(frame).toContain("ACCOUNTS");
    expect(frame).toContain("IBKR Paper");
    expect(frame).not.toContain("DU12345");

    await clickText("[e]dit");
    await clickText("Save");
    expect(calls).toEqual(["update:ibkr-paper"]);
    calls.length = 0;

    frame = testSetup.captureCharFrame();
    expect(frame).toContain("DU12345");
    expect(frame).toContain("$125,000.00");

    await clickText("Test");
    await clickText("Sync");
    await clickText("IBKR Console");

    expect(calls).toEqual(["connect:ibkr-paper", "sync:ibkr-paper", "widget:ibkr-trading"]);
  });
});
