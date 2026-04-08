import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildPredictionCatalogCacheKey,
  buildPredictionCatalogResourceKey,
  buildPredictionDetailCacheKey,
  buildPredictionDetailResourceKey,
  updatePredictionCatalogCacheEntries,
  updatePredictionDetailCacheEntries,
  updatePredictionErrorState,
  updatePredictionPendingCounts,
} from "./cache";
import {
  filterPredictionMarkets,
  getDefaultPredictionSort,
  sortPredictionMarkets,
} from "./metrics";
import { sortPredictionOutcomeMarkets } from "./outcome-order";
import { buildPredictionListRows } from "./rows";
import { loadKalshiCatalog, loadKalshiDetail } from "./services/kalshi-adapter";
import { getCachedPredictionResource } from "./services/fetch";
import {
  loadPolymarketCatalog,
  loadPolymarketDetail,
} from "./services/polymarket-adapter";
import { subscribePolymarketMarket } from "./services/polymarket-ws";
import type {
  PredictionBrowseTab,
  PredictionCategoryId,
  PredictionVenue,
  PredictionListRow,
  PredictionMarketDetail,
  PredictionMarketSummary,
  PredictionSortPreference,
  PredictionTransportState,
  PredictionVenueScope,
} from "./types";

const KEYBOARD_DETAIL_LOAD_DELAY_MS = 140;

function formatPredictionVenueLabel(venue: PredictionVenue): string {
  return venue === "polymarket" ? "Polymarket" : "Kalshi";
}

