import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "../../renderers/opentui/test-utils";
import { setSharedMarketDataCoordinator } from "../../market-data/coordinator";
import { setSharedRegistryForTests, type PluginRegistry } from "../../plugins/registry";
import { createDefaultConfig } from "../../types/config";
import { AppContext, createInitialState } from "../app/context";
import { useInlineTickers } from "./inline-tickers";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

function InlineTickerHarness({ liveQuotes = true }: { liveQuotes?: boolean }) {
  const { catalog } = useInlineTickers(["$LGD1L"], { liveQuotes });
  return <text>{catalog.LGD1L?.status ?? "none"}</text>;
}

afterEach(async () => {
  if (testSetup) {
    await act(async () => {
      testSetup!.renderer.destroy();
    });
  }
  testSetup = undefined;
  setSharedMarketDataCoordinator(null);
  setSharedRegistryForTests(undefined);
});

describe("useInlineTickers", () => {
  test("does not leak rejected quote lookups for existing inline tickers", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-inline-tickers-test");
    const state = createInitialState(config);
    state.tickers.set("LGD1L", {
      metadata: {
        ticker: "LGD1L",
        exchange: "NASDAQ",
        currency: "USD",
        name: "Unsupported quote",
        portfolios: [],
        watchlists: [],
        positions: [],
        broker_contracts: [],
        custom: {},
        tags: [],
      },
    });
    const actions: unknown[] = [];
    setSharedRegistryForTests({
      marketData: {
        getQuote: async () => {
          throw new Error("No quote provider available for LGD1L");
        },
      },
      pinTicker: () => {},
    } as unknown as PluginRegistry);

    await act(async () => {
      testSetup = await testRender(
        <AppContext value={{ state, dispatch: (action) => actions.push(action) }}>
          <InlineTickerHarness />
        </AppContext>,
        { width: 20, height: 1 },
      );
    });

    await act(async () => {
      await testSetup!.renderOnce();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await testSetup!.renderOnce();
    });

    expect(testSetup!.captureCharFrame()).toContain("missing");
    expect(actions).toEqual([]);
  });

  test("can resolve inline ticker badges without live quote lookups", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-inline-tickers-static-test");
    const state = createInitialState(config);
    state.tickers.set("LGD1L", {
      metadata: {
        ticker: "LGD1L",
        exchange: "NASDAQ",
        currency: "USD",
        name: "Static badge",
        portfolios: [],
        watchlists: [],
        positions: [],
        broker_contracts: [],
        custom: {},
        tags: [],
      },
    });
    let quoteCalls = 0;
    setSharedRegistryForTests({
      marketData: {
        getQuote: async () => {
          quoteCalls += 1;
          throw new Error("quotes should be disabled");
        },
      },
      pinTicker: () => {},
    } as unknown as PluginRegistry);

    await act(async () => {
      testSetup = await testRender(
        <AppContext value={{ state, dispatch: () => {} }}>
          <InlineTickerHarness liveQuotes={false} />
        </AppContext>,
        { width: 20, height: 1 },
      );
    });

    await act(async () => {
      await testSetup!.renderOnce();
      await Promise.resolve();
    });

    expect(testSetup!.captureCharFrame()).toContain("ready");
    expect(quoteCalls).toBe(0);
  });
});
