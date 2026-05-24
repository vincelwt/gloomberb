import { useCallback, useEffect, useRef, useState } from "react";
import { useAppSelector } from "../../../../../state/app/context";
import { useAssetData } from "../../../../runtime";
import type { LoadState } from "../../../shared/ticker-request";
import type { SymbolFinancials } from "./types";

export function useSymbolFinancials(symbols: string[], forceExchange: string) {
  const dataProvider = useAssetData();
  const tickers = useAppSelector((state) => state.tickers);
  const [state, setState] = useState<LoadState<SymbolFinancials[]>>({
    data: null,
    loading: false,
    error: null,
  });
  const fetchGenRef = useRef(0);

  const load = useCallback((forceRefresh = false) => {
    if (symbols.length === 0) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    if (!dataProvider) {
      setState({ data: null, loading: false, error: "Market data unavailable" });
      return;
    }

    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setState((current) => ({ ...current, loading: true, error: null }));

    Promise.all(symbols.map(async (symbol) => {
      const exchange = tickers.get(symbol)?.metadata.exchange ?? forceExchange;
      try {
        return {
          symbol,
          financials: await dataProvider.getTickerFinancials(
            symbol,
            exchange,
            forceRefresh ? { cacheMode: "refresh" } : undefined,
          ),
          error: null,
        };
      } catch (error) {
        return {
          symbol,
          financials: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })).then((data) => {
      if (fetchGenRef.current !== gen) return;
      const firstError = data.find((entry) => entry.error)?.error ?? null;
      setState({ data, loading: false, error: firstError });
    });
  }, [dataProvider, forceExchange, symbols, tickers]);

  useEffect(() => {
    load(false);
  }, [load]);

  return { ...state, reload: () => load(true) };
}
