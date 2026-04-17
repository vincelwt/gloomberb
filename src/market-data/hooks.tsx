import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { NewsItem, SecFilingItem } from "../types/data-provider";
import type { OptionsChain, PricePoint, Quote, TickerFinancials } from "../types/financials";
import type { TickerRecord } from "../types/ticker";
import type { ChartRequest, InstrumentRef, NewsRequest, OptionsRequest, SecFilingsRequest } from "./request-types";
import { instrumentFromTicker } from "./request-types";
import {
  getSharedMarketDataCoordinator,
  resolveEntryValue,
} from "./coordinator";
import type { QueryEntry } from "./result-types";
import {
  buildArticleSummaryKey,
  buildChartKey,
  buildFxKey,
  buildNewsKey,
  buildOptionsKey,
  buildQuoteKey,
  buildSecContentKey,
  buildSecFilingsKey,
  buildSnapshotKey,
} from "./selectors";

const TICKER_FINANCIALS_LOAD_DELAY_MS = 250;

function useCoordinatorVersion(): number {
  const coordinator = getSharedMarketDataCoordinator();
  return useSyncExternalStore(
    coordinator?.subscribe.bind(coordinator) ?? (() => () => {}),
    () => coordinator?.getVersion() ?? 0,
    () => 0,
  );
}

function useCoordinatorKeysVersion(keys: readonly string[]): number {
  const coordinator = getSharedMarketDataCoordinator();
  const keyString = keys.join("\u001f");
  const stableKeys = useMemo(
    () => (keyString ? keyString.split("\u001f") : []),
    [keyString],
  );
  const subscribe = useCallback((listener: () => void) => {
    if (!coordinator) return () => {};
    if (typeof coordinator.subscribeKeys === "function") {
      return coordinator.subscribeKeys(stableKeys, listener);
    }
    return coordinator.subscribe(listener);
  }, [coordinator, stableKeys]);
  const getSnapshot = useCallback(() => {
    if (!coordinator) return 0;
    if (typeof coordinator.getKeysVersion === "function") {
      return coordinator.getKeysVersion(stableKeys);
    }
    return coordinator.getVersion();
  }, [coordinator, stableKeys]);
  return useSyncExternalStore(subscribe, getSnapshot, () => 0);
}

function useCoordinatorSelector<T>(selector: (coordinator: NonNullable<ReturnType<typeof getSharedMarketDataCoordinator>>) => T, fallback: T): T {
  const coordinator = getSharedMarketDataCoordinator();
  useCoordinatorVersion();
  return coordinator ? selector(coordinator) : fallback;
}

function stableCurrencyList(currencies: Array<string | null | undefined>): string[] {
  return [...new Set(
    currencies
      .map((currency) => currency?.trim().toUpperCase() ?? "")
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));
}

function buildTickerFinancialsMapKey(tickers: TickerRecord[]): string {
  return tickers.map((ticker) => {
    const instrument = ticker.metadata.broker_contracts?.[0];
    return [
      ticker.metadata.ticker,
      ticker.metadata.exchange ?? "",
      instrument?.brokerId ?? "",
      instrument?.brokerInstanceId ?? "",
      instrument?.conId ?? "",
      instrument?.localSymbol ?? "",
      instrument?.symbol ?? "",
    ].join("|");
  }).join("::");
}

export function useTickerInstrument(symbol: string | null | undefined, ticker: TickerRecord | null | undefined): InstrumentRef | null {
  return useMemo(() => instrumentFromTicker(ticker, symbol ?? null), [symbol, ticker]);
}

export function useTickerFinancials(symbol: string | null | undefined, ticker: TickerRecord | null | undefined): TickerFinancials | null {
  const instrument = useTickerInstrument(symbol, ticker);
  const keys = useMemo(() => (
    instrument
      ? [
        buildSnapshotKey(instrument),
        buildQuoteKey(instrument),
        buildChartKey({ instrument, bufferRange: "5Y", granularity: "range" }),
      ]
      : []
  ), [instrument?.brokerId, instrument?.brokerInstanceId, instrument?.exchange, instrument?.instrument?.conId, instrument?.symbol]);
  useCoordinatorKeysVersion(keys);
  const coordinator = getSharedMarketDataCoordinator();
  const financials = coordinator && instrument
    ? coordinator.getTickerFinancialsSync(instrument)
    : null;

  useEffect(() => {
    const coordinator = getSharedMarketDataCoordinator();
    if (!coordinator || !instrument) return;
    const timeoutId = setTimeout(() => {
      void coordinator.loadSnapshot(instrument);
    }, TICKER_FINANCIALS_LOAD_DELAY_MS);
    return () => clearTimeout(timeoutId);
  }, [instrument?.brokerId, instrument?.brokerInstanceId, instrument?.exchange, instrument?.instrument?.conId, instrument?.symbol]);

  return financials;
}

