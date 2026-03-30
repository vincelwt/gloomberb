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

afterEach(() => {
  apiClient.ensureVerifiedSession = originalEnsureVerifiedSession;
  apiClient.getCloudHistory = originalGetCloudHistory;
});

describe("GloomberbCloudProvider", () => {
  test("fetches detailed intraday chart history with Twelve Data intervals", async () => {
    apiClient.ensureVerifiedSession = async () => verifiedUser;

    let requestArgs: { symbol: string; exchange: string; params: Record<string, string | number | undefined> } | null = null;
    apiClient.getCloudHistory = async (symbol, exchange, params = {}) => {
      requestArgs = { symbol, exchange, params };
      return [{
        date: "2026-03-27 10:15:00",
        close: 250.12,
      }];
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
      return [];
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
});
