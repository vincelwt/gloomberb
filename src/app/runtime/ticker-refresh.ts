import { useCallback, useEffect, useRef, type Dispatch } from "react";
import type { MarketDataCoordinator } from "../../market-data/coordinator";
import { instrumentFromTicker } from "../../market-data/request-types";
import type { PluginRegistry } from "../../plugins/registry";
import type { AppAction } from "../../state/app/context";
import { TickerRefreshQueue } from "../../state/ticker-refresh-queue";
import type { TickerFinancials } from "../../types/financials";
import type { TickerRecord } from "../../types/ticker";

const refreshInFlight: Set<string> = (globalThis as any).__refreshInFlight ??= new Set<string>();
const quoteRefreshInFlight: Set<string> = (globalThis as any).__quoteRefreshInFlight ??= new Set<string>();

export interface AppTickerRefreshRuntime {
  primeCachedFinancials: (entries: Array<{ ticker: TickerRecord; financials: TickerFinancials }>) => void;
  refreshQuote: (symbol: string, exchange?: string, tickerOverride?: TickerRecord | null, priority?: number) => void;
  refreshQuotesBatch: (entries: Array<{ ticker: TickerRecord; priority: number }>) => void;
  refreshTicker: (symbol: string, exchange?: string, tickerOverride?: TickerRecord | null, priority?: number) => void;
  refreshTickersBatch: (entries: Array<{ ticker: TickerRecord; priority: number }>) => void;
}