function buildTickerFinancialsKeys(tickers: TickerRecord[]): string[] {
  const keys: string[] = [];
  for (const ticker of tickers) {
    const instrument = instrumentFromTicker(ticker, ticker.metadata.ticker);
    if (!instrument) continue;
    keys.push(
      buildSnapshotKey(instrument),
      buildQuoteKey(instrument),
      buildChartKey({ instrument, bufferRange: "5Y", granularity: "range" }),
    );
  }
  return keys;
}

export function useTickerFinancialsMap(tickers: TickerRecord[]): Map<string, TickerFinancials> {
  const coordinator = getSharedMarketDataCoordinator();
  const tickerKey = buildTickerFinancialsMapKey(tickers);
  const subscriptionKeys = useMemo(() => buildTickerFinancialsKeys(tickers), [tickerKey]);
  const keysVersion = useCoordinatorKeysVersion(subscriptionKeys);

  return useMemo(() => {
    if (!coordinator) return new Map<string, TickerFinancials>();
    const result = new Map<string, TickerFinancials>();
    for (const ticker of tickers) {
      const instrument = instrumentFromTicker(ticker, ticker.metadata.ticker);
      if (!instrument) continue;
      const financials = coordinator.getTickerFinancialsSync(instrument);
      if (financials) {
        result.set(ticker.metadata.ticker, financials);
      }
    }
    return result;
  }, [coordinator, keysVersion, tickerKey, subscriptionKeys]);
}

export function useQuoteEntry(symbol: string | null | undefined, ticker: TickerRecord | null | undefined): QueryEntry<Quote> | null {
  const instrument = useTickerInstrument(symbol, ticker);
  const keys = useMemo(
    () => (instrument ? [buildQuoteKey(instrument)] : []),
    [instrument?.brokerId, instrument?.brokerInstanceId, instrument?.exchange, instrument?.instrument?.conId, instrument?.symbol],
  );
  useCoordinatorKeysVersion(keys);
  const coordinator = getSharedMarketDataCoordinator();
  const entry = coordinator && instrument ? coordinator.getQuoteEntry(instrument) : null;

  useEffect(() => {
    const coordinator = getSharedMarketDataCoordinator();
    if (!coordinator || !instrument) return;
    void coordinator.loadQuote(instrument);
  }, [instrument?.brokerId, instrument?.brokerInstanceId, instrument?.exchange, instrument?.instrument?.conId, instrument?.symbol]);

  return entry;
}

export function useChartQuery(request: ChartRequest | null | undefined): QueryEntry<PricePoint[]> | null {
  const key = request ? buildChartKey(request) : null;
  useCoordinatorKeysVersion(key ? [key] : []);
  const coordinator = getSharedMarketDataCoordinator();
  const entry = coordinator && request ? coordinator.getChartEntry(request) : null;

  useEffect(() => {
    const coordinator = getSharedMarketDataCoordinator();
    if (!coordinator || !request) return;
    void coordinator.loadChart(request);
  }, [key]);

  return entry;
}

export function useChartQueries(
  requests: readonly ChartRequest[],
  options: { debounceMs?: number } = {},
): Map<string, QueryEntry<PricePoint[]>> {
  const requestKey = requests.map((request) => buildChartKey(request)).join(",");
  const debounceMs = Math.max(0, options.debounceMs ?? 0);
  const keys = useMemo(() => requests.map((request) => buildChartKey(request)), [requestKey]);
  const keysVersion = useCoordinatorKeysVersion(keys);
  const coordinator = getSharedMarketDataCoordinator();
  const entries = useMemo(() => (
    coordinator
      ? requests.map((request) => [buildChartKey(request), coordinator.getChartEntry(request)] as const)
      : [] as Array<readonly [string, QueryEntry<PricePoint[]>]>
  ), [coordinator, keys, keysVersion, requestKey]);

  useEffect(() => {
    const coordinator = getSharedMarketDataCoordinator();
    if (!coordinator) return;
    const loadRequests = () => {
      for (const request of requests) {
        void coordinator.loadChart(request);
      }
    };
    if (debounceMs <= 0) {
      loadRequests();
      return;
    }
    const timeout = setTimeout(loadRequests, debounceMs);
    return () => clearTimeout(timeout);
  }, [debounceMs, requestKey]);

  return useMemo(() => new Map(entries), [entries]);
}

export function useNewsQuery(request: NewsRequest | null | undefined): QueryEntry<NewsItem[]> | null {
  const requestKey = request ? buildNewsKey(request) : null;
  useCoordinatorKeysVersion(requestKey ? [requestKey] : []);
  const coordinator = getSharedMarketDataCoordinator();
  const entry = coordinator && request ? coordinator.getNewsEntry(request) : null;

  useEffect(() => {
    const coordinator = getSharedMarketDataCoordinator();
    if (!coordinator || !request) return;
    void coordinator.loadNews(request);
  }, [requestKey]);

  return entry;
}