function joinPredictionVenueLabels(venues: PredictionVenue[]): string {
  const labels = [...new Set(venues.map(formatPredictionVenueLabel))];
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(" and ")} and ${labels.at(-1)}`;
}

function formatPredictionLoadError(
  venue: PredictionVenue,
  subject: "markets" | "market detail",
  error: unknown,
): string {
  const venueLabel = formatPredictionVenueLabel(venue);
  const fallback = `Could not load ${venueLabel} ${subject}.`;
  if (!(error instanceof Error)) {
    return fallback;
  }

  const message = error.message.trim();
  if (message.length === 0) {
    return fallback;
  }

  const requestFailureMatch = message.match(/Request failed \((\d+)\)/i);
  if (requestFailureMatch) {
    return `${venueLabel} ${subject} request failed (${requestFailureMatch[1]}).`;
  }

  if (
    /typo in the url or port|access the url|unable to connect|could not resolve host|connection refused/i.test(
      message,
    )
  ) {
    return `${venueLabel} is unavailable right now.`;
  }

  return `${fallback} ${message}`;
}

export function usePredictionMarketsDataState({
  browseTab,
  categoryId,
  detailOpen,
  effectiveVenueScope,
  focused,
  historyRange,
  includeKalshi,
  includePolymarket,
  searchQuery,
  selectedDetailMarketKey,
  selectedRowKey,
  sortPreference,
  watchlistSet,
}: {
  browseTab: PredictionBrowseTab;
  categoryId: PredictionCategoryId;
  detailOpen: boolean;
  effectiveVenueScope: PredictionVenueScope;
  focused: boolean;
  historyRange: "1D" | "1W" | "1M" | "ALL";
  includeKalshi: boolean;
  includePolymarket: boolean;
  searchQuery: string;
  selectedDetailMarketKey: string | null;
  selectedRowKey: string | null;
  sortPreference: PredictionSortPreference;
  watchlistSet: Set<string>;
}) {
  const [catalogCache, setCatalogCache] = useState<
    Record<string, PredictionMarketSummary[]>
  >({});
  const [catalogPending, setCatalogPending] = useState<Record<string, number>>(
    {},
  );
  const [catalogErrors, setCatalogErrors] = useState<
    Record<string, string | null>
  >({});
  const [detailCache, setDetailCache] = useState<
    Record<string, PredictionMarketDetail>
  >({});
  const [detailPending, setDetailPending] = useState<Record<string, number>>(
    {},
  );
  const [detailErrors, setDetailErrors] = useState<
    Record<string, string | null>
  >({});
  const [transportState, setTransportState] =
    useState<PredictionTransportState>("idle");
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery);

  const selectedSummaryRef = useRef<PredictionMarketSummary | null>(null);
  const detailLoadDelayRef = useRef(0);
  const currentDetailCacheKeyRef = useRef<string | null>(null);

  const normalizedCatalogQuery = debouncedSearchQuery.trim().toLowerCase();
  const polymarketCatalogKey = useMemo(
    () =>
      buildPredictionCatalogCacheKey(
        "polymarket",
        categoryId,
        debouncedSearchQuery,
      ),
    [categoryId, debouncedSearchQuery],
  );
  const kalshiCatalogKey = useMemo(
    () =>
      buildPredictionCatalogCacheKey("kalshi", categoryId, debouncedSearchQuery),
    [categoryId, debouncedSearchQuery],
  );
  const polymarketCatalogResourceKey = useMemo(
    () =>
      buildPredictionCatalogResourceKey(
        "polymarket",
        categoryId,
        normalizedCatalogQuery,
      ),
    [categoryId, normalizedCatalogQuery],
  );
  const kalshiCatalogResourceKey = useMemo(
    () =>
      buildPredictionCatalogResourceKey(
        "kalshi",
        categoryId,
        normalizedCatalogQuery,
      ),
    [categoryId, normalizedCatalogQuery],
  );
  const persistedPolymarketCatalog = useMemo(
    () =>
      getCachedPredictionResource<PredictionMarketSummary[]>(
        "catalog",
        polymarketCatalogResourceKey,
      ) ?? [],
    [polymarketCatalogResourceKey],
  );
  const persistedKalshiCatalog = useMemo(
    () =>
      getCachedPredictionResource<PredictionMarketSummary[]>(
        "catalog",
        kalshiCatalogResourceKey,
      ) ?? [],
    [kalshiCatalogResourceKey],
  );
  const polymarketCatalog =
    catalogCache[polymarketCatalogKey] ?? persistedPolymarketCatalog;
  const kalshiCatalog = catalogCache[kalshiCatalogKey] ?? persistedKalshiCatalog;
  const activeCatalogKeys = useMemo(
    () =>
      [
        includePolymarket ? polymarketCatalogKey : null,
        includeKalshi ? kalshiCatalogKey : null,
      ].filter((value): value is string => value != null),
    [includeKalshi, includePolymarket, kalshiCatalogKey, polymarketCatalogKey],
  );
  const activeCatalogSources = useMemo(
    () =>
      [
        includePolymarket
          ? {
              venue: "polymarket" as const,
              cacheKey: polymarketCatalogKey,
              error: catalogErrors[polymarketCatalogKey] ?? null,
              markets: polymarketCatalog,
            }
          : null,
        includeKalshi
          ? {
              venue: "kalshi" as const,
              cacheKey: kalshiCatalogKey,
              error: catalogErrors[kalshiCatalogKey] ?? null,
              markets: kalshiCatalog,
            }
          : null,
      ].filter(
        (
          value,
        ): value is {
          venue: PredictionVenue;
          cacheKey: string;
          error: string | null;
          markets: PredictionMarketSummary[];
        } => value != null,
      ),
    [
      catalogErrors,
      includeKalshi,
      includePolymarket,
      kalshiCatalog,
      kalshiCatalogKey,
      polymarketCatalog,
      polymarketCatalogKey,
    ],
  );
  const catalogLoadCount = activeCatalogKeys.reduce(
    (count, cacheKey) => count + (catalogPending[cacheKey] ?? 0),
    0,
  );
  const catalogStatus = useMemo(() => {
    const failingSources = activeCatalogSources.filter((source) => !!source.error);
    if (failingSources.length === 0) {
      return null;
    }

    const loadedSources = activeCatalogSources.filter(
      (source) => !source.error && source.markets.length > 0,
    );
    if (failingSources.length < activeCatalogSources.length) {
      const unavailableVenues = joinPredictionVenueLabels(
        failingSources.map((source) => source.venue),
      );
      if (loadedSources.length > 0) {
        return {
          tone: "warning" as const,
          message: `${unavailableVenues} unavailable right now; showing ${joinPredictionVenueLabels(
            loadedSources.map((source) => source.venue),
          )} markets.`,
        };
      }
      return {
        tone: "warning" as const,
        message: `${unavailableVenues} unavailable right now.`,
      };
    }

    return {
      tone: "danger" as const,
      message: failingSources
        .map((source) => source.error)
        .filter((value): value is string => !!value)
        .join(" "),
    };
  }, [activeCatalogSources]);

  const allMarkets = useMemo(() => {
    const merged: PredictionMarketSummary[] = [];
    if (includePolymarket) merged.push(...polymarketCatalog);
    if (includeKalshi) merged.push(...kalshiCatalog);
    return merged;
  }, [includeKalshi, includePolymarket, kalshiCatalog, polymarketCatalog]);

  const allRows = useMemo(
    () => buildPredictionListRows(allMarkets),
    [allMarkets],
  );

  const visibleRows = useMemo(() => {
    const filtered = filterPredictionMarkets(
      allRows,
      browseTab,
      effectiveVenueScope,
      categoryId,
      debouncedSearchQuery,
      watchlistSet,
    );
    return sortPredictionMarkets(
      filtered,
      sortPreference.columnId
        ? sortPreference
        : getDefaultPredictionSort(browseTab),
    );
  }, [
    allRows,
    browseTab,
    categoryId,
    debouncedSearchQuery,
    effectiveVenueScope,
    sortPreference,
    watchlistSet,
  ]);

  const selectedRow = useMemo(
    () => visibleRows.find((row) => row.key === selectedRowKey) ?? null,
    [selectedRowKey, visibleRows],
  );
  const selectedSummary = useMemo(
    () => {
      if (!detailOpen || !selectedRow) {
        return null;
      }
      return (
      selectedRow?.markets.find(
        (market) => market.key === selectedDetailMarketKey,
      ) ??
      selectedRow?.markets.find(
        (market) => market.key === selectedRow.focusMarketKey,
      ) ??
      selectedRow?.representative ??
      null
      );
    },
    [detailOpen, selectedDetailMarketKey, selectedRow],
  );
  const selectedSummaryKey = selectedSummary?.key ?? null;
  const selectedSummaryVenue = selectedSummary?.venue ?? null;
  const selectedYesTokenId = selectedSummary?.yesTokenId ?? null;
  const selectedNoTokenId = selectedSummary?.noTokenId ?? null;
  const detailCacheKey = selectedSummaryKey
    ? buildPredictionDetailCacheKey(selectedSummaryKey, historyRange)
    : null;
  const detailResourceKey = selectedSummaryKey
    ? buildPredictionDetailResourceKey(selectedSummaryKey, historyRange)
    : null;
  const persistedDetail = useMemo(
    () =>
      detailResourceKey
        ? getCachedPredictionResource<PredictionMarketDetail>(
            "detail",
            detailResourceKey,
          )
        : null,
    [detailResourceKey],
  );
  const detail = detailCacheKey
    ? detailCache[detailCacheKey] ?? persistedDetail ?? null
    : null;
  const detailLoadCount = detailCacheKey ? detailPending[detailCacheKey] ?? 0 : 0;
  const detailError = detailCacheKey ? detailErrors[detailCacheKey] ?? null : null;
  const selectedIndex = selectedRow
    ? visibleRows.findIndex((row) => row.key === selectedRow.key)
    : -1;
  const sortedOutcomeMarkets = useMemo(
    () =>
      selectedRow?.kind === "group"
        ? sortPredictionOutcomeMarkets(selectedRow.markets)
        : [],
    [selectedRow],
  );

  const loadPolymarket = useCallback(
    async (cacheKey: string, search: string, category: PredictionCategoryId) => {
      setCatalogPending((current) =>
        updatePredictionPendingCounts(current, cacheKey, 1),
      );
      try {
        const next = await loadPolymarketCatalog(search, category);
        setCatalogCache((current) => ({
          ...current,
          [cacheKey]: next,
        }));
        setCatalogErrors((current) =>
          updatePredictionErrorState(current, cacheKey, null),
        );
        setLastRefreshAt(Date.now());
      } catch (error) {
        setCatalogErrors((current) =>
          updatePredictionErrorState(
            current,
            cacheKey,
            formatPredictionLoadError("polymarket", "markets", error),
          ),
        );
      } finally {
        setCatalogPending((current) =>
          updatePredictionPendingCounts(current, cacheKey, -1),
        );
      }
    },
    [],
  );

  const loadKalshi = useCallback(
    async (cacheKey: string, search: string, category: PredictionCategoryId) => {
      setCatalogPending((current) =>
        updatePredictionPendingCounts(current, cacheKey, 1),
      );
      try {
        const next = await loadKalshiCatalog(search, category);
        setCatalogCache((current) => ({
          ...current,
          [cacheKey]: next,
        }));
        setCatalogErrors((current) =>
          updatePredictionErrorState(current, cacheKey, null),
        );
        setLastRefreshAt(Date.now());
      } catch (error) {
        setCatalogErrors((current) =>
          updatePredictionErrorState(
            current,
            cacheKey,
            formatPredictionLoadError("kalshi", "markets", error),
          ),
        );
      } finally {
        setCatalogPending((current) =>
          updatePredictionPendingCounts(current, cacheKey, -1),
        );
      }
    },
    [],
  );

  const loadSelectedDetail = useCallback(
    async (summary: PredictionMarketSummary) => {
      const cacheKey = buildPredictionDetailCacheKey(summary.key, historyRange);
      const isCurrentSelection = currentDetailCacheKeyRef.current === cacheKey;
      setDetailPending((current) =>
        updatePredictionPendingCounts(current, cacheKey, 1),
      );
      if (isCurrentSelection) {
        setTransportState(summary.venue === "polymarket" ? "loading" : "polling");
      }
      try {
        const next =
          summary.venue === "polymarket"
            ? await loadPolymarketDetail(summary, historyRange)
            : await loadKalshiDetail(summary, historyRange);
        setDetailCache((current) => ({
          ...current,
          [cacheKey]: next,
        }));
        setCatalogCache((current) =>
          updatePredictionCatalogCacheEntries(current, summary.key, () => next.summary),
        );
        setDetailErrors((current) =>
          updatePredictionErrorState(current, cacheKey, null),
        );
        setLastRefreshAt(Date.now());
        if (currentDetailCacheKeyRef.current === cacheKey) {
          setTransportState(
            summary.venue === "polymarket" ? "stale" : "polling",
          );
        }
      } catch (error) {
        setDetailErrors((current) =>
          updatePredictionErrorState(
            current,
            cacheKey,
            formatPredictionLoadError(summary.venue, "market detail", error),
          ),
        );
        if (currentDetailCacheKeyRef.current === cacheKey) {
          setTransportState("error");
        }
      } finally {
        setDetailPending((current) =>
          updatePredictionPendingCounts(current, cacheKey, -1),
        );
      }
    },
    [historyRange],
  );

  useEffect(() => {
    if (!searchQuery.trim()) {
      setDebouncedSearchQuery("");
      return;
    }
    const timeoutId = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, 250);
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  useEffect(() => {
    if (!includePolymarket) return;
    void loadPolymarket(
      polymarketCatalogKey,
      debouncedSearchQuery,
      categoryId,
    );
    const intervalId = setInterval(() => {
      void loadPolymarket(
        polymarketCatalogKey,
        debouncedSearchQuery,
        categoryId,
      );
    }, 30_000);
    return () => clearInterval(intervalId);
  }, [
    categoryId,
    debouncedSearchQuery,
    includePolymarket,
    loadPolymarket,
    polymarketCatalogKey,
  ]);

  useEffect(() => {
    if (!includeKalshi) return;
    void loadKalshi(kalshiCatalogKey, debouncedSearchQuery, categoryId);
    const intervalId = setInterval(() => {
      void loadKalshi(kalshiCatalogKey, debouncedSearchQuery, categoryId);
    }, 20_000);
    return () => clearInterval(intervalId);
  }, [
    categoryId,
    debouncedSearchQuery,
    includeKalshi,
    kalshiCatalogKey,
    loadKalshi,
  ]);

  useEffect(() => {
    selectedSummaryRef.current = selectedSummary;
  }, [selectedSummary]);

  useEffect(() => {
    currentDetailCacheKeyRef.current = detailCacheKey;
  }, [detailCacheKey]);

  useEffect(() => {
    if (!selectedSummary) {
      setTransportState("idle");
      return;
    }
    const detailSummary = selectedSummaryRef.current;
    if (!detailSummary) {
      setTransportState("idle");
      return;
    }
    const delayMs = detailLoadDelayRef.current;
    detailLoadDelayRef.current = 0;
    const timeoutId = setTimeout(() => {
      void loadSelectedDetail(detailSummary);
    }, delayMs);
    return () => clearTimeout(timeoutId);
  }, [loadSelectedDetail, selectedSummaryKey]);

  useEffect(() => {
    if (!focused || selectedSummaryVenue !== "kalshi" || !selectedSummaryKey) {
      return;
    }
    const intervalId = setInterval(() => {
      const summary = selectedSummaryRef.current;
      if (summary) {
        void loadSelectedDetail(summary);
      }
    }, 5_000);
    return () => clearInterval(intervalId);
  }, [focused, loadSelectedDetail, selectedSummaryKey, selectedSummaryVenue]);

  useEffect(() => {
    if (
      selectedSummaryVenue !== "polymarket" ||
      (!selectedYesTokenId && !selectedNoTokenId) ||
      !selectedSummaryKey
    ) {
      return;
    }

    const marketKey = selectedSummaryKey;
    return subscribePolymarketMarket(
      [selectedYesTokenId, selectedNoTokenId].filter(
        (value): value is string => !!value,
      ),
      {
        onBestBidAsk: (assetId, bestBid, bestAsk, spread) => {
          setTransportState("live");
          setCatalogCache((current) =>
            updatePredictionCatalogCacheEntries(current, marketKey, (summary) => {
              const isYes = assetId === summary.yesTokenId;
              if (isYes) {
                return {
                  ...summary,
                  yesBid: bestBid,
                  yesAsk: bestAsk,
                  spread: spread ?? summary.spread,
                };
              }
              return {
                ...summary,
                noBid: bestBid,
                noAsk: bestAsk,
                spread: spread ?? summary.spread,
              };
            }),
          );
          setDetailCache((current) =>
            updatePredictionDetailCacheEntries(current, marketKey, (detailEntry) => {
              const isYes = assetId === detailEntry.summary.yesTokenId;
              return {
                ...detailEntry,
                summary: isYes
                  ? {
                      ...detailEntry.summary,
                      yesBid: bestBid,
                      yesAsk: bestAsk,
                      spread: spread ?? detailEntry.summary.spread,
                    }
                  : {
                      ...detailEntry.summary,
                      noBid: bestBid,
                      noAsk: bestAsk,
                      spread: spread ?? detailEntry.summary.spread,
                    },
              };
            }),
          );
        },
        onBook: (assetId, bids, asks, lastTradePrice) => {
          setTransportState("live");
          setDetailCache((current) =>
            updatePredictionDetailCacheEntries(current, marketKey, (detailEntry) => {
              const isYes = assetId === detailEntry.summary.yesTokenId;
              return {
                ...detailEntry,
                book: isYes
                  ? {
                      ...detailEntry.book,
                      yesBids: bids,
                      yesAsks: asks,
                      lastTradePrice:
                        lastTradePrice ?? detailEntry.book.lastTradePrice,
                    }
                  : {
                      ...detailEntry.book,
                      noBids: bids,
                      noAsks: asks,
                      lastTradePrice:
                        lastTradePrice ?? detailEntry.book.lastTradePrice,
                    },
              };
            }),
          );
        },
        onTrade: (assetId, trade) => {
          setTransportState("live");
          setDetailCache((current) =>
            updatePredictionDetailCacheEntries(current, marketKey, (detailEntry) => {
              const isYes = assetId === detailEntry.summary.yesTokenId;
              const normalizedYesPrice = isYes
                ? trade.price
                : Math.max(0, 1 - trade.price);
              return {
                ...detailEntry,
                summary: {
                  ...detailEntry.summary,
                  lastTradePrice: normalizedYesPrice,
                  yesPrice: normalizedYesPrice,
                  noPrice: Math.max(0, 1 - normalizedYesPrice),
                },
                trades: [
                  {
                    ...trade,
                    outcome: isYes ? ("yes" as const) : ("no" as const),
                    price: trade.price,
                  },
                  ...detailEntry.trades,
                ].slice(0, 40),
              };
            }),
          );
          setCatalogCache((current) =>
            updatePredictionCatalogCacheEntries(current, marketKey, (summary) => {
              const isYes = assetId === summary.yesTokenId;
              const normalizedYesPrice = isYes
                ? trade.price
                : Math.max(0, 1 - trade.price);
              return {
                ...summary,
                lastTradePrice: normalizedYesPrice,
                yesPrice: normalizedYesPrice,
                noPrice: Math.max(0, 1 - normalizedYesPrice),
              };
            }),
          );
        },
      },
    );
  }, [
    selectedNoTokenId,
    selectedSummaryKey,
    selectedSummaryVenue,
    selectedYesTokenId,
  ]);

  const setNextDetailLoadDelay = useCallback((delayMs: number) => {
    detailLoadDelayRef.current = Math.max(0, delayMs);
  }, []);

  return {
    catalogStatus,
    catalogLoadCount,
    debouncedSearchQuery,
    detail,
    detailError,
    detailLoadCount,
    lastRefreshAt,
    selectedIndex,
    selectedRow,
    selectedSummary,
    selectedSummaryKey,
    sortedOutcomeMarkets,
    transportState,
    visibleRows,
    actions: {
      setNextDetailLoadDelay,
    },
  };
}
