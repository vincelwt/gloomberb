import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "../../renderers/opentui/test-utils";
import type { TickerFinancials } from "../../types/financials";
import type { TickerRecord } from "../../types/ticker";
import { createDefaultConfig } from "../../types/config";
import { AppContext, createInitialState, PaneInstanceProvider } from "../../state/app-context";
import { QuoteMonitorPane } from "./ticker-detail";
import { PluginRenderProvider, type PluginRuntimeAccess } from "../plugin-runtime";
import type { PinTickerOptions } from "../../types/plugin";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
});

interface PinTickerCall {
  symbol: string;
  options?: PinTickerOptions;
}

function makeRuntime(options: {
  pinCalls?: PinTickerCall[];
  settingsCalls?: Array<string | undefined>;
} = {}): PluginRuntimeAccess {
  return {
    getMarketData: () => null,
    getCapability: () => null,
    getBrokerAdapter: () => null,
    connectBrokerInstance: async () => {},
    updateBrokerInstance: async () => {},
    syncBrokerInstance: async () => {},
    removeBrokerInstance: async () => {},
    pinTicker: (symbol, pinOptions) => {
      options.pinCalls?.push({ symbol, options: pinOptions });
    },
    navigateTicker: () => {},
    selectTicker: () => {},
    switchTab: () => {},
    switchPanel: () => {},
    openCommandBar: () => {},
    showPane: () => {},
    createPaneFromTemplate: () => {},
    hidePane: () => {},
    openPaneSettings: (paneId) => {
      options.settingsCalls?.push(paneId);
    },
    openPluginCommandWorkflow: () => {},
    notify: () => {},
    subscribeResumeState: () => () => {},
    getResumeState: () => null,
    setResumeState: () => {},
    deleteResumeState: () => {},
    getConfigState: () => null,
    setConfigState: async () => {},
    setConfigStates: async () => {},
    deleteConfigState: async () => {},
    getConfigStateKeys: () => [],
  };
}

function makeTicker(symbol: string, name: string): TickerRecord {
  return {
    metadata: {
      ticker: symbol,
      exchange: "NASDAQ",
      currency: "USD",
      name,
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
    },
  };
}

function makeFinancials(symbol: string, price: number, change: number, changePercent: number): TickerFinancials {
  return {
    quote: {
      symbol,
      price,
      currency: "USD",
      change,
      changePercent,
      lastUpdated: Date.now(),
    },
    annualStatements: [],
    quarterlyStatements: [],
    priceHistory: Array.from({ length: 12 }, (_, index) => ({
      date: new Date(Date.UTC(2026, 0, index + 1)),
      close: price - 6 + index,
    })),
  };
}

function createQuoteMonitorHarness(options: {
  symbols?: string[];
  pinCalls?: PinTickerCall[];
  settingsCalls?: Array<string | undefined>;
} = {}) {
  const symbols = options.symbols ?? ["MSFT"];
  const config = createDefaultConfig("/tmp/gloomberb-test");
  (config.layout as typeof config.layout & { docked: Array<{ instanceId: string; columnIndex: number; order: number }> }).docked = [
    { instanceId: "ticker-detail:main", columnIndex: 0, order: 0 },
    { instanceId: "quote-monitor:test", columnIndex: 1, order: 0 },
  ];
  config.layout.instances.push({
    instanceId: "quote-monitor:test",
    paneId: "quote-monitor",
    title: symbols.join(" · "),
    binding: { kind: "fixed", symbol: symbols[0]! },
    settings: {
      symbol: symbols[0]!,
      symbols,
      symbolsText: symbols.join(", "),
    },
  });

  const state = createInitialState(config);

  const tickers = [
    makeTicker("MSFT", "Microsoft"),
    makeTicker("AAPL", "Apple"),
  ];
  state.tickers = new Map(tickers.map((ticker) => [ticker.metadata.ticker, ticker]));
  state.financials = new Map([
    ["MSFT", makeFinancials("MSFT", 356.15, -9.82, -2.68)],
    ["AAPL", makeFinancials("AAPL", 202.12, 3.05, 1.53)],
  ]);

  return (
    <AppContext value={{ state, dispatch: () => {} }}>
      <PaneInstanceProvider paneId="quote-monitor:test">
        <PluginRenderProvider pluginId="ticker-detail" runtime={makeRuntime({
          pinCalls: options.pinCalls,
          settingsCalls: options.settingsCalls,
        })}>
          <QuoteMonitorPane paneId="quote-monitor:test" paneType="quote-monitor" focused width={72} height={7} />
        </PluginRenderProvider>
      </PaneInstanceProvider>
    </AppContext>
  );
}

describe("QuoteMonitorPane", () => {
  test("renders a compact quote card for the bound ticker", async () => {
    testSetup = await testRender(createQuoteMonitorHarness(), {
      width: 72,
      height: 7,
    });

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("MSFT");
    expect(frame).toContain("$356.15");
    expect(frame).toContain("-2.68%");
    expect(frame).toContain("-9.82");
    expect(frame).toMatch(/[⠁-⣿]/);
  });

  test("renders multiple configured tickers", async () => {
    testSetup = await testRender(createQuoteMonitorHarness({ symbols: ["MSFT", "AAPL"] }), {
      width: 72,
      height: 8,
    });

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("MSFT");
    expect(frame).toContain("AAPL");
    expect(frame).toContain("$356.15");
    expect(frame).toContain("$202.12");
  });

  test("opens a ticker detail pane on the second card click", async () => {
    const pinCalls: PinTickerCall[] = [];
    testSetup = await testRender(createQuoteMonitorHarness({ pinCalls }), {
      width: 72,
      height: 7,
    });

    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    const row = frame.split("\n").findIndex((line) => line.includes("MSFT"));
    expect(row).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(3, row);
      await testSetup!.renderOnce();
      await testSetup!.mockMouse.click(3, row);
      await testSetup!.renderOnce();
    });

    expect(pinCalls).toEqual([{
      symbol: "MSFT",
      options: { paneType: "ticker-detail", floating: true },
    }]);
  });

  test("opens pane settings when t is pressed", async () => {
    const settingsCalls: Array<string | undefined> = [];
    testSetup = await testRender(createQuoteMonitorHarness({ settingsCalls }), {
      width: 72,
      height: 7,
    });

    await testSetup.renderOnce();

    await act(async () => {
      testSetup!.mockInput.pressKey("t");
      await testSetup!.renderOnce();
    });

    expect(settingsCalls).toEqual(["quote-monitor:test"]);
  });
});
