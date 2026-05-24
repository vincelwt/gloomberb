import { afterEach, describe, expect, test } from "bun:test";
import { AppPersistence } from "../../data/app-persistence";
import type { DataProvider } from "../../types/data-provider";
import { AssetDataRouter } from "./index";
import {
  cleanupProviderRouterTestFiles,
  createTempDbPath,
  fallbackProvider,
  makeFinancials,
  makeQuote,
} from "./test-support";

afterEach(() => {
  cleanupProviderRouterTestFiles();
});

describe("AssetDataRouter cached financials", () => {
  test("drops stale cached cloud quotes while preserving cached cloud fundamentals", () => {
    const dbPath = createTempDbPath("stale-cloud-cached-financials");
    const persistence = new AppPersistence(dbPath);
    const now = Date.now();
    const previousSession = now - 24 * 60 * 60_000;

    persistence.resources.set(
      {
        namespace: "market",
        kind: "financials",
        entityKey: "HY9H",
        variantKey: "exchange=FWB2",
        sourceKey: "provider:gloomberb-cloud",
      },
      makeFinancials({
        quote: makeQuote({
          symbol: "HY9H",
          price: 528,
          currency: "EUR",
          change: 28,
          changePercent: 5.6,
          lastUpdated: previousSession,
          marketState: "REGULAR",
          exchangeName: "FWB2",
          listingExchangeName: "FWB2",
          providerId: "gloomberb-cloud",
          dataSource: "delayed",
        }),
        fundamentals: {
          revenue: 1234,
        },
        profile: {
          description: "Cloud profile",
        },
      }),
      {
        cachePolicy: { staleMs: 60_000, expireMs: 60_000 },
        fetchedAt: now,
      },
    );
    persistence.resources.set(
      {
        namespace: "market",
        kind: "financials",
        entityKey: "HY9H",
        variantKey: "exchange=FWB2",
        sourceKey: "provider:yahoo",
      },
      makeFinancials({
        quote: makeQuote({
          symbol: "HY9H.F",
          price: 596,
          currency: "EUR",
          change: 68,
          changePercent: 12.88,
          lastUpdated: now,
          marketState: "REGULAR",
          exchangeName: "FWB2",
          listingExchangeName: "FWB2",
          providerId: "yahoo",
          dataSource: "delayed",
        }),
      }),
      {
        cachePolicy: { staleMs: 60_000, expireMs: 60_000 },
        fetchedAt: now,
      },
    );

    const router = new AssetDataRouter({
      ...fallbackProvider,
      id: "yahoo",
      name: "Yahoo",
      async getTickerFinancials() {
        throw new Error("should not fetch financials");
      },
    }, [{
      ...fallbackProvider,
      id: "gloomberb-cloud",
      name: "Cloud",
      priority: 100,
      async getTickerFinancials() {
        throw new Error("should not fetch financials");
      },
    }], persistence.resources);

    const cached = router.getCachedFinancialsForTargets([{
      symbol: "HY9H",
      exchange: "FWB2",
    }], { allowExpired: true });

    expect(cached.get("HY9H")?.quote?.providerId).toBe("yahoo");
    expect(cached.get("HY9H")?.quote?.price).toBe(596);
    expect(cached.get("HY9H")?.fundamentals?.revenue).toBe(1234);
    expect(cached.get("HY9H")?.profile?.description).toBe("Cloud profile");

    persistence.close();
  });

  test("drops cached premarket cloud quotes that lack an active-session price", () => {
    const dbPath = createTempDbPath("stale-cloud-premarket-cache");
    const persistence = new AppPersistence(dbPath);
    const now = Date.now();

    persistence.resources.set(
      {
        namespace: "market",
        kind: "financials",
        entityKey: "AMD",
        variantKey: "exchange=NASDAQ",
        sourceKey: "provider:gloomberb-cloud",
      },
      makeFinancials({
        quote: makeQuote({
          symbol: "AMD",
          price: 221.53,
          change: 1.35,
          changePercent: 0.61,
          lastUpdated: now,
          marketState: "PRE",
          exchangeName: "NASDAQ",
          listingExchangeName: "NASDAQ",
          providerId: "gloomberb-cloud",
          dataSource: "delayed",
        }),
      }),
      {
        cachePolicy: { staleMs: 60_000, expireMs: 60_000 },
        fetchedAt: now,
      },
    );
    persistence.resources.set(
      {
        namespace: "market",
        kind: "financials",
        entityKey: "AMD",
        variantKey: "exchange=NASDAQ",
        sourceKey: "provider:yahoo",
      },
      makeFinancials({
        quote: makeQuote({
          symbol: "AMD",
          price: 221.53,
          change: 1.35,
          changePercent: 0.61,
          lastUpdated: now,
          marketState: "PRE",
          preMarketPrice: 231,
          preMarketChange: 9.47,
          preMarketChangePercent: 4.27,
          exchangeName: "NASDAQ",
          listingExchangeName: "NASDAQ",
          providerId: "yahoo",
          dataSource: "delayed",
        }),
      }),
      {
        cachePolicy: { staleMs: 60_000, expireMs: 60_000 },
        fetchedAt: now,
      },
    );

    const router = new AssetDataRouter({
      ...fallbackProvider,
      id: "yahoo",
      name: "Yahoo",
      async getTickerFinancials() {
        throw new Error("should not fetch financials");
      },
    }, [{
      ...fallbackProvider,
      id: "gloomberb-cloud",
      name: "Cloud",
      priority: 100,
      async getTickerFinancials() {
        throw new Error("should not fetch financials");
      },
    }], persistence.resources);

    const cached = router.getCachedFinancialsForTargets([{
      symbol: "AMD",
      exchange: "NASDAQ",
    }], { allowExpired: true });

    expect(cached.get("AMD")?.quote?.providerId).toBe("yahoo");
    expect(cached.get("AMD")?.quote?.preMarketPrice).toBe(231);

    persistence.close();
  });

  test("keeps stale cached quotes only for startup cache priming", () => {
    const dbPath = createTempDbPath("startup-stale-quote-prime");
    const persistence = new AppPersistence(dbPath);
    const now = Date.now();

    persistence.resources.set(
      {
        namespace: "market",
        kind: "financials",
        entityKey: "OLD",
        variantKey: "exchange=NASDAQ",
        sourceKey: "provider:gloomberb-cloud",
      },
      makeFinancials({
        quote: makeQuote({
          symbol: "OLD",
          price: 42,
          change: -1,
          changePercent: -2.33,
          lastUpdated: Date.UTC(2020, 0, 2),
          marketState: "REGULAR",
          exchangeName: "NASDAQ",
          listingExchangeName: "NASDAQ",
          providerId: "gloomberb-cloud",
          dataSource: "delayed",
        }),
        fundamentals: {
          trailingPE: 12,
        },
      }),
      {
        cachePolicy: { staleMs: 60_000, expireMs: 60_000 },
        fetchedAt: now,
      },
    );

    const router = new AssetDataRouter({
      ...fallbackProvider,
      id: "gloomberb-cloud",
      name: "Cloud",
      async getTickerFinancials() {
        throw new Error("should not fetch financials");
      },
    }, [], persistence.resources);

    const normal = router.getCachedFinancialsForTargets([{ symbol: "OLD", exchange: "NASDAQ" }], { allowExpired: true });
    expect(normal.get("OLD")?.quote).toBeUndefined();
    expect(normal.get("OLD")?.fundamentals?.trailingPE).toBe(12);

    const startup = router.getCachedFinancialsForTargets(
      [{ symbol: "OLD", exchange: "NASDAQ" }],
      { allowExpired: true, includeStaleQuotes: true },
    );
    expect(startup.get("OLD")?.quote?.changePercent).toBe(-2.33);
    expect(startup.get("OLD")?.fundamentals?.trailingPE).toBe(12);

    persistence.close();
  });

  test("derives cached market cap from quote price and shares outstanding", () => {
    const dbPath = createTempDbPath("cached-derived-market-cap");
    const persistence = new AppPersistence(dbPath);
    const now = Date.now();

    persistence.resources.set(
      {
        namespace: "market",
        kind: "financials",
        entityKey: "AMD",
        variantKey: "exchange=NASDAQ",
        sourceKey: "provider:gloomberb-cloud",
      },
      makeFinancials({
        quote: makeQuote({
          symbol: "AMD",
          price: 445.38,
          change: -2.91,
          changePercent: -0.65,
          lastUpdated: now,
          marketState: "REGULAR",
          exchangeName: "NASDAQ",
          listingExchangeName: "NASDAQ",
          providerId: "gloomberb-cloud",
          dataSource: "delayed",
        }),
        fundamentals: {
          sharesOutstanding: 1_630_000_000,
        },
      }),
      {
        cachePolicy: { staleMs: 60_000, expireMs: 60_000 },
        fetchedAt: now,
      },
    );

    const router = new AssetDataRouter({
      ...fallbackProvider,
      id: "gloomberb-cloud",
      name: "Cloud",
      async getTickerFinancials() {
        throw new Error("should not fetch financials");
      },
    }, [], persistence.resources);

    const cached = router.getCachedFinancialsForTargets([{ symbol: "AMD", exchange: "NASDAQ" }], {
      allowExpired: true,
      includeStaleQuotes: true,
    });
    expect(cached.get("AMD")?.quote?.marketCap).toBeCloseTo(725_969_400_000);

    persistence.close();
  });

  test("uses symbol provider cache for broker-linked startup targets", () => {
    const dbPath = createTempDbPath("cached-symbol-fallback-for-contract");
    const persistence = new AppPersistence(dbPath);
    const now = Date.now();
    const old = now - 3 * 24 * 60 * 60_000;

    persistence.resources.set(
      {
        namespace: "market",
        kind: "financials",
        entityKey: "contract:14015423",
        variantKey: "exchange=JPX",
        sourceKey: "provider:yahoo",
      },
      makeFinancials({
        quote: makeQuote({
          symbol: "4092.T",
          providerId: "yahoo",
          price: 3770,
          currency: "JPY",
          change: 145,
          changePercent: 4,
          lastUpdated: old,
          marketState: "CLOSED",
          exchangeName: "JPX",
          listingExchangeName: "JPX",
        }),
      }),
      {
        cachePolicy: { staleMs: 60_000, expireMs: 7 * 24 * 60 * 60_000 },
        fetchedAt: old,
      },
    );
    persistence.resources.set(
      {
        namespace: "market",
        kind: "financials",
        entityKey: "4092.T",
        variantKey: "exchange=JPX",
        sourceKey: "provider:yahoo",
      },
      makeFinancials({
        quote: makeQuote({
          symbol: "4092.T",
          providerId: "yahoo",
          price: 3925,
          currency: "JPY",
          change: 20,
          changePercent: 0.51,
          lastUpdated: now,
          marketState: "CLOSED",
          exchangeName: "JPX",
          listingExchangeName: "JPX",
        }),
      }),
      {
        cachePolicy: { staleMs: 60_000, expireMs: 7 * 24 * 60 * 60_000 },
        fetchedAt: now,
      },
    );

    const router = new AssetDataRouter({
      ...fallbackProvider,
      id: "yahoo",
      name: "Yahoo",
      async getTickerFinancials() {
        throw new Error("should not fetch financials");
      },
    }, [], persistence.resources);

    const cached = router.getCachedFinancialsForTargets([{
      symbol: "4092.T",
      exchange: "JPX",
      instrument: {
        brokerId: "ibkr",
        brokerInstanceId: "ibkr-live",
        conId: 14015423,
        symbol: "4092.T",
      },
    }], { allowExpired: true, includeStaleQuotes: true });

    expect(cached.get("4092.T")?.quote?.price).toBe(3925);
    expect(cached.get("4092.T")?.quote?.changePercent).toBe(0.51);

    persistence.close();
  });

  test("overlays standalone quote cache on stale financial snapshots during startup priming", () => {
    const dbPath = createTempDbPath("cached-quote-over-financial-snapshot");
    const persistence = new AppPersistence(dbPath);
    const now = Date.parse("2026-05-13T21:00:00Z");
    const old = Date.parse("2026-05-09T14:13:30Z");

    persistence.resources.set(
      {
        namespace: "market",
        kind: "financials",
        entityKey: "contract:14016494",
        variantKey: "exchange=JPX",
        sourceKey: "provider:yahoo",
      },
      makeFinancials({
        quote: makeQuote({
          symbol: "6315.T",
          providerId: "yahoo",
          price: 3380,
          currency: "JPY",
          change: 75,
          changePercent: 2.27,
          lastUpdated: old,
          marketState: "CLOSED",
          exchangeName: "JPX",
          listingExchangeName: "JPX",
        }),
        fundamentals: {
          sharesOutstanding: 75_000_462,
          trailingPE: 37.2,
        },
      }),
      {
        cachePolicy: { staleMs: 60_000, expireMs: 7 * 24 * 60 * 60_000 },
        fetchedAt: old,
      },
    );
    persistence.resources.set(
      {
        namespace: "market",
        kind: "quote",
        entityKey: "contract:14016494",
        variantKey: "exchange=JPX",
        sourceKey: "provider:yahoo",
      },
      makeQuote({
        symbol: "6315.T",
        providerId: "yahoo",
        price: 2688,
        currency: "JPY",
        change: 13,
        changePercent: 0.49,
        lastUpdated: now,
        marketState: "CLOSED",
        exchangeName: "JPX",
        listingExchangeName: "JPX",
      }),
      {
        cachePolicy: { staleMs: 60_000, expireMs: 7 * 24 * 60 * 60_000 },
        fetchedAt: now,
      },
    );

    const router = new AssetDataRouter({
      ...fallbackProvider,
      id: "yahoo",
      name: "Yahoo",
      async getTickerFinancials() {
        throw new Error("should not fetch financials");
      },
    }, [], persistence.resources);

    const cached = router.getCachedFinancialsForTargets([{
      symbol: "6315.T",
      exchange: "JPX",
      instrument: {
        brokerId: "ibkr",
        brokerInstanceId: "ibkr-live",
        conId: 14016494,
        symbol: "6315.T",
      },
    }], { allowExpired: true, includeStaleQuotes: true });

    expect(cached.get("6315.T")?.quote?.price).toBe(2688);
    expect(cached.get("6315.T")?.quote?.changePercent).toBe(0.49);
    expect(cached.get("6315.T")?.quote?.marketCap).toBe(201_601_241_856);
    expect(cached.get("6315.T")?.fundamentals?.trailingPE).toBe(37.2);

    persistence.close();
  });
});
