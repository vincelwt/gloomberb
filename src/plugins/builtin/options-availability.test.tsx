import { afterEach, describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { testRender } from "@opentui/react/test-utils";
import type { DataProvider } from "../../types/data-provider";
import type { OptionsChain } from "../../types/financials";
import type { TickerRecord } from "../../types/ticker";
import { MarketDataCoordinator, setSharedMarketDataCoordinator } from "../../market-data/coordinator";
import {
  fetchOptionsAvailability,
  readOptionsAvailability,
  resetOptionsAvailabilityCache,
  useOptionsAvailability,
} from "./options-availability";
import { resolveOptionsTarget } from "../../utils/options";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;
let setHarnessTicker: ((ticker: TickerRecord | null) => void) | null = null;
let sharedCoordinator: MarketDataCoordinator | null = null;

function makeTicker(symbol: string, assetCategory = "STK"): TickerRecord {
  return {
    metadata: {
      ticker: symbol,
      exchange: "NASDAQ",
      currency: "USD",
      name: symbol,
      assetCategory,
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
    },
  };
}

function createProvider(
  getOptionsChain: NonNullable<DataProvider["getOptionsChain"]>,
): DataProvider {
  return {
    id: "test-provider",
    name: "Test Provider",
    getTickerFinancials: async () => { throw new Error("unused"); },
    getQuote: async () => { throw new Error("unused"); },
    getExchangeRate: async () => 1,
    search: async () => [],
    getNews: async () => [],
    getArticleSummary: async () => null,
    getPriceHistory: async () => [],
    getOptionsChain,
  };
}

function createChain(underlyingSymbol: string, expirationDates: number[]): OptionsChain {
  return {
    underlyingSymbol,
    expirationDates,
    calls: [],
    puts: [],
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function AvailabilityHarness({ initialTicker }: { initialTicker: TickerRecord | null }) {
  const [ticker, setTicker] = useState(initialTicker);
  setHarnessTicker = setTicker;
  const available = useOptionsAvailability(ticker);
  return <text>{`${ticker?.metadata.ticker ?? "none"}:${available}`}</text>;
}

async function renderFrame() {
  await act(async () => {
    await testSetup!.renderOnce();
  });
}

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
  setHarnessTicker = null;
  resetOptionsAvailabilityCache();
  sharedCoordinator = null;
  setSharedMarketDataCoordinator(null);
});

describe("options availability", () => {
  test("marks a stock with expirations as available", async () => {
    const target = resolveOptionsTarget(makeTicker("AAPL"));
    const provider = createProvider(async () => createChain("AAPL", [1_717_113_600]));

    expect(target).not.toBeNull();
    expect(await fetchOptionsAvailability(target!, provider)).toBe(true);
    expect(readOptionsAvailability(target!)).toBe(true);
  });

  test("marks an empty chain as unavailable", async () => {
    const target = resolveOptionsTarget(makeTicker("AAPL"));
    const provider = createProvider(async () => createChain("AAPL", []));

    expect(target).not.toBeNull();
    expect(await fetchOptionsAvailability(target!, provider)).toBe(false);
    expect(readOptionsAvailability(target!)).toBe(false);
  });

  test("resolves option positions to the underlying before checking", async () => {
    const ticker = makeTicker("SPY  260619C00500000", "OPT");
    const calls: Array<{ symbol: string; exchange: string }> = [];
    const provider = createProvider(async (symbol, exchange = "") => {
      calls.push({ symbol, exchange });
      return createChain(symbol, [1_717_113_600]);
    });
    const target = resolveOptionsTarget(ticker);

    expect(target).not.toBeNull();
    await fetchOptionsAvailability(target!, provider);

    expect(calls).toEqual([{ symbol: "SPY", exchange: "" }]);
  });

  test("ignores stale async results when the selected ticker changes", async () => {
    const aapl = createDeferred<OptionsChain>();
    const tsla = createDeferred<OptionsChain>();
    sharedCoordinator = new MarketDataCoordinator(createProvider(async (symbol) => (
      symbol === "AAPL" ? aapl.promise : tsla.promise
    )));
    setSharedMarketDataCoordinator(sharedCoordinator);

    testSetup = await testRender(<AvailabilityHarness initialTicker={makeTicker("AAPL")} />, {
      width: 40,
      height: 4,
    });

    await renderFrame();

    await act(async () => {
      setHarnessTicker!(makeTicker("TSLA"));
      await Promise.resolve();
    });
    await renderFrame();

    await act(async () => {
      tsla.resolve(createChain("TSLA", []));
      await Promise.resolve();
    });
    await renderFrame();

    await act(async () => {
      aapl.resolve(createChain("AAPL", [1_717_113_600]));
      await Promise.resolve();
    });
    await renderFrame();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("TSLA:false");
    expect(frame).not.toContain("TSLA:true");
  });

  test("suppresses duplicate preflight calls while the cache is fresh", async () => {
    const target = resolveOptionsTarget(makeTicker("AAPL"));
    let calls = 0;
    const provider = createProvider(async () => {
      calls += 1;
      return createChain("AAPL", [1_717_113_600]);
    });

    expect(target).not.toBeNull();
    expect(await fetchOptionsAvailability(target!, provider)).toBe(true);
    expect(await fetchOptionsAvailability(target!, provider)).toBe(true);
    expect(calls).toBe(1);
  });
});
