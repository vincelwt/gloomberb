import { useCallback, useEffect, useRef, useState } from "react";
import { usePaneTicker } from "../../../state/app/context";

export type LoadState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

export function useBoundTicker() {
  const { symbol, ticker } = usePaneTicker();
  return {
    symbol,
    exchange: ticker?.metadata.exchange ?? "",
    currency: ticker?.metadata.currency ?? "USD",
  };
}

export function useTickerRequest<T>(
  loader: (symbol: string, exchange: string, forceRefresh: boolean) => Promise<T>,
  symbol: string | null,
  exchange: string,
) {
  const [state, setState] = useState<LoadState<T>>({
    data: null,
    loading: false,
    error: null,
  });
  const fetchGenRef = useRef(0);

  const load = useCallback((forceRefresh = false) => {
    if (!symbol) {
      setState({ data: null, loading: false, error: "No ticker selected" });
      return;
    }

    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setState((current) => ({ ...current, loading: true, error: null }));

    Promise.resolve()
      .then(() => loader(symbol, exchange, forceRefresh))
      .then((data) => {
        if (fetchGenRef.current !== gen) return;
        setState({ data, loading: false, error: null });
      })
      .catch((error) => {
        if (fetchGenRef.current !== gen) return;
        setState({
          data: null,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, [exchange, loader, symbol]);

  useEffect(() => {
    load(false);
  }, [load]);

  const reload = useCallback(() => load(true), [load]);

  return { ...state, reload };
}

export function formatDateTime(date: Date): string {
  const iso = date.toISOString();
  const hasTime = date.getUTCHours() !== 0 || date.getUTCMinutes() !== 0 || date.getUTCSeconds() !== 0;
  return hasTime ? iso.slice(0, 16).replace("T", " ") : iso.slice(0, 10);
}
