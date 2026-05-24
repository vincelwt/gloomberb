import { useCallback, useEffect, useRef, useState } from "react";
import type { PricePoint } from "../../../../types/financials";
import { useAppSelector } from "../../../../state/app/context";
import { useAssetData } from "../../../runtime";
import type { LoadState } from "../../shared/ticker-request";
import type { RelationshipRange } from "./model";

type RelationshipHistoryEntry = {
  symbol: string;
  points: PricePoint[];
  error: string | null;
};

export function useRelationshipHistories(pair: [string, string] | null, range: RelationshipRange, forceExchange: string) {
  const dataProvider = useAssetData();
  const tickers = useAppSelector((state) => state.tickers);
  const [state, setState] = useState<LoadState<RelationshipHistoryEntry[]>>({
    data: null,
    loading: false,
    error: null,
  });
  const fetchGenRef = useRef(0);
  const leftSymbol = pair?.[0] ?? null;
  const rightSymbol = pair?.[1] ?? null;

  const load = useCallback((forceRefresh = false) => {
    if (!leftSymbol || !rightSymbol) {
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

    Promise.all([leftSymbol, rightSymbol].map(async (symbol) => {
      const exchange = tickers.get(symbol)?.metadata.exchange ?? (symbol === leftSymbol ? forceExchange : "");
      try {
        return {
          symbol,
          points: await dataProvider.getPriceHistory(
            symbol,
            exchange,
            range,
            forceRefresh ? { cacheMode: "refresh" } : undefined,
          ),
          error: null,
        };
      } catch (error) {
        return {
          symbol,
          points: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })).then((data) => {
      if (fetchGenRef.current !== gen) return;
      const firstError = data.find((entry) => entry.error)?.error ?? null;
      setState({ data, loading: false, error: firstError });
    });
  }, [dataProvider, forceExchange, leftSymbol, range, rightSymbol, tickers]);

  useEffect(() => {
    load(false);
  }, [load]);

  return { ...state, reload: () => load(true) };
}
