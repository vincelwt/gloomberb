import { afterEach, describe, expect, test } from "bun:test";
import { createGloomberbCloudNewsSource, GloomberbCloudProvider } from "./gloomberb-cloud";
import { apiClient, type AuthUser } from "../utils/api-client";

const verifiedUser: AuthUser = {
  id: "user-1",
  name: "Test User",
  email: "test@example.com",
  username: "test",
  emailVerified: true,
  image: null,
  createdAt: "2026-03-30T00:00:00.000Z",
  updatedAt: "2026-03-30T00:00:00.000Z",
};

const originalEnsureVerifiedSession = apiClient.ensureVerifiedSession.bind(apiClient);
const originalGetCloudHistory = apiClient.getCloudHistory.bind(apiClient);
const originalGetCloudQuote = apiClient.getCloudQuote.bind(apiClient);
const originalGetCloudNews = apiClient.getCloudNews.bind(apiClient);
const originalSubscribeQuotes = apiClient.subscribeQuotes.bind(apiClient);

afterEach(() => {
  apiClient.ensureVerifiedSession = originalEnsureVerifiedSession;
  apiClient.getCloudHistory = originalGetCloudHistory;
  apiClient.getCloudQuote = originalGetCloudQuote;
  apiClient.getCloudNews = originalGetCloudNews;
  apiClient.subscribeQuotes = originalSubscribeQuotes;
});

