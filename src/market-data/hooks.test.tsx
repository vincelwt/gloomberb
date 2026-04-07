import { afterEach, describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { testRender } from "@opentui/react/test-utils";
import type { TickerFinancials } from "../types/financials";
import type { TickerRecord } from "../types/ticker";
import { MarketDataCoordinator, setSharedMarketDataCoordinator } from "./coordinator";
import { useFxRatesMap, useTickerFinancialsMap } from "./hooks";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;
let bumpHarness: (() => void) | null = null;
let latestFxRates: Map<string, number> | null = null;
let latestFinancialsMap: Map<string, TickerFinancials> | null = null;

const readyUsdEntry = {
  phase: "ready" as const,
  data: 1,
  lastGoodData: 1,
  source: "test",
  fetchedAt: 1,
  staleAt: null,
  error: null,
  attempts: [],
};
const readyEurEntry = {
  phase: "ready" as const,
  data: 1.08,
  lastGoodData: 1.08,
  source: "test",
  fetchedAt: 1,
  staleAt: null,
  error: null,
  attempts: [],
};
const sampleFinancials: TickerFinancials = {
  annualStatements: [],
  quarterlyStatements: [],
  priceHistory: [],
  quote: {
    symbol: "SAP",
    price: 250,
    currency: "EUR",
    change: 2,
    changePercent: 0.8,
    lastUpdated: 1,
  },
};
const tickers: TickerRecord[] = [
  {
    metadata: {
      ticker: "SAP",
      exchange: "XETRA",
      currency: "EUR",
      name: "SAP",
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
    },
  },
];

function HooksHarness() {
  const [tick, setTick] = useState(0);
  bumpHarness = () => setTick((current) => current + 1);

  latestFxRates = useFxRatesMap(["USD", "EUR"]);
  latestFinancialsMap = useTickerFinancialsMap(tickers);

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
  latestFxRates = null;
  latestFinancialsMap = null;
  setSharedMarketDataCoordinator(null);
});

describe("market-data hooks", () => {
  test("preserve derived map instances across unrelated rerenders", async () => {
    const coordinator = {
      subscribe: () => () => {},
      getVersion: () => 1,
      getFxEntry: (currency: string) => (currency === "EUR" ? readyEurEntry : readyUsdEntry),
      loadFxRate: async () => {},
      getTickerFinancialsSync: () => sampleFinancials,
    };
    setSharedMarketDataCoordinator(coordinator as unknown as MarketDataCoordinator);

    testSetup = await testRender(<HooksHarness />, {
      width: 20,
      height: 1,
    });

    await act(async () => {
      await testSetup!.renderOnce();
    });

    const initialFxRates = latestFxRates;
    const initialFinancialsMap = latestFinancialsMap;

    await act(async () => {
      bumpHarness?.();
      await Promise.resolve();
    });
    await act(async () => {
      await testSetup!.renderOnce();
    });

    expect(latestFxRates).toBe(initialFxRates);
    expect(latestFinancialsMap).toBe(initialFinancialsMap);
  });
});
