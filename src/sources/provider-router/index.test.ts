import { afterEach, describe, expect, test } from "bun:test";
import { AppPersistence } from "../../data/app-persistence";
import { AssetDataRouter } from "./index";
import { assetDataProvider } from "../../capabilities";
import type { BrokerAdapter } from "../../types/broker";
import type { DataProvider, QuoteSubscriptionTarget } from "../../types/data-provider";
import type { CapabilityRouteSource } from "../../types/capability-route-source";
import {
  attachTestRegistry,
  brokerInstance,
  cleanupProviderRouterTestFiles,
  createBrokerConfig,
  createTempDbPath,
  fallbackProvider,
  makeArticle,
  makeFinancials,
  makeQuote,
  setBrokerInstances,
} from "./test-support";

const originalConsoleError = console.error;

afterEach(() => {
  console.error = originalConsoleError;
  cleanupProviderRouterTestFiles();
});

describe("AssetDataRouter", () => {
  test("serves USD exchange rate locally without provider revalidation", async () => {
    let providerCalls = 0;
    const router = new AssetDataRouter({
      ...fallbackProvider,
      async getExchangeRate() {
        providerCalls += 1;
        return 1;
      },
    });

    const rate = await router.getExchangeRate("usd");
    await Promise.resolve();

    expect(rate).toBe(1);
    expect(providerCalls).toBe(0);
  });

  test("routes market calls only through sources with market capability", async () => {
    const newsOnlySource: CapabilityRouteSource = {
      id: "news-only",
      name: "News Only",
      priority: 1,
      news: {
        fetchNews: async () => {
          throw new Error("news-only source should not handle market requests");
        },
      },
    };
    const marketSource: CapabilityRouteSource = {
      id: "market-source",
      name: "Market Source",
      priority: 10,
      market: {
        ...fallbackProvider,
        id: "market-source",
        name: "Market Source",
        async getQuote(symbol) {
          return {
            symbol,
            providerId: "market-source",
            price: 250,
            currency: "USD",
            change: 1,
            changePercent: 0.4,
            lastUpdated: Date.now(),
          };
        },
      },
    };

    const router = new AssetDataRouter(fallbackProvider, [newsOnlySource, marketSource]);

    const quote = await router.getQuote("AAPL", "NASDAQ");

    expect(quote.providerId).toBe("market-source");
    expect(quote.price).toBe(250);
  });

  test("routes news calls only through sources with news capability", async () => {
    const article = makeArticle("source-news");
    const marketOnlySource: CapabilityRouteSource = {
      id: "market-only",
      name: "Market Only",
      priority: 1,
      market: {
        ...fallbackProvider,
        id: "market-only",
        name: "Market Only",
      },
    };
    const newsSource: CapabilityRouteSource = {
      id: "news-source",
      name: "News Source",
      priority: 10,
      news: {
        fetchNews: async () => [article],
      },
    };
    const router = new AssetDataRouter(null, [marketOnlySource, newsSource]);

    const articles = await router.getNews({ feed: "latest", limit: 10 });

    expect(articles).toEqual([article]);
  });

  test("falls back to later providers when holder data is empty", async () => {
    const cloudProvider: DataProvider = {
      ...fallbackProvider,
      id: "cloud",
      name: "Cloud",
      priority: 100,
      async getHolders(symbol) {
        return {
          providerId: "cloud",
          symbol,
          holders: [],
        };
      },
    };
    const yahooProvider: DataProvider = {
      ...fallbackProvider,
      id: "yahoo",
      name: "Yahoo",
      priority: 1000,
      async getHolders(symbol) {
        return {
          providerId: "yahoo",
          symbol,
          currency: "USD",
          holders: [{
            providerId: "yahoo",
            ownerType: "institution",
            name: "Vanguard Group Inc",
            shares: 1_200_000_000,
            value: 250_000_000_000,
            percentHeld: 0.08,
            changePercent: 0.02,
          }],
        };
      },
    };

    const router = new AssetDataRouter(yahooProvider, [cloudProvider]);
    const holders = await router.getHolders("AAPL", "NASDAQ");

    expect(holders.providerId).toBe("yahoo");
    expect(holders.holders[0]?.name).toBe("Vanguard Group Inc");
  });

  test("falls back to later analyst providers when rating targets are missing", async () => {
    const cloudProvider: DataProvider = {
      ...fallbackProvider,
      id: "cloud",
      name: "Cloud",
      priority: 100,
      async getAnalystResearch(symbol) {
        return {
          providerId: "cloud",
          symbol,
          ratings: [{ date: "2026-05-01", firm: "Cloud Firm", action: "Raises", current: "Buy", prior: "Buy" }],
          recommendations: [],
          earningsEstimates: [],
          revenueEstimates: [],
        };
      },
    };
    const yahooProvider: DataProvider = {
      ...fallbackProvider,
      id: "yahoo",
      name: "Yahoo",
      priority: 1000,
      async getAnalystResearch(symbol) {
        return {
          providerId: "yahoo",
          symbol,
          ratings: [{
            date: "2026-05-01",
            firm: "Yahoo Firm",
            action: "Raises",
            current: "Buy",
            prior: "Buy",
            currentPriceTarget: 680,
            priorPriceTarget: 595,
          }],
          recommendations: [],
          earningsEstimates: [],
          revenueEstimates: [],
        };
      },
    };

    const router = new AssetDataRouter(yahooProvider, [cloudProvider]);
    const research = await router.getAnalystResearch("AAPL", "NASDAQ");

    expect(research.providerId).toBe("yahoo");
    expect(research.ratings[0]?.currentPriceTarget).toBe(680);
    expect(research.ratings[0]?.priorPriceTarget).toBe(595);
  });

  test("prefers cached analyst records with rating targets", async () => {
    const dbPath = createTempDbPath("cached-analyst-targets");
    const persistence = new AppPersistence(dbPath);
    const cloudProvider: DataProvider = {
      ...fallbackProvider,
      id: "cloud",
      name: "Cloud",
      priority: 100,
      async getAnalystResearch(symbol) {
        return {
          providerId: "cloud",
          symbol,
          ratings: [{ date: "2026-05-01", firm: "Cloud Firm", action: "Raises", current: "Buy", prior: "Buy" }],
          recommendations: [],
          earningsEstimates: [],
          revenueEstimates: [],
        };
      },
    };
    const yahooProvider: DataProvider = {
      ...fallbackProvider,
      id: "yahoo",
      name: "Yahoo",
      priority: 1000,
      async getAnalystResearch(symbol) {
        return {
          providerId: "yahoo",
          symbol,
          ratings: [{
            date: "2026-05-01",
            firm: "Yahoo Firm",
            action: "Raises",
            current: "Buy",
            prior: "Buy",
            currentPriceTarget: 680,
            priorPriceTarget: 595,
          }],
          recommendations: [],
          earningsEstimates: [],
          revenueEstimates: [],
        };
      },
    };
    const unavailableProvider = (id: string, priority: number): DataProvider => ({
      ...fallbackProvider,
      id,
      name: id,
      priority,
      async getAnalystResearch() {
        throw new Error(`${id} should not be fetched`);
      },
    });

    try {
      const seedRouter = new AssetDataRouter(yahooProvider, [cloudProvider], persistence.resources);
      await seedRouter.getAnalystResearch("AAPL", "NASDAQ");

      const cachedRouter = new AssetDataRouter(
        unavailableProvider("yahoo", 1000),
        [unavailableProvider("cloud", 100)],
        persistence.resources,
      );
      const research = await cachedRouter.getAnalystResearch("AAPL", "NASDAQ");

      expect(research.providerId).toBe("yahoo");
      expect(research.ratings[0]?.currentPriceTarget).toBe(680);
      expect(research.ratings[0]?.priorPriceTarget).toBe(595);
    } finally {
      persistence.close();
    }
  });

  test("prefers broker quotes over fallback quotes", async () => {
    const router = new AssetDataRouter(fallbackProvider);
    const broker: BrokerAdapter = {
      id: "ibkr",
      name: "IBKR",
      configSchema: [],
      async validate() {
        return true;
      },
      async importPositions() {
        return [];
      },
      async getQuote() {
        return {
          symbol: "AAPL",
          price: 123.45,
          currency: "USD",
          change: 1,
          changePercent: 0.8,
          lastUpdated: Date.now(),
        };
      },
    };

    attachTestRegistry(router, { brokers: [["ibkr", broker]] });
    setBrokerInstances(router, [
      brokerInstance({
        config: { connectionMode: "gateway", gateway: { host: "127.0.0.1", port: 4002, clientId: 1 } },
      }),
    ]);

    const quote = await router.getQuote("AAPL", "NASDAQ", { brokerId: "ibkr", brokerInstanceId: "ibkr-work" });
    expect(quote.price).toBe(123.45);
  });

  test("prefers broker options chains for broker-context targets", async () => {
    const chain = {
      underlyingSymbol: "AAPL",
      expirationDates: [1_800_000_000],
      calls: [],
      puts: [],
    };
    const broker: BrokerAdapter = {
      id: "ibkr",
      name: "IBKR",
      configSchema: [],
      async validate() {
        return true;
      },
      async importPositions() {
        return [];
      },
      async getOptionsChain(ticker, _instance, exchange, expirationDate) {
        expect(ticker).toBe("AAPL");
        expect(exchange).toBe("NASDAQ");
        expect(expirationDate).toBe(1_800_000_000);
        return chain;
      },
    };
    const fallback: DataProvider = {
      ...fallbackProvider,
      async getOptionsChain() {
        throw new Error("fallback should not handle broker-context options");
      },
    };
    const router = new AssetDataRouter(fallback);
    attachTestRegistry(router, { brokers: [["ibkr", broker]] });
    setBrokerInstances(router, [brokerInstance()]);

    const result = await router.getOptionsChain("AAPL", "NASDAQ", 1_800_000_000, {
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-work",
    });

    expect(result).toBe(chain);
  });

  test("falls back to provider quotes when a broker mark is stale", async () => {
    const fixedNow = Date.parse("2026-05-13T21:00:00Z");
    const realDateNow = Date.now;
    Date.now = () => fixedNow;
    try {
      const yahooProvider: DataProvider = {
        ...fallbackProvider,
        id: "yahoo",
        name: "Yahoo",
        async getQuote(symbol) {
          return {
            symbol,
            providerId: "yahoo",
            price: 50_500,
            currency: "JPY",
            change: 4400,
            changePercent: 9.54,
            lastUpdated: Date.parse("2026-05-13T06:24:00Z"),
            listingExchangeName: "JPX",
            marketState: "CLOSED",
            dataSource: "delayed",
          };
        },
      };
      const router = new AssetDataRouter(yahooProvider);
      const broker: BrokerAdapter = {
        id: "ibkr",
        name: "IBKR",
        configSchema: [],
        async validate() {
          return true;
        },
        async importPositions() {
          return [];
        },
        async getQuote() {
          return {
            symbol: "285A.T",
            providerId: "ibkr",
            price: 46_100,
            currency: "JPY",
            change: 0,
            changePercent: 0,
            lastUpdated: Date.parse("2026-05-08T06:00:00Z"),
            dataSource: "delayed",
          };
        },
      };

      attachTestRegistry(router, { brokers: [["ibkr", broker]] });
      setBrokerInstances(router, [
        brokerInstance({
          config: { connectionMode: "gateway", gateway: { host: "127.0.0.1", port: 4002, clientId: 1 } },
        }),
      ]);

      const quote = await router.getQuote("285A.T", "TSEJ", { brokerId: "ibkr", brokerInstanceId: "ibkr-work" });
      expect(quote.providerId).toBe("yahoo");
      expect(quote.price).toBe(50_500);
    } finally {
      Date.now = realDateNow;
    }
  });

  test("prefers the requested broker instance in search results", async () => {
    const router = new AssetDataRouter(fallbackProvider);
    const broker: BrokerAdapter = {
      id: "ibkr",
      name: "IBKR",
      configSchema: [],
      async validate() {
        return true;
      },
      async importPositions() {
        return [];
      },
      async searchInstruments(_query, instance) {
        return [{
          providerId: "ibkr",
          symbol: instance.label === "Work" ? "AAPL" : "MSFT",
          name: `${instance.label} contract`,
          exchange: "NASDAQ",
          type: "STK",
          brokerContract: {
            brokerId: "ibkr",
            symbol: instance.label === "Work" ? "AAPL" : "MSFT",
            exchange: "SMART",
          },
        }];
      },
    };

    attachTestRegistry(router, { brokers: [["ibkr", broker]] });
    setBrokerInstances(router, [
      brokerInstance({
        config: { connectionMode: "gateway", gateway: { host: "127.0.0.1", port: 4002, clientId: 1 } },
      }),
      brokerInstance({
        id: "ibkr-personal",
        label: "Personal",
        config: { connectionMode: "gateway", gateway: { host: "127.0.0.1", port: 4003, clientId: 2 } },
      }),
    ]);

    const results = await router.search("AAPL", { preferBroker: true, brokerInstanceId: "ibkr-work" });
    expect(results[0]?.brokerInstanceId).toBe("ibkr-work");
    expect(results[0]?.brokerLabel).toBe("Work");
    expect(results[0]?.brokerContract?.brokerInstanceId).toBe("ibkr-work");
  });

  test("keeps the richer search result when providers return the same instrument", async () => {
    const broker: BrokerAdapter = {
      id: "ibkr",
      name: "IBKR",
      configSchema: [],
      async validate() {
        return true;
      },
      async importPositions() {
        return [];
      },
      async searchInstruments() {
        return [{
          providerId: "ibkr",
          symbol: "AAPL",
          name: "Apple Inc",
          exchange: "NASDAQ",
          type: "STK",
          brokerLabel: "Work",
          brokerContract: {
            brokerId: "ibkr",
            brokerInstanceId: "ibkr-work",
            symbol: "AAPL",
            localSymbol: "AAPL",
            exchange: "SMART",
          },
        }];
      },
    };
    const provider: DataProvider = {
      ...fallbackProvider,
      id: "yahoo",
      name: "Yahoo",
      async search() {
        return [{
          providerId: "yahoo",
          symbol: "AAPL",
          name: "Apple",
          exchange: "NASDAQ",
          type: "STK",
        }];
      },
    };
    const router = new AssetDataRouter(fallbackProvider, [provider]);

    attachTestRegistry(router, { brokers: [["ibkr", broker]] });
    setBrokerInstances(router, [
      brokerInstance({
        config: { connectionMode: "gateway", gateway: { host: "127.0.0.1", port: 4002, clientId: 1 } },
      }),
    ]);

    const results = await router.search("AAPL", { preferBroker: true, brokerInstanceId: "ibkr-work" });
    expect(results).toHaveLength(1);
    expect(results[0]?.providerId).toBe("ibkr");
    expect(results[0]?.brokerContract?.localSymbol).toBe("AAPL");
  });

  test("ignores disabled plugin sources when the registry filters them out", async () => {
    const router = new AssetDataRouter(fallbackProvider);
    attachTestRegistry(router);

    const quote = await router.getQuote("AAPL", "NASDAQ");
    expect(quote.price).toBe(100);
    expect(quote.providerId).toBeUndefined();
  });

  test("does not search fallback providers when the preferred provider returns results", async () => {
    let cloudCalls = 0;
    let yahooCalls = 0;
    const cloudProvider: DataProvider = {
      ...fallbackProvider,
      id: "cloud",
      name: "Cloud",
      priority: 100,
      async search() {
        cloudCalls += 1;
        return [{ providerId: "cloud", symbol: "SEC0", name: "iShares ETF", exchange: "XETRA", type: "ETF" }];
      },
    };
    const yahooProvider: DataProvider = {
      ...fallbackProvider,
      id: "yahoo",
      name: "Yahoo",
      priority: 1000,
      async search() {
        yahooCalls += 1;
        return [{ providerId: "yahoo", symbol: "SEC0", name: "iShares ETF", exchange: "XETRA", type: "ETF" }];
      },
    };

    const router = new AssetDataRouter(yahooProvider, [cloudProvider]);
    const results = await router.search("SEC0");

    expect(results[0]?.providerId).toBe("cloud");
    expect(cloudCalls).toBe(1);
    expect(yahooCalls).toBe(0);
  });

  test("routes through registered asset-data capabilities", async () => {
    const cloudProvider: DataProvider = {
      ...fallbackProvider,
      id: "cloud",
      name: "Cloud",
      priority: 10,
      async getQuote() {
        return {
          symbol: "AAPL",
          providerId: "cloud",
          price: 125,
          currency: "USD",
          change: 1,
          changePercent: 0.8,
          lastUpdated: Date.now(),
        };
      },
    };
    const router = new AssetDataRouter(fallbackProvider);
    attachTestRegistry(router, {
      getEnabledCapabilities: (kind?: string) => (
        kind === "asset-data" ? [assetDataProvider(cloudProvider)] : []
      ),
    });

    const quote = await router.getQuote("AAPL", "NASDAQ");
    expect(quote.price).toBe(125);
    expect(quote.providerId).toBe("cloud");
  });

  test("falls back when the preferred provider returns a stale quote", async () => {
    const fixedNow = Date.parse("2026-05-13T21:00:00Z");
    const realDateNow = Date.now;
    Date.now = () => fixedNow;
    try {
      const yahooProvider: DataProvider = {
        ...fallbackProvider,
        id: "yahoo",
        name: "Yahoo",
        async getQuote(symbol) {
          return {
            symbol,
            providerId: "yahoo",
            price: 168,
            currency: "TWD",
            change: 1,
            changePercent: 0.6,
            lastUpdated: Date.parse("2026-05-13T05:30:00Z"),
            listingExchangeName: "TWSE",
            marketState: "CLOSED",
            dataSource: "delayed",
          };
        },
      };
      const cloudProvider: DataProvider = {
        ...fallbackProvider,
        id: "gloomberb-cloud",
        name: "Cloud",
        priority: 100,
        async getQuote(symbol) {
          return {
            symbol,
            providerId: "gloomberb-cloud",
            price: 150,
            currency: "TWD",
            change: 0,
            changePercent: 0,
            lastUpdated: Date.parse("2026-05-08T06:00:00Z"),
            listingExchangeName: "TWSE",
            marketState: "CLOSED",
            dataSource: "delayed",
          };
        },
        async getQuotesBatch(targets) {
          return targets.map((target) => ({
            target,
            quote: {
              symbol: target.symbol,
              providerId: "gloomberb-cloud",
              price: 150,
              currency: "TWD",
              change: 0,
              changePercent: 0,
              lastUpdated: Date.parse("2026-05-08T06:00:00Z"),
              listingExchangeName: "TWSE",
              marketState: "CLOSED",
              dataSource: "delayed",
            },
          }));
        },
      };
      const router = new AssetDataRouter(yahooProvider, [cloudProvider]);

      const quote = await router.getQuote("2337", "TWSE");
      expect(quote.providerId).toBe("yahoo");
      expect(quote.price).toBe(168);

      const [batch] = await router.getQuotesBatch([{ symbol: "2337", exchange: "TWSE" }], { forceRefresh: true });
      expect(batch?.quote?.providerId).toBe("yahoo");
      expect(batch?.quote?.price).toBe(168);
    } finally {
      Date.now = realDateNow;
    }
  });

  test("prefers provider quote streams when one is available", () => {
    const brokerTargets: QuoteSubscriptionTarget[] = [];
    const providerTargets: QuoteSubscriptionTarget[] = [];
    let brokerUnsubscribed = 0;
    let providerUnsubscribed = 0;

    const broker: BrokerAdapter = {
      id: "ibkr",
      name: "IBKR",
      configSchema: [],
      async validate() {
        return true;
      },
      async importPositions() {
        return [];
      },
      subscribeQuotes(_instance, targets, onQuote) {
        brokerTargets.push(...targets);
        onQuote(targets[0]!, {
          symbol: "AAPL",
          price: 123.45,
          currency: "USD",
          change: 1,
          changePercent: 0.8,
          lastUpdated: Date.now(),
        });
        return () => {
          brokerUnsubscribed += 1;
        };
      },
    };
    const streamingProvider: DataProvider = {
      ...fallbackProvider,
      id: "cloud",
      name: "Cloud",
      subscribeQuotes(targets, onQuote) {
        providerTargets.push(...targets);
        onQuote(targets[0]!, {
          symbol: "MSFT",
          price: 456.78,
          currency: "USD",
          change: 2,
          changePercent: 0.4,
          lastUpdated: Date.now(),
        });
        return () => {
          providerUnsubscribed += 1;
        };
      },
    };

    const router = new AssetDataRouter(fallbackProvider, [streamingProvider]);
    attachTestRegistry(router, { brokers: [["ibkr", broker]] });
    setBrokerInstances(router, [brokerInstance()]);

    const seenSymbols: string[] = [];
    const unsubscribe = router.subscribeQuotes([
      {
        symbol: "AAPL",
        exchange: "NASDAQ",
        context: {
          brokerId: "ibkr",
          brokerInstanceId: "ibkr-work",
        },
      },
      {
        symbol: "MSFT",
        exchange: "NASDAQ",
      },
    ], (target) => {
      seenSymbols.push(target.symbol);
    });

    expect(brokerTargets).toEqual([]);
    expect(providerTargets).toEqual([
      {
        symbol: "AAPL",
        exchange: "NASDAQ",
        context: {
          brokerId: "ibkr",
          brokerInstanceId: "ibkr-work",
        },
      },
      {
        symbol: "MSFT",
        exchange: "NASDAQ",
      },
    ]);
    expect(seenSymbols).toEqual(["AAPL"]);

    unsubscribe();
    expect(brokerUnsubscribed).toBe(0);
    expect(providerUnsubscribed).toBe(1);
  });

  test("can force broker-linked targets onto provider streaming", () => {
    const brokerTargets: QuoteSubscriptionTarget[] = [];
    const providerTargets: QuoteSubscriptionTarget[] = [];

    const broker: BrokerAdapter = {
      id: "ibkr",
      name: "IBKR",
      configSchema: [],
      async validate() {
        return true;
      },
      async importPositions() {
        return [];
      },
      subscribeQuotes(_instance, targets) {
        brokerTargets.push(...targets);
        return () => {};
      },
    };
    const streamingProvider: DataProvider = {
      ...fallbackProvider,
      id: "cloud",
      name: "Cloud",
      subscribeQuotes(targets) {
        providerTargets.push(...targets);
        return () => {};
      },
    };

    const router = new AssetDataRouter(fallbackProvider, [streamingProvider]);
    attachTestRegistry(router, { brokers: [["ibkr", broker]] });
    setBrokerInstances(router, [brokerInstance()]);

    const unsubscribe = router.subscribeQuotes([{
      symbol: "AAPL",
      exchange: "NASDAQ",
      route: "provider",
      context: {
        brokerId: "ibkr",
        brokerInstanceId: "ibkr-work",
      },
    }], () => {});

    expect(brokerTargets).toEqual([]);
    expect(providerTargets).toEqual([{
      symbol: "AAPL",
      exchange: "NASDAQ",
      route: "provider",
      context: {
        brokerId: "ibkr",
        brokerInstanceId: "ibkr-work",
      },
    }]);

    unsubscribe();
  });

  test("returns quote-only financials for option tickers when snapshots are unavailable", async () => {
    const router = new AssetDataRouter({
      ...fallbackProvider,
      async getTickerFinancials() {
        return makeFinancials();
      },
      async getQuote(ticker) {
        return makeQuote({
          symbol: ticker,
          price: 252.375,
          change: 1.5,
          changePercent: 0.6,
          bid: 250.25,
          ask: 254.5,
          mark: 252.375,
          providerId: "gloomberb-cloud",
          dataSource: "delayed",
        });
      },
    });

    const financials = await router.getTickerFinancials("AMD   270917C00230000");

    expect(financials.quote?.symbol).toBe("AMD   270917C00230000");
    expect(financials.quote?.mark).toBe(252.375);
    expect(financials.annualStatements).toEqual([]);
    expect(financials.priceHistory).toEqual([]);
  });

  test("merges cached broker financials with cached fallback fundamentals", async () => {
    const dbPath = createTempDbPath("cache-merge");
    const persistence = new AppPersistence(dbPath);
    const providerCalls = { broker: 0, fallback: 0 };
    const router = new AssetDataRouter({
      ...fallbackProvider,
      async getTickerFinancials() {
        providerCalls.fallback += 1;
        return makeFinancials({
          annualStatements: [{ date: "2025-12-31", totalRevenue: 1000 }],
          quarterlyStatements: [{ date: "2025-12-31", totalRevenue: 250 }],
          fundamentals: { revenue: 1000, netIncome: 200 },
        });
      },
    }, [], persistence.resources);
    const broker: BrokerAdapter = {
      id: "ibkr",
      name: "IBKR",
      configSchema: [],
      async validate() {
        return true;
      },
      async importPositions() {
        return [];
      },
      async getTickerFinancials() {
        providerCalls.broker += 1;
        return makeFinancials({
          quote: makeQuote({
            price: 125,
            change: 2,
            changePercent: 1.6,
          }),
          fundamentals: {},
        });
      },
    };

    attachTestRegistry(router, { brokers: [["ibkr", broker]] });
    setBrokerInstances(router, [brokerInstance()]);

    const merged = await router.getTickerFinancials("AAPL", "NASDAQ", {
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-work",
    });
    expect(merged.quote?.price).toBe(125);
    expect(merged.fundamentals?.revenue).toBe(1000);
    expect(providerCalls.broker).toBe(1);
    expect(providerCalls.fallback).toBe(1);

    const cached = router.getCachedFinancialsForTargets([{
      symbol: "AAPL",
      exchange: "NASDAQ",
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-work",
    }], { allowExpired: true });
    expect(cached.get("AAPL")?.quote?.price).toBe(125);
    expect(cached.get("AAPL")?.fundamentals?.revenue).toBe(1000);
    persistence.close();
  });

  test("keeps broker price authority when a fallback quote is off by a likely 100x unit mismatch", async () => {
    const router = new AssetDataRouter({
      ...fallbackProvider,
      async getTickerFinancials() {
        return makeFinancials({
          priceHistory: [{ date: new Date("2026-03-28T00:00:00Z"), close: 0.245 }],
          quote: makeQuote({
            symbol: "IQE.L",
            providerId: "yahoo",
            price: 0.245,
            currency: "GBP",
            change: -0.021,
            changePercent: -7.89,
            dataSource: "delayed",
          }),
          fundamentals: { revenue: 1000 },
        });
      },
    });
    const broker: BrokerAdapter = {
      id: "ibkr",
      name: "IBKR",
      configSchema: [],
      async validate() {
        return true;
      },
      async importPositions() {
        return [];
      },
      async getTickerFinancials() {
        return makeFinancials({
          priceHistory: [{ date: new Date("2026-03-28T00:00:00Z"), close: 24.5 }],
          quote: makeQuote({
            symbol: "IQE",
            providerId: "ibkr",
            price: 24.5,
            currency: "GBP",
            change: -2.1,
            changePercent: -7.89,
            dataSource: "live",
          }),
          fundamentals: { netIncome: 200 },
        });
      },
    };

    attachTestRegistry(router, { brokers: [["ibkr", broker]] });
    setBrokerInstances(router, [brokerInstance()]);

    const merged = await router.getTickerFinancials("IQE", "LSE", {
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-work",
    });

    expect(merged.quote?.price).toBe(24.5);
    expect(merged.quote?.provenance?.rejectedPriceProviders).toContain("yahoo");
    expect(merged.priceHistory[0]?.close).toBe(0.245);
    expect(merged.fundamentals?.netIncome).toBe(200);
  });

  test("preserves fallback profile data when broker already has fundamentals", async () => {
    const router = new AssetDataRouter({
      ...fallbackProvider,
      async getTickerFinancials() {
        return makeFinancials({
          profile: {
            description: "Builds hardware and software.",
            sector: "Technology",
            industry: "Consumer Electronics",
          },
        });
      },
    });
    const broker: BrokerAdapter = {
      id: "ibkr",
      name: "IBKR",
      configSchema: [],
      async validate() {
        return true;
      },
      async importPositions() {
        return [];
      },
      async getTickerFinancials() {
        return makeFinancials({
          fundamentals: { revenue: 1000, netIncome: 200 },
        });
      },
    };

    attachTestRegistry(router, { brokers: [["ibkr", broker]] });
    setBrokerInstances(router, [brokerInstance()]);

    const merged = await router.getTickerFinancials("AAPL", "NASDAQ", {
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-work",
    });
    expect(merged.fundamentals?.revenue).toBe(1000);
    expect(merged.profile?.description).toBe("Builds hardware and software.");
    expect(merged.profile?.sector).toBe("Technology");
  });

  test("merges fallback provider statement arrays without taking over preferred financials", async () => {
    const cloudProvider: DataProvider = {
      ...fallbackProvider,
      id: "cloud",
      name: "Cloud",
      priority: 100,
      async getTickerFinancials() {
        return makeFinancials({
          quote: makeQuote({
            price: 125,
            change: 2,
            changePercent: 1.6,
          }),
          fundamentals: {
            trailingPE: 25,
          },
        });
      },
    };
    let yahooCalls = 0;
    const yahooProvider: DataProvider = {
      ...fallbackProvider,
      id: "yahoo",
      name: "Yahoo",
      priority: 1000,
      async getTickerFinancials() {
        yahooCalls += 1;
        return makeFinancials({
          annualStatements: [{ date: "2025-12-31", totalRevenue: 391035000000 }],
          quarterlyStatements: [{ date: "2026-03-31", totalRevenue: 95359000000 }],
          priceHistory: [{ date: new Date("2026-03-28T00:00:00Z"), close: 124 }],
          quote: makeQuote({
            price: 124,
            change: 1,
            changePercent: 0.8,
            marketCap: 2_000_000_000,
          }),
          fundamentals: {
            forwardPE: 22,
          },
        });
      },
    };

    const router = new AssetDataRouter(yahooProvider, [cloudProvider]);
    const merged = await router.getTickerFinancials("AAPL", "NASDAQ");

    expect(merged.quote?.price).toBe(125);
    expect(merged.quote?.marketCap).toBeUndefined();
    expect(merged.fundamentals?.trailingPE).toBe(25);
    expect(merged.fundamentals?.forwardPE).toBeUndefined();
    expect(merged.priceHistory).toEqual([]);
    expect(merged.annualStatements).toEqual([{ date: "2025-12-31", totalRevenue: 391035000000 }]);
    expect(merged.quarterlyStatements).toEqual([{ date: "2026-03-31", totalRevenue: 95359000000 }]);
    expect(yahooCalls).toBe(1);
  });

  test("fills missing preferred statement fields from richer fallback rows", async () => {
    const cloudProvider: DataProvider = {
      ...fallbackProvider,
      id: "cloud",
      name: "Cloud",
      priority: 100,
      async getTickerFinancials() {
        return makeFinancials({
          annualStatements: [{ date: "2025-12-31", totalRevenue: 1000 }],
          quote: makeQuote({
            symbol: "AMD",
            price: 125,
            change: 2,
            changePercent: 1.6,
          }),
        });
      },
    };
    let yahooCalls = 0;
    const yahooProvider: DataProvider = {
      ...fallbackProvider,
      id: "yahoo",
      name: "Yahoo",
      priority: 1000,
      async getTickerFinancials() {
        yahooCalls += 1;
        return makeFinancials({
          annualStatements: [{
            date: "2025-12-31",
            totalRevenue: 900,
            accountsReceivable: 250,
            inventory: 125,
          }],
        });
      },
    };

    const router = new AssetDataRouter(yahooProvider, [cloudProvider]);
    const merged = await router.getTickerFinancials("AMD", "NASDAQ");

    expect(merged.quote?.price).toBe(125);
    expect(merged.annualStatements).toEqual([{
      date: "2025-12-31",
      totalRevenue: 1000,
      accountsReceivable: 250,
      inventory: 125,
    }]);
    expect(yahooCalls).toBe(1);
  });

  test("caches the preferred provider financial snapshot without merging fallback snapshots", async () => {
    const dbPath = createTempDbPath("cached-provider-financial-preferred");
    const persistence = new AppPersistence(dbPath);

    const cloudProvider: DataProvider = {
      ...fallbackProvider,
      id: "cloud",
      name: "Cloud",
      priority: 100,
      async getTickerFinancials() {
        return makeFinancials({
          quote: makeQuote({
            price: 125,
            change: 2,
            changePercent: 1.6,
          }),
          fundamentals: {
            trailingPE: 25,
          },
          profile: {
            sector: "Technology",
          },
        });
      },
    };
    const yahooProvider: DataProvider = {
      ...fallbackProvider,
      id: "yahoo",
      name: "Yahoo",
      priority: 1000,
      async getTickerFinancials() {
        return makeFinancials({
          priceHistory: [{ date: new Date("2026-03-28T00:00:00Z"), close: 124 }],
          quote: makeQuote({
            price: 124,
            change: 1,
            changePercent: 0.8,
            marketCap: 2_000_000_000,
          }),
          fundamentals: {
            forwardPE: 22,
          },
        });
      },
    };

    const seedRouter = new AssetDataRouter(yahooProvider, [cloudProvider], persistence.resources);
    const seeded = await seedRouter.getTickerFinancials("AAPL", "NASDAQ");
    expect(seeded.quote?.price).toBe(125);
    expect(seeded.quote?.marketCap).toBeUndefined();

    let cloudCalls = 0;
    let yahooCalls = 0;
    const cachedRouter = new AssetDataRouter({
      ...yahooProvider,
      async getTickerFinancials() {
        yahooCalls += 1;
        throw new Error("expected cached yahoo financials");
      },
    }, [{
      ...cloudProvider,
      async getTickerFinancials() {
        cloudCalls += 1;
        throw new Error("expected cached cloud financials");
      },
    }], persistence.resources);

    const cached = await cachedRouter.getTickerFinancials("AAPL", "NASDAQ");

    expect(cloudCalls).toBe(0);
    expect(yahooCalls).toBe(0);
    expect(cached.quote?.price).toBe(125);
    expect(cached.quote?.marketCap).toBeUndefined();
    expect(cached.fundamentals?.trailingPE).toBe(25);
    expect(cached.fundamentals?.forwardPE).toBeUndefined();
    expect(cached.profile?.sector).toBe("Technology");
    expect(cached.priceHistory).toEqual([]);

    persistence.close();
  });

  test("refreshes missing profile data even when cached financials exist", async () => {
    const dbPath = createTempDbPath("cache-profile-refresh");
    const persistence = new AppPersistence(dbPath);

    const broker: BrokerAdapter = {
      id: "ibkr",
      name: "IBKR",
      configSchema: [],
      async validate() {
        return true;
      },
      async importPositions() {
        return [];
      },
      async getTickerFinancials() {
        return makeFinancials({
          fundamentals: { revenue: 1000, netIncome: 200 },
        });
      },
    };

    const config = createBrokerConfig([brokerInstance()]);

    const seedRouter = new AssetDataRouter({
      ...fallbackProvider,
      async getTickerFinancials() {
        return makeFinancials();
      },
    }, [], persistence.resources);
    attachTestRegistry(seedRouter, { brokers: [["ibkr", broker]] });
    seedRouter.setConfigAccessor(() => config);

    const seeded = await seedRouter.getTickerFinancials("PSTG", "NYSE", {
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-work",
    });
    expect(seeded.profile).toBeUndefined();

    const refreshedRouter = new AssetDataRouter({
      ...fallbackProvider,
      async getTickerFinancials() {
        return makeFinancials({
          profile: {
            description: "Provides enterprise data storage platforms.",
            sector: "Technology",
            industry: "Computer Hardware",
          },
        });
      },
    }, [], persistence.resources);
    attachTestRegistry(refreshedRouter, { brokers: [["ibkr", broker]] });
    refreshedRouter.setConfigAccessor(() => config);

    const refreshed = await refreshedRouter.getTickerFinancials("PSTG", "NYSE", {
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-work",
    });
    expect(refreshed.fundamentals?.revenue).toBe(1000);
    expect(refreshed.profile?.description).toBe("Provides enterprise data storage platforms.");

    persistence.close();
  });

  test("does not reuse another broker instance's financials when a specific instance is requested", async () => {
    const dbPath = createTempDbPath("instance-scoped-financials");
    const persistence = new AppPersistence(dbPath);
    const router = new AssetDataRouter({
      ...fallbackProvider,
      async getTickerFinancials() {
        return makeFinancials({
          quote: makeQuote({
            symbol: "IQE.L",
            providerId: "yahoo",
            price: 0.245,
            currency: "GBP",
            dataSource: "delayed",
          }),
        });
      },
    }, [], persistence.resources);
    const broker: BrokerAdapter = {
      id: "ibkr",
      name: "IBKR",
      configSchema: [],
      async validate() {
        return true;
      },
      async importPositions() {
        return [];
      },
      async getTickerFinancials(_ticker, instance) {
        if (instance.id === "ibkr-flex") {
          throw new Error("Gateway mode is required for broker market data");
        }
        return makeFinancials({
          quote: makeQuote({
            symbol: "IQE",
            providerId: "ibkr",
            price: 24.5,
            currency: "GBP",
            dataSource: "live",
          }),
        });
      },
    };

    attachTestRegistry(router, { brokers: [["ibkr", broker]] });
    setBrokerInstances(router, [
      brokerInstance({ id: "ibkr-flex", label: "Flex", connectionMode: "flex" }),
      brokerInstance({ id: "ibkr-live", label: "Live" }),
    ]);

    const live = await router.getTickerFinancials("IQE", "LSE", {
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-live",
    });
    expect(live.quote?.price).toBe(24.5);

    const flex = await router.getTickerFinancials("IQE", "LSE", {
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-flex",
    });
    expect(flex.quote?.price).toBe(0.245);

    const cached = router.getCachedFinancialsForTargets([{
      symbol: "IQE",
      exchange: "LSE",
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-flex",
    }], { allowExpired: true });
    expect(cached.get("IQE")?.quote?.price).toBe(0.245);

    persistence.close();
  });

  test("returns merged cached provider financials on cold start when sub-unit quotes exist", async () => {
    const dbPath = createTempDbPath("cached-sub-unit-financials");
    const persistence = new AppPersistence(dbPath);
    const now = Date.now();

    persistence.resources.set(
      {
        namespace: "market",
        kind: "financials",
        entityKey: "contract:14075064",
        variantKey: "exchange=LSE",
        sourceKey: "provider:gloomberb-cloud",
      },
      makeFinancials({
        quote: makeQuote({
          symbol: "IQE",
          price: 23.1,
          currency: "GBp",
          change: -1.4,
          changePercent: -5.71,
          previousClose: 24.5,
          lastUpdated: now,
          dataSource: "delayed",
        }),
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
        entityKey: "contract:14075064",
        variantKey: "exchange=LSE",
        sourceKey: "provider:yahoo",
      },
      makeFinancials({
        quote: makeQuote({
          symbol: "IQE.L",
          providerId: "yahoo",
          price: 0.231,
          currency: "GBP",
          change: -0.014,
          changePercent: -5.71,
          previousClose: 0.245,
          lastUpdated: now,
          dataSource: "delayed",
        }),
        fundamentals: {
          revenue: 1000,
        },
      }),
      {
        cachePolicy: { staleMs: 60_000, expireMs: 60_000 },
        fetchedAt: now,
      },
    );

    const yahooProvider: DataProvider = {
      ...fallbackProvider,
      id: "yahoo",
      name: "Yahoo",
      priority: 200,
      async getTickerFinancials() {
        throw new Error("should not fetch yahoo financials");
      },
    };
    const cloudProvider: DataProvider = {
      ...fallbackProvider,
      id: "gloomberb-cloud",
      name: "Cloud",
      priority: 100,
      async getTickerFinancials() {
        throw new Error("should not fetch cloud financials");
      },
    };
    const router = new AssetDataRouter(yahooProvider, [cloudProvider], persistence.resources);

    const financials = await router.getTickerFinancials("IQE", "LSE", {
      instrument: {
        brokerId: "ibkr",
        brokerInstanceId: "ibkr-personal",
        conId: 14075064,
        symbol: "IQE",
      },
    });

    expect(financials.quote?.price).toBe(0.231);
    expect(financials.quote?.currency).toBe("GBP");
    expect(financials.fundamentals?.revenue).toBe(1000);
    expect(financials.profile?.description).toBe("Cloud profile");

    persistence.close();
  });

});
