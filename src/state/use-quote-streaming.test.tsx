import { afterEach, describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { testRender } from "@opentui/react/test-utils";
import { MarketDataCoordinator, setSharedMarketDataCoordinator } from "../market-data/coordinator";
import { useQuoteStreaming } from "./use-quote-streaming";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;
let bumpHarness: (() => void) | null = null;

function QuoteStreamingHarness() {
  const [tick, setTick] = useState(0);
  bumpHarness = () => setTick((current) => current + 1);

  useQuoteStreaming([{
    symbol: "AAPL",
    exchange: "NASDAQ",
  }]);

  return <text>{String(tick)}</text>;
}

afterEach(async () => {
  if (testSetup) {
    await act(async () => {
      testSetup!.renderer.destroy();
    });
    testSetup = undefined;
  }
  bumpHarness = null;
  setSharedMarketDataCoordinator(null);
});

describe("useQuoteStreaming", () => {
  test("does not resubscribe when the component rerenders with the same targets", async () => {
    let subscribeCalls = 0;
    let unsubscribeCalls = 0;
    const coordinator = {
      subscribeQuotes: () => {
        subscribeCalls += 1;
        return () => {
          unsubscribeCalls += 1;
        };
      },
    };
    setSharedMarketDataCoordinator(coordinator as unknown as MarketDataCoordinator);

    testSetup = await testRender(<QuoteStreamingHarness />, {
      width: 20,
      height: 1,
    });

    await act(async () => {
      await testSetup!.renderOnce();
    });

    expect(subscribeCalls).toBe(1);
    expect(unsubscribeCalls).toBe(0);

    await act(async () => {
      bumpHarness?.();
      await Promise.resolve();
    });
    await act(async () => {
      await testSetup!.renderOnce();
    });

    expect(subscribeCalls).toBe(1);
    expect(unsubscribeCalls).toBe(0);
  });
});
