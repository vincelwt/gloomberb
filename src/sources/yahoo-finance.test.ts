import { describe, expect, test } from "bun:test";
import { YahooFinanceClient } from "./yahoo-finance";

describe("YahooFinanceClient exchange aliases", () => {
  test("tries the Taipei Exchange suffix for TPEX tickers", () => {
    const provider = new YahooFinanceClient() as any;
    expect(provider.getSymbolsToTry("3105", "TPEX")).toEqual(["3105.TWO", "3105.TW"]);
  });

  test("prefers Frankfurt-style symbols for FWB2 listings", () => {
    const provider = new YahooFinanceClient() as any;
    expect(provider.getSymbolsToTry("HY9H", "FWB2")).toEqual(["HY9H.F", "HY9H.DE"]);
  });

  test("maps manual resolution requests to yahoo chart range plus interval", async () => {
    const provider = new YahooFinanceClient() as any;
    let request: { symbol: string; range: string; interval: string } | null = null;
    provider.fetchChart = async (symbol: string, range: string, interval: string) => {
      request = { symbol, range, interval };
      return {
        meta: { currency: "USD" },
        history: [{ date: new Date("2026-03-30T00:00:00Z"), close: 200 }],
      };
    };

    const history = await provider.getPriceHistoryForResolution("AAPL", "NASDAQ", "1Y", "1wk");

    expect(request).toEqual({
      symbol: "AAPL",
      range: "1y",
      interval: "1wk",
    });
    expect(history[0]?.close).toBe(200);
  });

  test("preserves analyst rating price targets from upgrade history", async () => {
    const provider = new YahooFinanceClient() as any;
    let requestUrl = "";
    provider.getSymbolsToTry = () => ["AMD"];
    provider.fetchJsonWithCrumb = async (_label: string, url: string) => {
      requestUrl = url;
      return {
        quoteSummary: {
          result: [{
            price: { symbol: "AMD", currency: "USD", exchangeName: "NasdaqGS" },
            financialData: {},
            recommendationTrend: { trend: [] },
            earningsTrend: { trend: [] },
            upgradeDowngradeHistory: {
              history: [{
                epochGradeDate: 1778188318,
                firm: "Citigroup",
                toGrade: "Neutral",
                fromGrade: "Neutral",
                action: "main",
                priceTargetAction: "Raises",
                currentPriceTarget: 358,
                priorPriceTarget: 248,
              }],
            },
          }],
        },
      };
    };

    const research = await provider.getAnalystResearch("AMD", "NASDAQ");

    expect(requestUrl).toContain("upgradeDowngradeHistory");
    expect(research.ratings[0]).toMatchObject({
      date: "2026-05-07",
      firm: "Citigroup",
      action: "Raises",
      current: "Neutral",
      prior: "Neutral",
      currentPriceTarget: 358,
      priorPriceTarget: 248,
    });
  });
});
