import type { DataProvider } from "../types/data-provider";
import type { InstrumentSearchResult } from "../types/instrument";
import type { Quote, TickerFinancials } from "../types/financials";

function unused<T>(name: string): Promise<T> {
  return Promise.reject(new Error(`${name} is unused in this test`));
}

export function createTestDataProvider(overrides: Partial<DataProvider> = {}): DataProvider {
  return {
    id: "test-provider",
    name: "Test Provider",
    getTickerFinancials: async () => unused<TickerFinancials>("getTickerFinancials"),
    getQuote: async () => unused<Quote>("getQuote"),
    getExchangeRate: async () => 1,
    search: async () => [] satisfies InstrumentSearchResult[],
    getNews: async () => [],
    getArticleSummary: async () => null,
    getPriceHistory: async () => [],
    ...overrides,
  };
}
