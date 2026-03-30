import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import type { TickerFinancials } from "../../types/financials";
import type { TickerRecord } from "../../types/ticker";
import { createDefaultConfig } from "../../types/config";
import { AppContext, createInitialState, PaneInstanceProvider } from "../../state/app-context";
import { QuoteMonitorPane, tickerDetailPlugin } from "./ticker-detail";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
});

function createQuoteMonitorHarness() {
  const config = createDefaultConfig("/tmp/gloomberb-test");
  (config.layout as typeof config.layout & { docked: Array<{ instanceId: string; columnIndex: number; order: number }> }).docked = [
    { instanceId: "ticker-detail:main", columnIndex: 0, order: 0 },
    { instanceId: "quote-monitor:test", columnIndex: 1, order: 0 },
  ];
  config.layout.instances.push({
    instanceId: "quote-monitor:test",
    paneId: "quote-monitor",
    title: "MSFT",
    binding: { kind: "fixed", symbol: "MSFT" },
  });

  const state = createInitialState(config);

  const ticker: TickerRecord = {
    metadata: {
      ticker: "MSFT",
      exchange: "NASDAQ",
      currency: "USD",
      name: "Microsoft",
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
    },
  };

  const financials: TickerFinancials = {
    quote: {
      symbol: "MSFT",
      price: 356.15,
      currency: "USD",
      change: -9.82,
      changePercent: -2.68,
      lastUpdated: Date.now(),
    },
    annualStatements: [],
    quarterlyStatements: [],
    priceHistory: [],
  };

  state.tickers = new Map([["MSFT", ticker]]);
  state.financials = new Map([["MSFT", financials]]);

  return (
    <AppContext value={{ state, dispatch: () => {} }}>
      <PaneInstanceProvider paneId="quote-monitor:test">
        <QuoteMonitorPane paneId="quote-monitor:test" paneType="quote-monitor" focused width={72} height={7} />
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
  });

  test("registers a quote monitor pane template bound to the active ticker", () => {
    const template = tickerDetailPlugin.paneTemplates?.find((entry) => entry.id === "quote-monitor-pane");

    expect(template).toBeDefined();
    expect(template?.label).toBe("Quote Monitor");
    expect(template?.canCreate?.({
      config: createDefaultConfig("/tmp/gloomberb-test"),
      layout: createDefaultConfig("/tmp/gloomberb-test").layout,
      focusedPaneId: "ticker-detail:main",
      activeTicker: "MSFT",
      activeCollectionId: null,
    })).toBe(true);
    expect(template?.createInstance?.({
      config: createDefaultConfig("/tmp/gloomberb-test"),
      layout: createDefaultConfig("/tmp/gloomberb-test").layout,
      focusedPaneId: "ticker-detail:main",
      activeTicker: "MSFT",
      activeCollectionId: null,
    })).toEqual({
      title: "MSFT",
      binding: { kind: "fixed", symbol: "MSFT" },
      settings: { symbol: "MSFT" },
      placement: "floating",
    });
  });
});
