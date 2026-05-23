import { useCallback, useEffect, useRef } from "react";
import type { AppState } from "../../../../state/app-context";
import type { TickerRepository } from "../../../../data/ticker-repository";
import type { PluginRegistry } from "../../../../plugins/registry";
import {
  rankTickerSearchItems,
  upsertTickerFromSearchResult,
  type TickerSearchCandidate,
} from "../../../../utils/ticker-search";
import type { ResultItem } from "../../list-model";
import {
  buildTickerSearchCacheKey,
  createQuickLookTickerCandidates,
} from "./ticker-search-results";

interface UseCommandBarTickerSearchActionsOptions {
  closeAll: (options?: { revertThemePreview?: boolean }) => void;
  dispatch: (action: any) => void;
  focusTicker: (symbol: string, options?: { forceNewPane?: boolean }) => void;
  pluginRegistry: Pick<PluginRegistry, "events">;
  tickerRepository: TickerRepository;
  tickers: AppState["tickers"];
}

export function useCommandBarTickerSearchActions({
  closeAll,
  dispatch,
  focusTicker,
  pluginRegistry,
  tickerRepository,
  tickers,
}: UseCommandBarTickerSearchActionsOptions) {
  const tickerSearchCacheRef = useRef<Map<string, TickerSearchCandidate[]>>(new Map());

  const openTickerDetail = useCallback((result: any, options?: { forceNewPane?: boolean }) => {
    (async () => {
      const { ticker, created } = await upsertTickerFromSearchResult(tickerRepository, result);
      dispatch({ type: "UPDATE_TICKER", ticker });
      if (created) {
        pluginRegistry.events.emit("ticker:added", { symbol: ticker.metadata.ticker, ticker });
      }
      focusTicker(ticker.metadata.ticker, options);
      closeAll({ revertThemePreview: false });
    })();
  }, [tickerRepository, dispatch, pluginRegistry.events, focusTicker, closeAll]);

  const mapTickerSearchCandidateToResultItem = useCallback((candidate: TickerSearchCandidate): ResultItem => {
    if (candidate.kind === "ticker" && candidate.ticker) {
      return {
        id: candidate.id,
        label: candidate.label,
        detail: candidate.detail,
        right: candidate.right,
        category: candidate.category,
        kind: "ticker",
        secondaryAction: () => {
          focusTicker(candidate.ticker!.metadata.ticker, { forceNewPane: true });
          closeAll({ revertThemePreview: false });
        },
        action: () => {
          focusTicker(candidate.ticker!.metadata.ticker);
          closeAll({ revertThemePreview: false });
        },
      };
    }

    return {
      id: candidate.id,
      label: candidate.label,
      detail: candidate.detail,
      right: candidate.right,
      category: candidate.category,
      kind: "search",
      secondaryAction: () => openTickerDetail(candidate.result!, { forceNewPane: true }),
      action: () => openTickerDetail(candidate.result!),
    };
  }, [closeAll, focusTicker, openTickerDetail]);

  const buildTickerSearchResultItems = useCallback((candidates: TickerSearchCandidate[], query: string): ResultItem[] => (
    candidates.length > 0
      ? candidates.map((candidate) => mapTickerSearchCandidateToResultItem(candidate))
      : [{
        id: "no-results",
        label: `No matches for "${query}"`,
        detail: "Try a symbol, company name, exchange, or asset type",
        category: "Search",
        kind: "info",
        action: () => {},
      }]
  ), [mapTickerSearchCandidateToResultItem]);

  const readTickerSearchCache = useCallback((
    query: string,
    brokerId?: string | null,
    brokerInstanceId?: string | null,
  ): TickerSearchCandidate[] | null => {
    const key = buildTickerSearchCacheKey(query, brokerId, brokerInstanceId);
    return tickerSearchCacheRef.current.get(key) ?? null;
  }, []);

  const writeTickerSearchCache = useCallback((
    query: string,
    candidates: TickerSearchCandidate[],
    brokerId?: string | null,
    brokerInstanceId?: string | null,
  ) => {
    const key = buildTickerSearchCacheKey(query, brokerId, brokerInstanceId);
    tickerSearchCacheRef.current.set(key, candidates);
    while (tickerSearchCacheRef.current.size > 24) {
      const oldestKey = tickerSearchCacheRef.current.keys().next().value;
      if (!oldestKey) break;
      tickerSearchCacheRef.current.delete(oldestKey);
    }
  }, []);

  useEffect(() => {
    tickerSearchCacheRef.current.clear();
  }, [tickers]);

  const localTickerSearchResultItems = useCallback((query?: string, options?: {
    category?: string;
    limit?: number;
  }): ResultItem[] => {
    const items = query
      ? rankTickerSearchItems(createQuickLookTickerCandidates(tickers.values()), query)
      : createQuickLookTickerCandidates(tickers.values());
    return items
      .slice(0, options?.limit)
      .map((candidate) => ({
        ...mapTickerSearchCandidateToResultItem(candidate),
        category: options?.category ?? candidate.category,
      }));
  }, [mapTickerSearchCandidateToResultItem, tickers]);

  return {
    buildTickerSearchResultItems,
    localTickerSearchResultItems,
    mapTickerSearchCandidateToResultItem,
    readTickerSearchCache,
    writeTickerSearchCache,
  };
}
