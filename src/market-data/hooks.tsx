import { useEffect, useMemo, useSyncExternalStore } from "react";
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

function useCoordinatorVersion(): number {
  const coordinator = getSharedMarketDataCoordinator();
  return useSyncExternalStore(
    coordinator?.subscribe.bind(coordinator) ?? (() => () => {}),
    () => coordinator?.getVersion() ?? 0,
    () => 0,
  );
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
  const financials = useCoordinatorSelector(
    (coordinator) => (instrument ? coordinator.getTickerFinancialsSync(instrument) : null),
    null,
  );

  useEffect(() => {
    const coordinator = getSharedMarketDataCoordinator();
    if (!coordinator || !instrument) return;
    void coordinator.loadSnapshot(instrument);
  }, [instrument?.brokerId, instrument?.brokerInstanceId, instrument?.exchange, instrument?.instrument?.conId, instrument?.symbol]);

  return financials;
}

export function useTickerFinancialsMap(tickers: TickerRecord[]): Map<string, TickerFinancials> {
  const coordinator = getSharedMarketDataCoordinator();
  const version = useCoordinatorVersion();
  const tickerKey = buildTickerFinancialsMapKey(tickers);

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
  }, [coordinator, tickerKey, version]);
}

export function useQuoteEntry(symbol: string | null | undefined, ticker: TickerRecord | null | undefined): QueryEntry<Quote> | null {
  const instrument = useTickerInstrument(symbol, ticker);
  const entry = useCoordinatorSelector(
    (coordinator) => (instrument ? coordinator.getQuoteEntry(instrument) : null),
    null,
  );

  useEffect(() => {
    const coordinator = getSharedMarketDataCoordinator();
    if (!coordinator || !instrument) return;
    void coordinator.loadQuote(instrument);
  }, [instrument?.brokerId, instrument?.brokerInstanceId, instrument?.exchange, instrument?.instrument?.conId, instrument?.symbol]);

  return entry;
}

export function useChartQuery(request: ChartRequest | null | undefined): QueryEntry<PricePoint[]> | null {
  const key = request ? [
    request.instrument.symbol,
    request.instrument.exchange ?? "",
    request.range,
    request.granularity ?? "daily",
    request.startDate?.toISOString() ?? "",
    request.endDate?.toISOString() ?? "",
    request.barSize ?? "",
  ].join("|") : null;
  const entry = useCoordinatorSelector(
    (coordinator) => (request ? coordinator.getChartEntry(request) : null),
    null,
  );

  useEffect(() => {
    const coordinator = getSharedMarketDataCoordinator();
    if (!coordinator || !request) return;
    void coordinator.loadChart(request);
  }, [key]);

  return entry;
}

export function useNewsQuery(request: NewsRequest | null | undefined): QueryEntry<NewsItem[]> | null {
  const key = request ? `${request.instrument.symbol}|${request.instrument.exchange ?? ""}|${request.count ?? 50}` : null;
  const entry = useCoordinatorSelector(
    (coordinator) => (request ? coordinator.getNewsEntry(request) : null),
    null,
  );

  useEffect(() => {
    const coordinator = getSharedMarketDataCoordinator();
    if (!coordinator || !request) return;
    void coordinator.loadNews(request);
  }, [key]);

  return entry;
}

export function useOptionsQuery(request: OptionsRequest | null | undefined): QueryEntry<OptionsChain> | null {
  const key = request ? `${request.instrument.symbol}|${request.instrument.exchange ?? ""}|${request.expirationDate ?? "default"}` : null;
  const entry = useCoordinatorSelector(
    (coordinator) => (request ? coordinator.getOptionsEntry(request) : null),
    null,
  );

  useEffect(() => {
    const coordinator = getSharedMarketDataCoordinator();
    if (!coordinator || !request) return;
    void coordinator.loadOptions(request);
  }, [key]);

  return entry;
}

export function useSecFilingsQuery(request: SecFilingsRequest | null | undefined): QueryEntry<SecFilingItem[]> | null {
  const key = request ? `${request.instrument.symbol}|${request.instrument.exchange ?? ""}|${request.count ?? 50}` : null;
  const entry = useCoordinatorSelector(
    (coordinator) => (request ? coordinator.getSecFilingsEntry(request) : null),
    null,
  );

  useEffect(() => {
    const coordinator = getSharedMarketDataCoordinator();
    if (!coordinator || !request) return;
    void coordinator.loadSecFilings(request);
  }, [key]);

  return entry;
}

export function useSecFilingContent(filing: SecFilingItem | null | undefined): QueryEntry<string | null> | null {
  const key = filing?.accessionNumber ?? null;
  const entry = useCoordinatorSelector(
    (coordinator) => (filing ? coordinator.getSecContentEntry(filing.accessionNumber) : null),
    null,
  );

  useEffect(() => {
    const coordinator = getSharedMarketDataCoordinator();
    if (!coordinator || !filing) return;
    void coordinator.loadSecFilingContent(filing);
  }, [key]);

  return entry;
}

export function useArticleSummary(url: string | null | undefined): QueryEntry<string | null> | null {
  const entry = useCoordinatorSelector(
    (coordinator) => (url ? coordinator.getArticleSummaryEntry(url) : null),
    null,
  );

  useEffect(() => {
    const coordinator = getSharedMarketDataCoordinator();
    if (!coordinator || !url) return;
    void coordinator.loadArticleSummary(url);
  }, [url]);

  return entry;
}

export function useFxRate(currency: string | null | undefined): QueryEntry<number> | null {
  const entry = useCoordinatorSelector(
    (coordinator) => (currency ? coordinator.getFxEntry(currency) : null),
    null,
  );

  useEffect(() => {
    const coordinator = getSharedMarketDataCoordinator();
    if (!coordinator || !currency) return;
    void coordinator.loadFxRate(currency);
  }, [currency]);

  return entry;
}

export function useFxRatesMap(currencies: Array<string | null | undefined>): Map<string, number> {
  const coordinator = getSharedMarketDataCoordinator();
  const version = useCoordinatorVersion();
  const normalizedCurrencyKey = stableCurrencyList(currencies).join("|");
  const normalizedCurrencies = useMemo(
    () => (normalizedCurrencyKey ? normalizedCurrencyKey.split("|") : []),
    [normalizedCurrencyKey],
  );
  const entries = useMemo(() => {
    if (!coordinator) return [] as Array<readonly [string, QueryEntry<number>]>;
    return normalizedCurrencies.map((currency) => [currency, coordinator.getFxEntry(currency)] as const);
  }, [coordinator, normalizedCurrencies, version]);

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