export function useTickerRefreshRuntime({
  appActive,
  baseCurrency,
  dispatch,
  marketData,
  pluginRegistry,
  tickers,
}: {
  appActive: boolean;
  baseCurrency: string;
  dispatch: Dispatch<AppAction>;
  marketData: MarketDataCoordinator;
  pluginRegistry: PluginRegistry;
  tickers: Map<string, TickerRecord>;
}): AppTickerRefreshRuntime {
  const refreshQueueRef = useRef<{
    queue: TickerRefreshQueue;
  }>({
    queue: new TickerRefreshQueue(3),
  });
  const pendingRefreshesRef = useRef<{
    financials: Set<string>;
    quotes: Set<string>;
  }>({
    financials: new Set<string>(),
    quotes: new Set<string>(),
  });

  useEffect(() => {
    refreshQueueRef.current.queue.setPaused(!appActive);
  }, [appActive]);

  const performRefreshTicker = useCallback(async (symbol: string, tickerOverride?: TickerRecord | null) => {
    if (refreshInFlight.has(symbol)) return;
    refreshInFlight.add(symbol);
    dispatch({ type: "SET_REFRESHING", symbol, refreshing: true });
    try {
      const ticker = tickerOverride ?? tickers.get(symbol) ?? null;
      const instrument = instrumentFromTicker(ticker, symbol);
      if (!instrument) return;
      const entry = await marketData.loadSnapshot(instrument, { forceRefresh: true });
      const data = entry.data ?? entry.lastGoodData;
      if (data) {
        pluginRegistry.events.emit("ticker:refreshed", { symbol, financials: data });
      }

      const currency = data?.quote?.currency;
      if (currency) {
        void marketData.loadFxRate(currency).catch(() => {});
      }
      void marketData.loadFxRate(baseCurrency).catch(() => {});
    } catch {
      // Silently fail - will show "—" for missing data
    } finally {
      refreshInFlight.delete(symbol);
      dispatch({ type: "SET_REFRESHING", symbol, refreshing: false });
    }
  }, [baseCurrency, dispatch, marketData, pluginRegistry.events, tickers]);

  const performRefreshQuote = useCallback(async (symbol: string, tickerOverride?: TickerRecord | null) => {
    if (refreshInFlight.has(symbol) || quoteRefreshInFlight.has(symbol)) return;
    quoteRefreshInFlight.add(symbol);
    try {
      const ticker = tickerOverride ?? tickers.get(symbol) ?? null;
      const instrument = instrumentFromTicker(ticker, symbol);
      if (!instrument) return;
      const entry = await marketData.loadQuote(instrument, { forceRefresh: true });
      const quote = entry.data ?? entry.lastGoodData;
      if (!quote) return;

      const currency = quote.currency;
      if (currency) {
        void marketData.loadFxRate(currency).catch(() => {});
      }
      void marketData.loadFxRate(baseCurrency).catch(() => {});
    } catch {
      // Silently fail - the list can fall back to stale cache or Yahoo
    } finally {
      quoteRefreshInFlight.delete(symbol);
    }
  }, [baseCurrency, marketData, tickers]);

  const refreshTicker = useCallback((symbol: string, _exchange = "", tickerOverride?: TickerRecord | null, priority = 2) => {
    if (refreshInFlight.has(symbol) || pendingRefreshesRef.current.financials.has(symbol)) return;
    pendingRefreshesRef.current.financials.add(symbol);
    refreshQueueRef.current.queue.enqueue({
      key: `financials:${symbol}`,
      priority,
      run: async () => {
        try {
          await performRefreshTicker(symbol, tickerOverride ?? null);
        } finally {
          pendingRefreshesRef.current.financials.delete(symbol);
        }
      },
    });
  }, [performRefreshTicker]);

  const refreshQuote = useCallback((symbol: string, _exchange = "", tickerOverride?: TickerRecord | null, priority = 2) => {
    if (
      refreshInFlight.has(symbol)
      || quoteRefreshInFlight.has(symbol)
      || pendingRefreshesRef.current.financials.has(symbol)
      || pendingRefreshesRef.current.quotes.has(symbol)
    ) {
      return;
    }
    pendingRefreshesRef.current.quotes.add(symbol);
    refreshQueueRef.current.queue.enqueue({
      key: `quote:${symbol}`,
      priority,
      run: async () => {
        try {
          if (pendingRefreshesRef.current.financials.has(symbol) || refreshInFlight.has(symbol)) return;
          await performRefreshQuote(symbol, tickerOverride ?? null);
        } finally {
          pendingRefreshesRef.current.quotes.delete(symbol);
        }
      },
    });
  }, [performRefreshQuote]);

  const refreshTickersBatch = useCallback((entries: Array<{ ticker: TickerRecord; priority: number }>) => {
    const runnable = entries.filter(({ ticker }) => {
      const symbol = ticker.metadata.ticker;
      return !refreshInFlight.has(symbol) && !pendingRefreshesRef.current.financials.has(symbol);
    });
    if (runnable.length === 0) return;
    for (const { ticker } of runnable) {
      pendingRefreshesRef.current.financials.add(ticker.metadata.ticker);
    }
    const priority = Math.min(...runnable.map((entry) => entry.priority));
    refreshQueueRef.current.queue.enqueue({
      key: `financials-batch:${priority}:${runnable.map(({ ticker }) => ticker.metadata.ticker).join(",")}`,
      priority,
      run: async () => {
        const instrumentEntries = runnable.flatMap(({ ticker }) => {
          const instrument = instrumentFromTicker(ticker, ticker.metadata.ticker);
          return instrument ? [{ ticker, instrument }] : [];
        });
        for (const { ticker } of runnable) {
          const symbol = ticker.metadata.ticker;
          refreshInFlight.add(symbol);
          dispatch({ type: "SET_REFRESHING", symbol, refreshing: true });
        }
        try {
          const entries = await marketData.loadSnapshotsBatch(
            instrumentEntries.map((entry) => entry.instrument),
            { forceRefresh: true },
          );
          entries.forEach((entry, index) => {
            const ticker = instrumentEntries[index]?.ticker;
            const data = entry.data ?? entry.lastGoodData;
            if (ticker && data) {
              pluginRegistry.events.emit("ticker:refreshed", { symbol: ticker.metadata.ticker, financials: data });
              const currency = data.quote?.currency;
              if (currency) void marketData.loadFxRate(currency).catch(() => {});
            }
          });
          void marketData.loadFxRate(baseCurrency).catch(() => {});
        } finally {
          for (const { ticker } of runnable) {
            const symbol = ticker.metadata.ticker;
            refreshInFlight.delete(symbol);
            pendingRefreshesRef.current.financials.delete(symbol);
            dispatch({ type: "SET_REFRESHING", symbol, refreshing: false });
          }
        }
      },
    });
  }, [baseCurrency, dispatch, marketData, pluginRegistry.events]);

  const refreshQuotesBatch = useCallback((entries: Array<{ ticker: TickerRecord; priority: number }>) => {
    const runnable = entries.filter(({ ticker }) => {
      const symbol = ticker.metadata.ticker;
      return !refreshInFlight.has(symbol)
        && !quoteRefreshInFlight.has(symbol)
        && !pendingRefreshesRef.current.financials.has(symbol)
        && !pendingRefreshesRef.current.quotes.has(symbol);
    });
    if (runnable.length === 0) return;
    for (const { ticker } of runnable) {
      pendingRefreshesRef.current.quotes.add(ticker.metadata.ticker);
    }
    const priority = Math.min(...runnable.map((entry) => entry.priority));
    refreshQueueRef.current.queue.enqueue({
      key: `quotes-batch:${priority}:${runnable.map(({ ticker }) => ticker.metadata.ticker).join(",")}`,
      priority,
      run: async () => {
        const instrumentEntries = runnable.flatMap(({ ticker }) => {
          const instrument = instrumentFromTicker(ticker, ticker.metadata.ticker);
          return instrument ? [{ ticker, instrument }] : [];
        });
        for (const { ticker } of runnable) {
          quoteRefreshInFlight.add(ticker.metadata.ticker);
        }
        try {
          const entries = await marketData.loadQuotesBatch(instrumentEntries.map((entry) => entry.instrument));
          entries.forEach((entry) => {
            const quote = entry.data ?? entry.lastGoodData;
            const currency = quote?.currency;
            if (currency) void marketData.loadFxRate(currency).catch(() => {});
          });
          void marketData.loadFxRate(baseCurrency).catch(() => {});
        } finally {
          for (const { ticker } of runnable) {
            const symbol = ticker.metadata.ticker;
            quoteRefreshInFlight.delete(symbol);
            pendingRefreshesRef.current.quotes.delete(symbol);
          }
        }
      },
    });
  }, [baseCurrency, marketData]);

  const primeCachedFinancials = useCallback((entries: Array<{ ticker: TickerRecord; financials: TickerFinancials }>) => {
    const primeEntries = entries.flatMap(({ ticker, financials }) => {
      const instrument = instrumentFromTicker(ticker, ticker.metadata.ticker);
      return instrument ? [{ instrument, financials }] : [];
    });
    if (primeEntries.length === 0) return;
    marketData.primeCachedFinancials(primeEntries);
  }, [marketData]);

  return {
    primeCachedFinancials,
    refreshQuote,
    refreshQuotesBatch,
    refreshTicker,
    refreshTickersBatch,
  };
}
