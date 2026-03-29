import { afterEach, expect, test } from "bun:test";
import { DialogProvider } from "@opentui-ui/dialog/react";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import {
  AppContext,
  PaneInstanceProvider,
  createInitialState,
} from "../../state/app-context";
import { cloneLayout, createDefaultConfig, type AppConfig, type BrokerInstanceConfig } from "../../types/config";
import type { TickerFinancials } from "../../types/financials";
import type { TickerRecord } from "../../types/ticker";
import { ibkrGatewayManager } from "./gateway-service";
import { TradeTab } from "./index";
import {
  clearTradingDraft,
  prefillTradeFromTicker,
  setTradeTicketDraft,
  setTradeTicketPreview,
  updateTradingPaneState,
} from "./trading-state";

const TEST_PANE_ID = "ticker-detail:trade-test";
const TEST_INSTANCE_ID = "ibkr-paper";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

function createGatewayInstance(): BrokerInstanceConfig {
  return {
    id: TEST_INSTANCE_ID,
    brokerType: "ibkr",
    label: "Paper",
    connectionMode: "gateway",
    config: { connectionMode: "gateway", gateway: { host: "127.0.0.1", port: 4002, clientId: 1 } },
    enabled: true,
  };
}

function createTradeConfig(symbol: string): AppConfig {
  const config = createDefaultConfig("/tmp/gloomberb-trade-tab");
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
    brokerInstances: [createGatewayInstance()],
    layout,
    layouts: [{ name: "Default", layout: cloneLayout(layout) }],
  };
}

function makeTicker(symbol: string, name = symbol): TickerRecord {
  return {
    metadata: {
      ticker: symbol,
      exchange: "NASDAQ",
      currency: "USD",
      name,
      assetCategory: "STK",
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
    },
  };
}

function makeFinancials(): TickerFinancials {
  return {
    quote: {
      symbol: "AMD",
      price: 199.8,
      currency: "USD",
      change: -3.97,
      changePercent: -1.95,
      bid: 199.7,
      ask: 199.9,
      lastUpdated: Date.now(),
    },
    annualStatements: [],
    quarterlyStatements: [],
    priceHistory: [],
  };
}

function stubGatewayRefresh(): void {
  const service = ibkrGatewayManager.getService(TEST_INSTANCE_ID) as any;
  service.connect = async () => {};
  service.getAccounts = async () => [];
  service.listOpenOrders = async () => [];
  service.listExecutions = async () => [];
}

function TradeHarness({
  config,
  ticker,
  financials,
}: {
  config: AppConfig;
  ticker: TickerRecord;
  financials: TickerFinancials;
}) {
  const state = createInitialState(config);
  state.focusedPaneId = TEST_PANE_ID;
  state.tickers = new Map([[ticker.metadata.ticker, ticker]]);
  state.financials = new Map([[ticker.metadata.ticker, financials]]);

  return (
    <DialogProvider dialogOptions={{ style: { backgroundColor: "#000000", borderColor: "#ffffff", borderStyle: "single" } }}>
      <AppContext value={{ state, dispatch: () => {} }}>
        <PaneInstanceProvider paneId={TEST_PANE_ID}>
          <TradeTab focused width={88} height={30} onCapture={() => {}} />
        </PaneInstanceProvider>
      </AppContext>
    </DialogProvider>
  );
}

afterEach(async () => {
  if (testSetup) {
    await act(async () => {
      testSetup!.renderer.destroy();
    });
    testSetup = undefined;
  }
  clearTradingDraft();
  await ibkrGatewayManager.removeInstance(TEST_INSTANCE_ID);
});

test("renders the compact trade tab layout", async () => {
  const config = createTradeConfig("AMD");
  const ticker = makeTicker("AMD", "Advanced Micro Devices, Inc.");
  const financials = makeFinancials();

  clearTradingDraft();
  stubGatewayRefresh();
  prefillTradeFromTicker(ticker, "BUY");
  setTradeTicketDraft("AMD", { accountId: "DU123456" }, ticker);
  setTradeTicketPreview("AMD", {
    commission: 1.25,
    commissionCurrency: "USD",
    initMarginBefore: 12_400,
    initMarginAfter: 13_150,
    maintMarginBefore: 10_050,
    maintMarginAfter: 10_700,
    equityWithLoanBefore: 58_400,
    equityWithLoanAfter: 57_150,
  }, ticker);
  updateTradingPaneState({ accountId: "DU123456" });

  await act(async () => {
    testSetup = await testRender(
      <TradeHarness config={config} ticker={ticker} financials={financials} />,
      { width: 88, height: 30 },
    );
  });

  await act(async () => {
    await testSetup!.renderOnce();
  });
  await act(async () => {
    await testSetup!.renderOnce();
  });

  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("Next Submit order");
  expect(frame).toContain("Ticket Standby");
  expect(frame).toContain("Side [b/v]");
  expect(frame).toContain("What-if: init");
  expect(frame).not.toContain("1 Profile");
  expect(frame).not.toContain("Activate Ticket");
  expect(frame).toMatchSnapshot();
});