describe("GloomberbCloudProvider", () => {
  test("reports its manual chart resolution capabilities", () => {
    const provider = new GloomberbCloudProvider();
    expect(provider.getChartResolutionCapabilities()).toEqual(["1m", "5m", "15m", "30m", "45m", "1h", "1d", "1wk", "1mo"]);
  });

  test("fetches detailed intraday chart history with Twelve Data intervals", async () => {
    apiClient.ensureVerifiedSession = async () => verifiedUser;

    const requestArgs: { current: { symbol: string; exchange: string; params: Record<string, string | number | undefined> } | null } = { current: null };
    apiClient.getCloudHistory = async (symbol, exchange, params = {}) => {
      requestArgs.current = { symbol, exchange, params };
      return {
        status: "success",
        data: [{
          date: "2026-03-27 10:15:00",
          close: 250.12,
        }],
      };
    };

    const provider = new GloomberbCloudProvider();
    const history = await provider.getDetailedPriceHistory(
      "AAPL",
      "NASDAQ",
      new Date(2026, 2, 27, 10, 0, 0),
      new Date(2026, 2, 27, 12, 0, 0),
      "15m",
    );

    expect(requestArgs.current).toEqual({
      symbol: "AAPL",
      exchange: "NASDAQ",
      params: {
        interval: "15min",
        startDate: "2026-03-27 10:00:00",
        endDate: "2026-03-27 12:00:00",
      },
    });
    expect(history).toHaveLength(1);
    expect(history[0]?.close).toBe(250.12);
  });

  test("normalizes daily detailed history requests to 1day", async () => {
    apiClient.ensureVerifiedSession = async () => verifiedUser;

    const requestArgs: { current: Record<string, string | number | undefined> | null } = { current: null };
    apiClient.getCloudHistory = async (_symbol, _exchange, params = {}) => {
      requestArgs.current = params;
      return {
        status: "success",
        data: [],
      };
    };

    const provider = new GloomberbCloudProvider();
    await provider.getDetailedPriceHistory(
      "AAPL",
      "NASDAQ",
      new Date(2026, 0, 1, 0, 0, 0),
      new Date(2026, 2, 27, 0, 0, 0),
      "1d",
    );

    expect(requestArgs.current).toEqual({
      interval: "1day",
      startDate: "2026-01-01",
      endDate: "2026-03-27",
    });
  });

  test("fetches fixed-resolution chart history with the requested interval", async () => {
    apiClient.ensureVerifiedSession = async () => verifiedUser;

    const requestArgs: { current: Record<string, string | number | undefined> | null } = { current: null };
    apiClient.getCloudHistory = async (_symbol, _exchange, params = {}) => {
      requestArgs.current = params;
      return {
        status: "success",
        data: [{
          date: "2026-03-27",
          close: 250.12,
        }],
      };
    };

    const provider = new GloomberbCloudProvider();
    const history = await provider.getPriceHistoryForResolution("AAPL", "NASDAQ", "1Y", "1wk");

    expect(requestArgs.current?.interval).toBe("1week");
    expect(requestArgs.current?.startDate).toBeDefined();
    expect(requestArgs.current?.endDate).toBeDefined();
    expect(history[0]?.close).toBe(250.12);
  });

  test("normalizes sub-unit cloud quotes to their main currency", async () => {
    apiClient.ensureVerifiedSession = async () => verifiedUser;
    apiClient.getCloudQuote = async () => ({
      status: "success",
      data: {
        symbol: "IQE",
        providerId: "gloomberb-cloud",
        price: 23.1,
        currency: "GBp",
        change: -1.4,
        changePercent: -5.71,
        previousClose: 24.5,
        lastUpdated: Date.now(),
        dataSource: "delayed",
      },
    });

    const provider = new GloomberbCloudProvider();
    const quote = await provider.getQuote("IQE", "LSE");

    expect(quote.currency).toBe("GBP");
    expect(quote.price).toBeCloseTo(0.231, 8);
    expect(quote.change).toBeCloseTo(-0.014, 8);
    expect(quote.previousClose).toBeCloseTo(0.245, 8);
  });

  test("normalizes sub-unit cloud history using the response currency metadata", async () => {
    apiClient.ensureVerifiedSession = async () => verifiedUser;
    apiClient.getCloudHistory = async () => ({
      status: "success",
      providerMeta: {
        currency: "GBp",
      },
      data: [{
        date: "2026-03-27 10:15:00",
        open: 22.55,
        high: 23.4,
        low: 22.1,
        close: 23.1,
      }],
    });

    const provider = new GloomberbCloudProvider();
    const history = await provider.getPriceHistory("IQE", "LSE", "1Y");

    expect(history[0]?.open).toBeCloseTo(0.2255, 8);
    expect(history[0]?.high).toBeCloseTo(0.234, 8);
    expect(history[0]?.low).toBeCloseTo(0.221, 8);
    expect(history[0]?.close).toBeCloseTo(0.231, 8);
  });

  test("preserves original target context when streaming quotes", () => {
    let unsubscribeCalled = false;
    const seenQuotes: Array<{ price: number; currency: string }> = [];
    apiClient.subscribeQuotes = (_targets, onQuote) => {
      onQuote(
        { symbol: "AAPL", exchange: "NASDAQ" },
        {
          symbol: "AAPL",
          providerId: "gloomberb-cloud",
          price: 23.1,
          currency: "GBp",
          change: -1.4,
          changePercent: 0.5,
          lastUpdated: Date.now(),
          dataSource: "live",
        },
      );
      return () => {
        unsubscribeCalled = true;
      };
    };

    const provider = new GloomberbCloudProvider();
    const seenTargets: Array<{ brokerId?: string; brokerInstanceId?: string }> = [];
    const unsubscribe = provider.subscribeQuotes([{
      symbol: "AAPL",
      exchange: "NASDAQ",
      context: {
        brokerId: "ibkr",
        brokerInstanceId: "ibkr-live",
      },
    }], (target, quote) => {
      seenTargets.push({
        brokerId: target.context?.brokerId,
        brokerInstanceId: target.context?.brokerInstanceId,
      });
      seenQuotes.push({
        price: quote.price,
        currency: quote.currency,
      });
    });

    expect(seenTargets).toEqual([{
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-live",
    }]);
    expect(seenQuotes).toEqual([{
      price: 0.231,
      currency: "GBP",
    }]);

    unsubscribe();
    expect(unsubscribeCalled).toBe(true);
  });

  test("maps backend news stories without requiring verified market-data access", async () => {
    type CloudNewsRequest = NonNullable<Parameters<typeof apiClient.getCloudNews>[0]>;
    let verifyCalled = false;
    const requestArgs: { current: CloudNewsRequest | null } = { current: null };
    apiClient.ensureVerifiedSession = async () => {
      verifyCalled = true;
      return verifiedUser;
    };
    apiClient.getCloudNews = async (params = {}) => {
      requestArgs.current = params;
      return {
        items: [{
          id: "story-1",
          headline: "Apple raises guidance",
          summary: "Apple lifted its outlook after stronger iPhone demand.",
          topic: "guidance",
          topics: ["guidance"],
          category: "guidance",
          sentiment: "positive",
          sectors: ["information_technology"],
          firstPublishedAt: "2026-04-01T10:00:00.000Z",
          lastPublishedAt: "2026-04-01T10:05:00.000Z",
          firstSeenAt: "2026-04-01T10:00:10.000Z",
          lastSeenAt: "2026-04-01T10:05:10.000Z",
          primaryUrl: "https://example.com/aapl-guidance",
          primarySource: "example-wire",
          scores: {
            importance: 91,
            urgency: 74,
            marketImpact: 88,
            novelty: 86,
            confidence: 95,
          },
          flags: {
            breaking: true,
            developing: false,
            stale: false,
          },
          variantCount: 1,
          sourceCount: 1,
          sources: ["example-wire"],
          entities: [],
          tickerLinks: [{
            symbol: "AAPL",
            exchange: "XNAS",
            canonicalTicker: "AAPL:XNAS",
            relationType: "direct",
            displayTier: "primary",
            confidence: 0.98,
            relevanceScore: 95,
            impactScore: 93,
            sentiment: "positive",
          }],
        }],
        nextCursor: null,
      };
    };

    const provider = new GloomberbCloudProvider();
    const news = await provider.getNews("AAPL", 10, "NASDAQ");

    expect(verifyCalled).toBe(false);
    expect(requestArgs.current).toEqual({ feed: "ticker", ticker: "AAPL", exchange: "XNAS", tickerTier: "primary", limit: 10 });
    expect(news).toEqual([{
      title: "Apple raises guidance",
      url: "https://example.com/aapl-guidance",
      source: "example-wire",
      publishedAt: new Date("2026-04-01T10:05:00.000Z"),
      summary: "Apple lifted its outlook after stronger iPhone demand.",
    }]);
  });

  test("maps news ticker labels from validated story links only", async () => {
    apiClient.getCloudNews = async () => ({
      items: [{
        id: "story-1",
        headline: "Sanofi reports vaccine update",
        summary: "Sanofi and Moderna shared new vaccine data.",
        topic: "product_approval",
        topics: ["product_approval"],
        category: "product_approval",
        sentiment: "positive",
        sectors: ["health_care"],
        firstPublishedAt: "2026-04-01T10:00:00.000Z",
        lastPublishedAt: "2026-04-01T10:05:00.000Z",
        firstSeenAt: "2026-04-01T10:00:10.000Z",
        lastSeenAt: "2026-04-01T10:05:10.000Z",
        primaryUrl: "https://example.com/sny-vaccine",
        primarySource: "example-wire",
        scores: {
          importance: 77,
          urgency: 66,
          marketImpact: 82,
          novelty: 71,
          confidence: 93,
        },
        flags: {
          breaking: false,
          developing: false,
          stale: false,
        },
        variantCount: 1,
        sourceCount: 1,
        sources: ["example-wire"],
        entities: [{
          id: "entity-1",
          entityType: "company",
          name: "Sanofi",
          symbol: "SNY",
          exchange: "NASDAQ",
          canonicalTicker: "SNY:NASDAQ",
          role: null,
          confidence: 0.95,
        }, {
          id: "entity-2",
          entityType: "company",
          name: "Noise Corp",
          symbol: "NOISE",
          exchange: "OTC",
          canonicalTicker: "NOISE:OTC",
          role: null,
          confidence: 0.6,
        }],
        tickerLinks: [{
          symbol: "SNY",
          exchange: "NASDAQ",
          canonicalTicker: "SNY:NASDAQ",
          relationType: "direct",
          displayTier: "primary",
          confidence: 0.98,
          relevanceScore: 95,
          impactScore: 88,
          sentiment: "positive",
        }, {
          symbol: "SNY",
          exchange: "NASDAQ",
          canonicalTicker: "SNY:NASDAQ",
          relationType: "direct",
          displayTier: "primary",
          confidence: 0.98,
          relevanceScore: 95,
          impactScore: 88,
          sentiment: "positive",
        }, {
          symbol: "MRNA",
          exchange: "NASDAQ",
          canonicalTicker: "MRNA:NASDAQ",
          relationType: "competitor",
          displayTier: "related",
          confidence: 0.8,
          relevanceScore: 65,
          impactScore: 54,
          sentiment: "neutral",
        }],
      }],
      nextCursor: null,
    });

    const source = createGloomberbCloudNewsSource();
    const news = await source.fetchNews({ feed: "top", ticker: "SNY" });

    expect(news[0]?.tickers).toEqual(["SNY:NASDAQ", "MRNA:NASDAQ"]);
    expect(news[0]?.importance).toBe(77);
    expect(news[0]?.scores).toEqual({
      importance: 77,
      urgency: 66,
      marketImpact: 82,
      novelty: 71,
      confidence: 93,
    });
  });
});
