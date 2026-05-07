import { describe, expect, test } from "bun:test";
import { MarketDataCoordinator } from "./coordinator";
import { buildQuoteKey } from "./selectors";
import { createTestDataProvider } from "../test-support/data-provider";
import type { Quote } from "../types/financials";
import type { DataProvider, QuoteSubscriptionTarget } from "../types/data-provider";

function createProvider(): {
  provider: DataProvider;
  emitQuote: (target: QuoteSubscriptionTarget, quote: Quote) => void;
} {
  let onQuote: ((target: QuoteSubscriptionTarget, quote: Quote) => void) | null = null;
  const provider = createTestDataProvider({
    id: "test-provider",
    subscribeQuotes: (_targets, handler) => {
      onQuote = handler;
      return () => {};
    },
  });
  return {
    provider,
    emitQuote(target, quote) {
      if (!onQuote) throw new Error("subscription was not registered");
      onQuote(target, quote);
    },
  };
}

function quote(symbol: string, price: number, overrides: Partial<Quote> = {}): Quote {
  return {
    symbol,
    price,
    currency: "USD",
    change: 0,
    changePercent: 0,
    lastUpdated: Date.now(),
    ...overrides,
  };
}

async function flushCoordinator(): Promise<void> {
  await Promise.resolve();
}

describe("MarketDataCoordinator key subscriptions", () => {
  test("notifies listeners for changed keys only", async () => {
    const { provider, emitQuote } = createProvider();
    const coordinator = new MarketDataCoordinator(provider);
    const aapl = { symbol: "AAPL", exchange: "NASDAQ" };
    const msft = { symbol: "MSFT", exchange: "NASDAQ" };
    let aaplCalls = 0;
    let msftCalls = 0;

    coordinator.subscribeKeys([buildQuoteKey(aapl)], () => { aaplCalls += 1; });
    coordinator.subscribeKeys([buildQuoteKey(msft)], () => { msftCalls += 1; });
    coordinator.subscribeQuotes([{ instrument: aapl }, { instrument: msft }]);

    emitQuote({ symbol: "AAPL", exchange: "NASDAQ" }, quote("AAPL", 100));
    await flushCoordinator();

    expect(aaplCalls).toBe(1);
    expect(msftCalls).toBe(0);
  });

  test("dedupes listeners subscribed to multiple changed keys", async () => {
    const { provider, emitQuote } = createProvider();
    const coordinator = new MarketDataCoordinator(provider);
    const aapl = { symbol: "AAPL", exchange: "NASDAQ" };
    const msft = { symbol: "MSFT", exchange: "NASDAQ" };
    let calls = 0;

    coordinator.subscribeKeys([buildQuoteKey(aapl), buildQuoteKey(msft)], () => { calls += 1; });
    coordinator.subscribeQuotes([{ instrument: aapl }, { instrument: msft }]);

    emitQuote({ symbol: "AAPL", exchange: "NASDAQ" }, quote("AAPL", 100));
    emitQuote({ symbol: "MSFT", exchange: "NASDAQ" }, quote("MSFT", 200));
    await flushCoordinator();

    expect(calls).toBe(1);
  });

  test("coalesces global notifications per microtask", async () => {
    const { provider, emitQuote } = createProvider();
    const coordinator = new MarketDataCoordinator(provider);
    const aapl = { symbol: "AAPL", exchange: "NASDAQ" };
    const msft = { symbol: "MSFT", exchange: "NASDAQ" };
    let calls = 0;

    coordinator.subscribe(() => { calls += 1; });
    coordinator.subscribeQuotes([{ instrument: aapl }, { instrument: msft }]);

    emitQuote({ symbol: "AAPL", exchange: "NASDAQ" }, quote("AAPL", 100));
    emitQuote({ symbol: "MSFT", exchange: "NASDAQ" }, quote("MSFT", 200));
    await flushCoordinator();

    expect(calls).toBe(1);
    expect(coordinator.getVersion()).toBe(1);
  });

  test("ignores repeated stream quotes that only refresh timestamp noise", async () => {
    const { provider, emitQuote } = createProvider();
    const coordinator = new MarketDataCoordinator(provider);
    const aapl = { symbol: "AAPL", exchange: "NASDAQ" };
    let calls = 0;

    coordinator.subscribeKeys([buildQuoteKey(aapl)], () => { calls += 1; });
    coordinator.subscribeQuotes([{ instrument: aapl }]);

    const firstTimestamp = 1_700_000_000_000;
    emitQuote({ symbol: "AAPL", exchange: "NASDAQ" }, quote("AAPL", 100, { lastUpdated: firstTimestamp }));
    await flushCoordinator();

    emitQuote({ symbol: "AAPL", exchange: "NASDAQ" }, quote("AAPL", 100, { lastUpdated: firstTimestamp + 10_000 }));
    await flushCoordinator();

    expect(calls).toBe(1);
    expect(coordinator.getQuoteEntry(aapl).data?.lastUpdated).toBe(firstTimestamp);

    emitQuote({ symbol: "AAPL", exchange: "NASDAQ" }, quote("AAPL", 101, { lastUpdated: firstTimestamp + 20_000 }));
    await flushCoordinator();

    expect(calls).toBe(2);
    expect(coordinator.getQuoteEntry(aapl).data?.price).toBe(101);
  });
});
