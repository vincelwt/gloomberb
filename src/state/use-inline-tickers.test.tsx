import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "../renderers/opentui/test-utils";
import { setSharedMarketDataCoordinator } from "../market-data/coordinator";
import { setSharedRegistryForTests, type PluginRegistry } from "../plugins/registry";
import { createDefaultConfig } from "../types/config";
import { AppContext, createInitialState } from "./app-context";
import { useInlineTickers } from "./use-inline-tickers";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

function InlineTickerHarness() {
  const { catalog } = useInlineTickers(["$LGD1L"]);
  return <text>{catalog.LGD1L?.status ?? "none"}</text>;
}

afterEach(() => {
  testSetup?.renderer.destroy();
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

    expect(testSetup.captureCharFrame()).toContain("missing");
    expect(actions).toEqual([]);
  });
});
