import { describe, expect, it } from "bun:test";
import { MarketDataCoordinator } from "./coordinator";
import type { DataProvider, QuoteSubscriptionTarget } from "../types/data-provider";
import type { InstrumentSearchResult } from "../types/instrument";
import type { OptionsChain, PricePoint, Quote, TickerFinancials } from "../types/financials";
import { createTestDataProvider } from "../test-support/data-provider";

function createProvider(overrides: Partial<DataProvider> = {}): DataProvider {
  return createTestDataProvider({
    id: "test-provider",
    getTickerFinancials: async () => ({
      quote: {
        symbol: "AAPL",
        price: 100,
        currency: "USD",
        change: 1,
        changePercent: 1,
        lastUpdated: Date.now(),
      },
      fundamentals: { marketCap: 1 } as any,
      profile: { sector: "Tech" },
      annualStatements: [],
      quarterlyStatements: [],
      priceHistory: [],
    }),
    getQuote: async () => ({
      symbol: "AAPL",
      price: 100,
      currency: "USD",
      change: 1,
      changePercent: 1,
      lastUpdated: Date.now(),
    } satisfies Quote),
    search: async () => [] satisfies InstrumentSearchResult[],
    ...overrides,
  });
}

describe("MarketDataCoordinator", () => {
  it("builds a ticker snapshot from the centralized stores", async () => {
    const provider = createProvider({
      getTickerFinancials: async () => ({
        quote: {
          symbol: "AAPL",
          providerId: "gloomberb-cloud",
          price: 189.12,
          currency: "USD",
          change: 2.1,
          changePercent: 1.12,
          lastUpdated: 1_700_000_000_000,
        },
        fundamentals: { trailingPE: 28.1 },
        profile: { sector: "Technology", industry: "Consumer Electronics" },
        annualStatements: [{ date: "2024-09-30", totalRevenue: 1 }],
        quarterlyStatements: [{ date: "2024-12-31", totalRevenue: 1 }],
        priceHistory: [],
      } satisfies TickerFinancials),
    });
    const coordinator = new MarketDataCoordinator(provider);
    const instrument = { symbol: "AAPL", exchange: "NASDAQ" };

    await coordinator.loadSnapshot(instrument);

    expect(coordinator.getQuoteEntry(instrument).data?.price).toBe(189.12);
    expect(coordinator.getTickerFinancialsSync(instrument)?.fundamentals?.trailingPE).toBe(28.1);
    expect(coordinator.getTickerFinancialsSync(instrument)?.profile?.industry).toBe("Consumer Electronics");
  });

  it("keeps last good chart data when a refresh returns empty", async () => {
    const histories: PricePoint[][] = [
      [
        { date: new Date("2024-01-01"), close: 100 },
        { date: new Date("2024-01-02"), close: 101 },
      ],
      [],
    ];
    const provider = createProvider({
      getPriceHistory: async () => histories.shift() ?? [],
    });
    const coordinator = new MarketDataCoordinator(provider);
    const request = {
      instrument: { symbol: "AAPL", exchange: "NASDAQ" },
      range: "1Y" as const,
      granularity: "daily" as const,
    };

    const first = await coordinator.loadChart(request);
    expect(first.data?.length).toBe(2);

    const second = await coordinator.loadChart(request);
    expect(second.data).toBeNull();
    expect(second.lastGoodData?.length).toBe(2);
  });

  it("normalizes descending chart history before storing it", async () => {
    const provider = createProvider({
      getPriceHistory: async () => [
        { date: new Date("2024-01-03"), close: 103 },
        { date: new Date("2024-01-01"), close: 101 },
        { date: new Date("2024-01-02"), close: 102 },
      ],
    });
    const coordinator = new MarketDataCoordinator(provider);
    const request = {
      instrument: { symbol: "AAPL", exchange: "NASDAQ" },
      range: "1Y" as const,
      granularity: "daily" as const,
    };

    const entry = await coordinator.loadChart(request);

    expect(entry.data?.map((point) => point.close)).toEqual([101, 102, 103]);
  });

  it("updates the quote store from streaming events", () => {
    let streamed: ((target: QuoteSubscriptionTarget, quote: Quote) => void) | null = null;
    const provider = createProvider({
      subscribeQuotes: (_targets, onQuote) => {
        streamed = onQuote as typeof streamed;
        return () => {};
      },
    });
    const coordinator = new MarketDataCoordinator(provider);
    const instrument = { symbol: "MSFT", exchange: "NASDAQ" };

    coordinator.subscribeQuotes([{ instrument }]);
    const onStreamed = streamed;
    if (!onStreamed) throw new Error("expected streaming callback");
    onStreamed(
      { symbol: "MSFT", exchange: "NASDAQ" },
      {
        symbol: "MSFT",
        providerId: "gloomberb-cloud",
        price: 412.5,
        currency: "USD",
        change: 3.2,
        changePercent: 0.8,
        lastUpdated: Date.now(),
      },
    );

    expect(coordinator.getQuoteEntry(instrument).data?.price).toBe(412.5);
  });

  it("projects live quote updates into premarket display fields when the stream lacks explicit ext-hours fields", async () => {
    let streamed: ((target: QuoteSubscriptionTarget, quote: Quote) => void) | null = null;
    const provider = createProvider({
      getTickerFinancials: async () => ({
        quote: {
          symbol: "AAPL",
          price: 100,
          currency: "USD",
          change: -1,
          changePercent: -1,
          lastUpdated: 1_700_000_000_000,
          marketState: "PRE",
          preMarketPrice: 101,
          preMarketChange: 0,
          preMarketChangePercent: 0,
        },
        annualStatements: [],
        quarterlyStatements: [],
        priceHistory: [],
      }),
      subscribeQuotes: (_targets, onQuote) => {
        streamed = onQuote as typeof streamed;
        return () => {};
      },
    });
    const coordinator = new MarketDataCoordinator(provider);
    const instrument = { symbol: "AAPL", exchange: "NASDAQ", brokerId: "ibkr", brokerInstanceId: "ibkr-live" };

    await coordinator.loadSnapshot(instrument);
    coordinator.subscribeQuotes([{ instrument }]);
    const onStreamed = streamed;
    if (!onStreamed) throw new Error("expected streaming callback");
    onStreamed(
      {
        symbol: "AAPL",
        exchange: "NASDAQ",
        context: {
          brokerId: "ibkr",
          brokerInstanceId: "ibkr-live",
          instrument: null,
        },
      },
      {
        symbol: "AAPL",
        providerId: "gloomberb-cloud",
        price: 103.5,
        currency: "USD",
        change: 2.5,
        changePercent: 2.48,
        lastUpdated: Date.now(),
      },
    );

    const quote = coordinator.getTickerFinancialsSync(instrument)?.quote;
    expect(quote?.marketState).toBe("PRE");
    expect(quote?.preMarketPrice).toBe(103.5);
    expect(quote?.preMarketChange).toBe(2.5);
    expect(quote?.preMarketChangePercent).toBe(2.48);
  });

  it("keeps the snapshot quote when a quote-only refresh is off by a likely 100x unit mismatch", async () => {
    const provider = createProvider({
      getTickerFinancials: async () => ({
        quote: {
          symbol: "IQE.L",
          price: 0.245,
          currency: "GBP",
          change: -0.021,
          changePercent: -7.89,
          lastUpdated: Date.now() - 1000,
          dataSource: "yahoo",
        },
        annualStatements: [],
        quarterlyStatements: [],
        priceHistory: [],
      }),
      getQuote: async () => ({
        symbol: "IQE",
        providerId: "gloomberb-cloud",
        price: 24.5,
        currency: "GBP",
        change: -2.1,
        changePercent: -7.89,
        lastUpdated: Date.now(),
        dataSource: "live",
      }),
    });
    const coordinator = new MarketDataCoordinator(provider);
    const instrument = { symbol: "IQE", exchange: "LSE" };

    await coordinator.loadSnapshot(instrument);
    await coordinator.loadQuote(instrument);

    expect(coordinator.getQuoteEntry(instrument).data?.price).toBe(24.5);
    expect(coordinator.getTickerFinancialsSync(instrument)?.quote?.price).toBe(0.245);
    expect(coordinator.getTickerFinancialsSync(instrument)?.quote?.symbol).toBe("IQE.L");
  });

  it("keeps the snapshot quote when a streaming update is off by a likely 100x unit mismatch", async () => {
    let streamed: ((target: QuoteSubscriptionTarget, quote: Quote) => void) | null = null;
    const provider = createProvider({
      getTickerFinancials: async () => ({
        quote: {
          symbol: "IQE.L",
          price: 0.245,
          currency: "GBP",
          change: -0.021,
          changePercent: -7.89,
          lastUpdated: Date.now() - 1000,
          dataSource: "yahoo",
        },
        annualStatements: [],
        quarterlyStatements: [],
        priceHistory: [],
      }),
      subscribeQuotes: (_targets, onQuote) => {
        streamed = onQuote as typeof streamed;
        return () => {};
      },
    });
    const coordinator = new MarketDataCoordinator(provider);
    const instrument = { symbol: "IQE", exchange: "LSE" };

    await coordinator.loadSnapshot(instrument);
    coordinator.subscribeQuotes([{ instrument }]);
    const onStreamed = streamed;
    if (!onStreamed) throw new Error("expected streaming callback");
    onStreamed(
      { symbol: "IQE", exchange: "LSE" },
      {
        symbol: "IQE",
        providerId: "gloomberb-cloud",
        price: 24.5,
        currency: "GBP",
        change: -2.1,
        changePercent: -7.89,
        lastUpdated: Date.now(),
        dataSource: "live",
      },
    );

    expect(coordinator.getQuoteEntry(instrument).data?.price).toBe(24.5);
    expect(coordinator.getTickerFinancialsSync(instrument)?.quote?.price).toBe(0.245);
  });

  it("hydrates ticker financials synchronously from primed cached data", () => {
    const coordinator = new MarketDataCoordinator(createProvider());
    const instrument = { symbol: "AAPL", exchange: "NASDAQ" };

    coordinator.primeCachedFinancials([{
      instrument,
      financials: {
        quote: {
          symbol: "AAPL",
          price: 246.63,
          currency: "USD",
          change: -2.17,
          changePercent: -0.87,
          marketCap: 3_640_775_908_600,
          lastUpdated: 1_700_000_000_000,
        },
        fundamentals: {
          trailingPE: 31.4,
          forwardPE: 27.8,
        },
        profile: {
          sector: "Technology",
        },
        annualStatements: [],
        quarterlyStatements: [],
        priceHistory: [{ date: new Date("2026-03-28T00:00:00Z"), close: 248.8 }],
      },
    }]);

    const financials = coordinator.getTickerFinancialsSync(instrument);
    expect(financials?.quote?.marketCap).toBe(3_640_775_908_600);
    expect(financials?.fundamentals?.trailingPE).toBe(31.4);
    expect(financials?.priceHistory[0]?.close).toBe(248.8);
  });

  it("merges live quote data with primed cached financials during resume", async () => {
    const provider = createProvider({
      getQuote: async () => ({
        symbol: "AAPL",
        price: 246.63,
        currency: "USD",
        change: -2.17,
        changePercent: -0.87,
        lastUpdated: 1_700_000_001_000,
      }),
    });
    const coordinator = new MarketDataCoordinator(provider);
    const instrument = { symbol: "AAPL", exchange: "NASDAQ" };

    coordinator.primeCachedFinancials([{
      instrument,
      financials: {
        quote: {
          symbol: "AAPL",
          price: 248.8,
          currency: "USD",
          change: 0,
          changePercent: 0,
          marketCap: 3_640_775_908_600,
          lastUpdated: 1_700_000_000_000,
        },
        fundamentals: {
          trailingPE: 31.4,
        },
        profile: {
          sector: "Technology",
        },
        annualStatements: [],
        quarterlyStatements: [],
        priceHistory: [],
      },
    }]);
    await coordinator.loadQuote(instrument);

    const financials = coordinator.getTickerFinancialsSync(instrument);
    expect(financials?.quote?.price).toBe(246.63);
    expect(financials?.quote?.marketCap).toBe(3_640_775_908_600);
    expect(financials?.fundamentals?.trailingPE).toBe(31.4);
  });
});