export function useOptionsQuery(request: OptionsRequest | null | undefined): QueryEntry<OptionsChain> | null {
  const requestKey = request ? buildOptionsKey(request) : null;
  useCoordinatorKeysVersion(requestKey ? [requestKey] : []);
  const coordinator = getSharedMarketDataCoordinator();
  const entry = coordinator && request ? coordinator.getOptionsEntry(request) : null;

  useEffect(() => {
    const coordinator = getSharedMarketDataCoordinator();
    if (!coordinator || !request) return;
    void coordinator.loadOptions(request);
  }, [requestKey]);

  return entry;
}

export function useSecFilingsQuery(request: SecFilingsRequest | null | undefined): QueryEntry<SecFilingItem[]> | null {
  const requestKey = request ? buildSecFilingsKey(request) : null;
  useCoordinatorKeysVersion(requestKey ? [requestKey] : []);
  const coordinator = getSharedMarketDataCoordinator();
  const entry = coordinator && request ? coordinator.getSecFilingsEntry(request) : null;

  useEffect(() => {
    const coordinator = getSharedMarketDataCoordinator();
    if (!coordinator || !request) return;
    void coordinator.loadSecFilings(request);
  }, [requestKey]);

  return entry;
}

export function useSecFilingContent(filing: SecFilingItem | null | undefined): QueryEntry<string | null> | null {
  const key = filing ? buildSecContentKey(filing.accessionNumber) : null;
  useCoordinatorKeysVersion(key ? [key] : []);
  const coordinator = getSharedMarketDataCoordinator();
  const entry = coordinator && filing ? coordinator.getSecContentEntry(filing.accessionNumber) : null;

  useEffect(() => {
    const coordinator = getSharedMarketDataCoordinator();
    if (!coordinator || !filing) return;
    void coordinator.loadSecFilingContent(filing);
  }, [key]);

  return entry;
}

export function useArticleSummary(url: string | null | undefined): QueryEntry<string | null> | null {
  const key = url ? buildArticleSummaryKey(url) : null;
  useCoordinatorKeysVersion(key ? [key] : []);
  const coordinator = getSharedMarketDataCoordinator();
  const entry = coordinator && url ? coordinator.getArticleSummaryEntry(url) : null;

  useEffect(() => {
    const coordinator = getSharedMarketDataCoordinator();
    if (!coordinator || !url) return;
    void coordinator.loadArticleSummary(url);
  }, [url]);

  return entry;
}

export function useFxRate(currency: string | null | undefined): QueryEntry<number> | null {
  const key = currency ? buildFxKey(currency) : null;
  useCoordinatorKeysVersion(key ? [key] : []);
  const coordinator = getSharedMarketDataCoordinator();
  const entry = coordinator && currency ? coordinator.getFxEntry(currency) : null;

  useEffect(() => {
    const coordinator = getSharedMarketDataCoordinator();
    if (!coordinator || !currency) return;
    void coordinator.loadFxRate(currency);
  }, [currency]);

  return entry;
}

export function useFxRatesMap(currencies: Array<string | null | undefined>): Map<string, number> {
  const coordinator = getSharedMarketDataCoordinator();
  const normalizedCurrencyKey = stableCurrencyList(currencies).join("|");
  const normalizedCurrencies = useMemo(
    () => (normalizedCurrencyKey ? normalizedCurrencyKey.split("|") : []),
    [normalizedCurrencyKey],
  );
  const keys = useMemo(() => normalizedCurrencies.map(buildFxKey), [normalizedCurrencies]);
  const keysVersion = useCoordinatorKeysVersion(keys);
  const entries = useMemo(() => {
    if (!coordinator) return [] as Array<readonly [string, QueryEntry<number>]>;
    return normalizedCurrencies.map((currency) => [currency, coordinator.getFxEntry(currency)] as const);
  }, [coordinator, keys, keysVersion, normalizedCurrencies]);

  useEffect(() => {
    const coordinator = getSharedMarketDataCoordinator();
    if (!coordinator) return;
    for (const currency of normalizedCurrencies) {
      void coordinator.loadFxRate(currency);
    }
  }, [normalizedCurrencyKey]);

  return useMemo(() => {
    const rates = new Map<string, number>();
    rates.set("USD", 1);
    for (const [currency, entry] of entries) {
      const rate = resolveEntryValue(entry);
      if (rate != null) {
        rates.set(currency, rate);
      }
    }
    return rates;
  }, [entries]);
}

export function useResolvedEntryValue<T>(entry: QueryEntry<T> | null | undefined): T | null {
  return useMemo(() => (entry ? resolveEntryValue(entry) : null), [entry]);
}
