import { afterEach, describe, expect, test } from "bun:test";
import { GloomberbCloudProvider } from "./gloomberb-cloud";
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
const originalSubscribeQuotes = apiClient.subscribeQuotes.bind(apiClient);

afterEach(() => {
  apiClient.ensureVerifiedSession = originalEnsureVerifiedSession;
  apiClient.getCloudHistory = originalGetCloudHistory;
  apiClient.getCloudQuote = originalGetCloudQuote;
  apiClient.subscribeQuotes = originalSubscribeQuotes;
});

describe("GloomberbCloudProvider", () => {
  test("reports its manual chart resolution capabilities", () => {
    const provider = new GloomberbCloudProvider();
    expect(provider.getChartResolutionCapabilities()).toEqual(["1m", "5m", "15m", "30m", "45m", "1h", "1d", "1wk", "1mo"]);
  });

  test("fetches detailed intraday chart history with Twelve Data intervals", async () => {
    apiClient.ensureVerifiedSession = async () => verifiedUser;

    let requestArgs: { symbol: string; exchange: string; params: Record<string, string | number | undefined> } | null = null;
    apiClient.getCloudHistory = async (symbol, exchange, params = {}) => {
      requestArgs = { symbol, exchange, params };
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

    expect(requestArgs).toEqual({
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

    let requestArgs: Record<string, string | number | undefined> | null = null;
    apiClient.getCloudHistory = async (_symbol, _exchange, params = {}) => {
      requestArgs = params;
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

    expect(requestArgs).toEqual({
      interval: "1day",
      startDate: "2026-01-01",
      endDate: "2026-03-27",
    });
  });

  test("fetches fixed-resolution chart history with the requested interval", async () => {
    apiClient.ensureVerifiedSession = async () => verifiedUser;

    let requestArgs: Record<string, string | number | undefined> | null = null;
    apiClient.getCloudHistory = async (_symbol, _exchange, params = {}) => {
      requestArgs = params;
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

    expect(requestArgs?.interval).toBe("1week");
    expect(requestArgs?.startDate).toBeDefined();
    expect(requestArgs?.endDate).toBeDefined();
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
});
