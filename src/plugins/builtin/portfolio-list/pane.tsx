import { Box } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Tabs,
  usePaneFooter,
  type DataTableKeyEvent,
  type PaneFooterSegment,
  type TickerListVisibleRange,
} from "../../../components";
import { createRowValueCache } from "../../../components/ui/row-value-cache";
import { usePluginTickerActions } from "../../plugin-runtime";
import { getSharedMarketDataCoordinator } from "../../../market-data/coordinator";
import { useFxRatesMap, useTickerFinancialsMap } from "../../../market-data/hooks";
import { instrumentFromTicker, quoteSubscriptionTargetFromTicker } from "../../../market-data/request-types";
import { useAppActive } from "../../../state/app-activity";
import {
  useAppSelector,
  usePaneCollection,
  usePaneInstance,
  usePaneStateValue,
  type CollectionSortPreference,
} from "../../../state/app-context";
import { useQuoteStreaming } from "../../../state/use-quote-streaming";
import { selectEffectiveExchangeRates } from "../../../utils/exchange-rate-map";
import { getActiveQuoteDisplay } from "../../../utils/market-status";
import type { AppConfig, ColumnConfig } from "../../../types/config";
import type { TickerRecord } from "../../../types/ticker";
import type { PaneProps } from "../../../types/plugin";
import type { TickerFinancials } from "../../../types/financials";
import { calculatePortfolioSummaryTotals, getSortValue, resolveCollectionSortPreference, type ColumnContext } from "./metrics";
import {
  PortfolioCashMarginDrawer,
  shouldToggleCashMarginDrawer,
  usePortfolioAccountState,
} from "./header";
import { buildPortfolioSummarySegments, type ResolvedPortfolioAccountState } from "./summary";
import {
  getCollectionEntries,
  getPortfolioPaneSettings,
  resolveActiveCollectionId,
  resolveScopedCollectionEntries,
  resolveVisibleColumns,
} from "./settings";
import { formatPercentRaw } from "../../../utils/format";
import { getMostRecentQuoteUpdate } from "../../../utils/quote-time";
import { priceColor } from "../../../theme/colors";
import { PortfolioTickerTable, type QuoteFlashDirection } from "./table";
import { useThrottledCursorSymbol } from "./use-throttled-cursor-symbol";
import { isManualPortfolio } from "./mutations";
import { QuickAddTickerInput, type QuickAddCollectionKind } from "./quick-add";
import { PRICE_SPARKLINE_COLUMN_ID } from "../../../components/price-sparkline-view";

const VISIBLE_FINANCIAL_REFRESH_COOLDOWN_MS = 5 * 60_000;
const VISIBLE_FINANCIAL_WARMUP_DELAY_MS = 350;
const VISIBLE_SNAPSHOT_WARMUP_BATCH_LIMIT = 3;
const STREAM_OVERSCAN_ROWS = 6;
const FUNDAMENTAL_COLUMN_IDS = new Set(["pe", "forward_pe", "dividend_yield"]);
const sortValueCache = createRowValueCache<string, ReturnType<typeof getSortValue>>(5000);

interface VisibleWarmupRequirements {
  fundamentals: boolean;
  priceHistory: boolean;
}

function resolveVisibleWarmupRequirements(columns: ColumnConfig[]): VisibleWarmupRequirements {
  return {
    fundamentals: columns.some((column) => FUNDAMENTAL_COLUMN_IDS.has(column.id)),
    priceHistory: columns.some((column) => column.id === PRICE_SPARKLINE_COLUMN_ID),
  };
}

function visibleWarmupKey(kind: "quote" | "snapshot", ticker: TickerRecord): string {
  return `${kind}:${ticker.metadata.ticker}:${ticker.metadata.exchange ?? ""}`;
}

function needsVisibleQuoteWarmup(ticker: TickerRecord, financials: TickerFinancials | undefined): boolean {
  if (ticker.metadata.assetCategory === "OPT") return false;
  return !financials?.quote;
}

function needsVisibleSnapshotWarmup(
  ticker: TickerRecord,
  financials: TickerFinancials | undefined,
  requirements: VisibleWarmupRequirements,
): boolean {
  if (ticker.metadata.assetCategory === "OPT") return false;
  if (!financials?.quote) return false;
  if (requirements.fundamentals && Object.keys(financials.fundamentals ?? {}).length === 0) return true;
  return requirements.priceHistory && financials.priceHistory.length === 0;
}

export function selectStreamTickers(
  tickers: TickerRecord[],
  visibleRange: { start: number; end: number },
  selectedSymbol?: string | null,
) {
  const start = Math.max(0, visibleRange.start - STREAM_OVERSCAN_ROWS);
  const end = Math.min(tickers.length, visibleRange.end + STREAM_OVERSCAN_ROWS);
  const visible = tickers.slice(start, end);
  if (!selectedSymbol || visible.some((ticker) => ticker.metadata.ticker === selectedSymbol)) {
    return visible;
  }
  const selectedTicker = tickers.find((ticker) => ticker.metadata.ticker === selectedSymbol);
  return selectedTicker ? [...visible, selectedTicker] : visible;
}

function buildTrackedCurrencies(
  tickers: TickerRecord[],
  financialsMap: Map<string, TickerFinancials>,
  accountState: ResolvedPortfolioAccountState | null,
  baseCurrency: string,
): string[] {
  const currencies = new Set<string>([baseCurrency]);

  for (const ticker of tickers) {
    if (ticker.metadata.currency) {
      currencies.add(ticker.metadata.currency);
    }
    for (const position of ticker.metadata.positions) {
      if (position.currency) {
        currencies.add(position.currency);
      }
    }
    const financials = financialsMap.get(ticker.metadata.ticker);
    if (financials?.quote?.currency) {
      currencies.add(financials.quote.currency);
    }
  }

  for (const balance of accountState?.visibleCashBalances ?? []) {
    if (balance.currency) {
      currencies.add(balance.currency);
    }
    if (balance.baseCurrency) {
      currencies.add(balance.baseCurrency);
    }
  }

  return [...currencies];
}

function getCollectionTypeFromConfig(config: AppConfig, collectionId: string | null): "portfolio" | "watchlist" | null {
  if (!collectionId) return null;
  if (config.portfolios.some((portfolio) => portfolio.id === collectionId)) return "portfolio";
  if (config.watchlists.some((watchlist) => watchlist.id === collectionId)) return "watchlist";
  return null;
}

function getCollectionTickersFromConfig(
  config: AppConfig,
  tickersBySymbol: Map<string, TickerRecord>,
  collectionId: string | null,
): TickerRecord[] {
  if (!collectionId) return [];
  const isPortfolio = config.portfolios.some((portfolio) => portfolio.id === collectionId);
  const isWatchlist = !isPortfolio && config.watchlists.some((watchlist) => watchlist.id === collectionId);
  if (!isPortfolio && !isWatchlist) return [];
  return [...tickersBySymbol.values()]
    .filter((ticker) => (
      isPortfolio
        ? ticker.metadata.portfolios.includes(collectionId)
        : ticker.metadata.watchlists.includes(collectionId)
    ))
    .sort((left, right) => left.metadata.ticker.localeCompare(right.metadata.ticker));
}

function sortTickers(
  tickers: TickerRecord[],
  financialsMap: Map<string, TickerFinancials>,
  sortPreference: CollectionSortPreference,
  columnContext: ColumnContext,
  columns: ColumnConfig[],
) {
  if (!sortPreference.columnId) return tickers;

  const sortColumn = columns.find((column) => column.id === sortPreference.columnId);
  if (!sortColumn) return tickers;
  const exchangeRatesVersion = [...columnContext.exchangeRates]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, rate]) => `${currency}:${rate}`)
    .join(",");
  const sortContextVersion = [
    sortColumn.id,
    columnContext.activeTab ?? "",
    columnContext.baseCurrency,
    exchangeRatesVersion,
    sortColumn.id === "latency" ? columnContext.now : 0,
  ].join("|");
  const sortValues = new Map<string, ReturnType<typeof getSortValue>>();
  for (const ticker of tickers) {
    const financials = financialsMap.get(ticker.metadata.ticker);
    const financialsVersion = [
      financials?.quote?.lastUpdated ?? 0,
      Object.keys(financials?.fundamentals ?? {}).length,
      financials?.priceHistory.length ?? 0,
    ].join(":");
    const positionsVersion = JSON.stringify(ticker.metadata.positions);
    const version = `${sortContextVersion}|${financialsVersion}|${positionsVersion}`;
    sortValues.set(ticker.metadata.ticker, sortValueCache.get(
      `${ticker.metadata.ticker}:${sortColumn.id}`,
      version,
      () => getSortValue(sortColumn, ticker, financials, columnContext),
    ));
  }

  return [...tickers].sort((leftTicker, rightTicker) => {
    const leftValue = sortValues.get(leftTicker.metadata.ticker) ?? null;
    const rightValue = sortValues.get(rightTicker.metadata.ticker) ?? null;

    if (leftValue == null && rightValue == null) return 0;
    if (leftValue == null) return 1;
    if (rightValue == null) return -1;

    const comparison = typeof leftValue === "string" && typeof rightValue === "string"
      ? leftValue.localeCompare(rightValue)
      : (leftValue as number) - (rightValue as number);

    return sortPreference.direction === "asc" ? comparison : -comparison;
  });
}

export function PortfolioListPane({ focused, width, height }: PaneProps) {
  const { pinTicker } = usePluginTickerActions();
  const paneInstance = usePaneInstance();
  const appActive = useAppActive();
  const config = useAppSelector((state) => state.config);
  const tickersBySymbol = useAppSelector((state) => state.tickers);
  const cachedFinancials = useAppSelector((state) => state.financials);
  const cachedExchangeRates = useAppSelector((state) => state.exchangeRates);
  const brokerAccounts = useAppSelector((state) => state.brokerAccounts);
  const refreshingSize = useAppSelector((state) => state.refreshing.size);
  const paneCollection = usePaneCollection();

  const [currentCollectionId, setCurrentCollectionId] = usePaneStateValue<string>("collectionId", paneCollection.collectionId ?? "");
  const [committedCursorSymbol, setCommittedCursorSymbol] = usePaneStateValue<string | null>("cursorSymbol", null);
  const [collectionSorts, setCollectionSorts] = usePaneStateValue<Record<string, CollectionSortPreference>>("collectionSorts", {});
  const [cashDrawerExpanded, setCashDrawerExpanded] = usePaneStateValue<boolean>("cashDrawerExpanded", false);

  const [now, setNow] = useState(Date.now());
  const [flashSymbols, setFlashSymbols] = useState<Map<string, QuoteFlashDirection>>(new Map());
  const [streamWindow, setStreamWindow] = useState({ start: 0, end: 24 });
  const [quickAddFocused, setQuickAddFocused] = useState(false);

  const previousPricesRef = useRef<Map<string, number>>(new Map());
  const mountedRef = useRef(true);
  const warmupInFlightRef = useRef(new Set<string>());
  const warmupAttemptRef = useRef(new Map<string, number>());
  const {
    cursorSymbol,
    setCursorSymbol,
    flushCursorSymbol,
    cancelPendingCursorSymbol,
  } = useThrottledCursorSymbol(committedCursorSymbol, setCommittedCursorSymbol);

  const paneSettings = useMemo(
    () => getPortfolioPaneSettings(paneInstance?.settings),
    [paneInstance?.settings],
  );
  const collectionEntries = useMemo(
    () => getCollectionEntries(config),
    [config],
  );
  const visibleCollections = useMemo(
    () => resolveScopedCollectionEntries(collectionEntries, paneSettings),
    [collectionEntries, paneSettings],
  );
  const activeCollectionId = resolveActiveCollectionId(currentCollectionId, visibleCollections);
  const isPortfolioTab = getCollectionTypeFromConfig(config, activeCollectionId) === "portfolio";
  const activeCollectionEntry = visibleCollections.find((collection) => collection.id === activeCollectionId) ?? null;
  const currentPortfolio = useMemo(() => (
    isPortfolioTab
      ? config.portfolios.find((portfolio) => portfolio.id === activeCollectionId) ?? null
      : null
  ), [activeCollectionId, config.portfolios, isPortfolioTab]);

  const tickers = useMemo(
    () => getCollectionTickersFromConfig(config, tickersBySymbol, activeCollectionId),
    [activeCollectionId, config, tickersBySymbol],
  );
  const marketFinancialsMap = useTickerFinancialsMap(tickers);
  const sharedCoordinator = getSharedMarketDataCoordinator();
  const financialsMap = useMemo(() => {
    const merged = sharedCoordinator ? new Map<string, TickerFinancials>() : new Map(cachedFinancials);
    for (const [symbol, financials] of marketFinancialsMap) {
      merged.set(symbol, financials);
    }
    return merged;
  }, [cachedFinancials, marketFinancialsMap, sharedCoordinator]);

  const accountStateInput = useMemo(() => ({ brokerAccounts, config }), [brokerAccounts, config]);
  const accountState = usePortfolioAccountState(currentPortfolio, accountStateInput);
  const columns = useMemo(
    () => resolveVisibleColumns(paneSettings.columnIds, isPortfolioTab),
    [isPortfolioTab, paneSettings.columnIds],
  );
  const visibleWarmupRequirements = useMemo(
    () => resolveVisibleWarmupRequirements(columns),
    [columns],
  );

  const trackedCurrencies = useMemo(
    () => buildTrackedCurrencies(tickers, financialsMap, accountState, config.baseCurrency),
    [accountState, config.baseCurrency, financialsMap, tickers],
  );
  const fetchedExchangeRates = useFxRatesMap(trackedCurrencies);
  const effectiveExchangeRates = selectEffectiveExchangeRates(fetchedExchangeRates, cachedExchangeRates);

  const columnContext: ColumnContext = useMemo(() => ({
    activeTab: isPortfolioTab ? activeCollectionId : undefined,
    baseCurrency: config.baseCurrency,
    exchangeRates: effectiveExchangeRates,
    now,
  }), [activeCollectionId, config.baseCurrency, effectiveExchangeRates, isPortfolioTab, now]);

  const activeSort = resolveCollectionSortPreference(activeCollectionId, isPortfolioTab, collectionSorts);
  const sortedTickers = useMemo(
    () => sortTickers(tickers, financialsMap, activeSort, columnContext, columns),
    [tickers, financialsMap, activeSort, columnContext, columns],
  );

  const selectedIdx = sortedTickers.findIndex((ticker) => ticker.metadata.ticker === cursorSymbol);
  const safeSelectedIdx = selectedIdx >= 0 ? selectedIdx : 0;

  const showCashDrawer = !paneSettings.hideCash && !!(isPortfolioTab && currentPortfolio?.brokerInstanceId && accountState);
  const requestedDrawerHeight = showCashDrawer
    ? (cashDrawerExpanded ? Math.min(6, Math.max(3, 2 + accountState.visibleCashBalances.length)) : 1)
    : 0;
  const showCollectionTabs = visibleCollections.length > 1;
  const headerHeight = showCollectionTabs ? 1 : 0;
  const drawerHeight = showCashDrawer
    ? Math.min(requestedDrawerHeight, Math.max(1, height - (headerHeight + 2)))
    : 0;

  const handleVisibleRangeChange = useCallback(({ start, end }: TickerListVisibleRange) => {
    setStreamWindow((current) => (
      current.start === start && current.end === end ? current : { start, end }
    ));
  }, []);

  const handleCollectionSelect = useCallback((collectionId: string) => {
    cancelPendingCursorSymbol();
    setCurrentCollectionId(collectionId);
  }, [cancelPendingCursorSymbol, setCurrentCollectionId]);

  const setSortPreference = useCallback((preference: CollectionSortPreference) => {
    if (!activeCollectionId) return;
    setCollectionSorts({
      ...collectionSorts,
      [activeCollectionId]: preference,
    });
  }, [activeCollectionId, collectionSorts, setCollectionSorts]);

  const handleHeaderClick = useCallback((columnId: string) => {
    if (activeSort.columnId === columnId) {
      setSortPreference(
        activeSort.direction === "asc"
          ? { columnId, direction: "desc" }
          : { columnId: null, direction: "asc" },
      );
      return;
    }
    setSortPreference({ columnId, direction: "asc" });
  }, [activeSort.columnId, activeSort.direction, setSortPreference]);

  const openTickerFloating = useCallback((symbol: string) => {
    pinTicker(symbol, { floating: true, paneType: "ticker-detail" });
  }, [pinTicker]);

  const handleRowActivate = useCallback((ticker: TickerRecord) => {
    flushCursorSymbol(ticker.metadata.ticker);
    openTickerFloating(ticker.metadata.ticker);
  }, [flushCursorSymbol, openTickerFloating]);
  const handleTickerAdded = useCallback((symbol: string) => {
    setCursorSymbol(symbol, { immediate: true });
  }, [setCursorSymbol]);

  const handleTableKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (!focused) return;

    const key = event.name;
    const isEnter = key === "enter" || key === "return";

    if (isEnter && event.shift) {
      event.preventDefault?.();
      event.stopPropagation?.();
      const ticker = sortedTickers[safeSelectedIdx];
      if (ticker) {
        openTickerFloating(ticker.metadata.ticker);
      }
      return true;
    }

    if (shouldToggleCashMarginDrawer(key, showCashDrawer)) {
      event.preventDefault?.();
      event.stopPropagation?.();
      setCashDrawerExpanded(!cashDrawerExpanded);
      return true;
    }

    return false;
  }, [
    cashDrawerExpanded,
    focused,
    openTickerFloating,
    safeSelectedIdx,
    setCashDrawerExpanded,
    showCashDrawer,
    sortedTickers,
  ]);

  useEffect(() => {
    if (activeCollectionId !== currentCollectionId) {
      cancelPendingCursorSymbol();
      setCurrentCollectionId(activeCollectionId);
    }
  }, [activeCollectionId, cancelPendingCursorSymbol, currentCollectionId, setCurrentCollectionId]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!appActive) return;
    const timerId = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timerId);
  }, [appActive]);

  useEffect(() => {
    const changed = new Map<string, QuoteFlashDirection>();

    for (const [symbol, financials] of financialsMap) {
      const price = getActiveQuoteDisplay(financials.quote)?.price ?? financials.quote?.price;
      if (price == null) continue;

      const previousPrice = previousPricesRef.current.get(symbol);
      if (previousPrice != null && previousPrice !== price) {
        changed.set(symbol, price > previousPrice ? "up" : price < previousPrice ? "down" : "flat");
      }
      previousPricesRef.current.set(symbol, price);
    }

    if (changed.size === 0) return;

    setFlashSymbols(changed);
    const timeoutId = setTimeout(() => setFlashSymbols(new Map()), 450);
    return () => clearTimeout(timeoutId);
  }, [financialsMap]);

  useEffect(() => {
    if (sortedTickers.length === 0) {
      if (cursorSymbol !== null) setCursorSymbol(null, { immediate: true });
      return;
    }

    const hasSelection = cursorSymbol && sortedTickers.some((ticker) => ticker.metadata.ticker === cursorSymbol);
    if (!hasSelection) {
      setCursorSymbol(sortedTickers[0]!.metadata.ticker, { immediate: true });
    }
  }, [cursorSymbol, setCursorSymbol, sortedTickers]);

  const streamTickers = useMemo(
    () => selectStreamTickers(sortedTickers, streamWindow, cursorSymbol),
    [cursorSymbol, sortedTickers, streamWindow],
  );
  const streamTargets = useMemo(() => (
    streamTickers
      .map((ticker) => quoteSubscriptionTargetFromTicker(ticker, ticker.metadata.ticker, "provider"))
      .filter((target): target is NonNullable<typeof target> => target != null)
  ), [streamTickers]);
  const visibleFinancialTickers = useMemo(
    () => sortedTickers.slice(streamWindow.start, streamWindow.end),
    [sortedTickers, streamWindow.end, streamWindow.start],
  );

  useEffect(() => {
    if (!appActive) return;
    if (!focused) return;
    if (!sharedCoordinator) return;

    const nowTimestamp = Date.now();
    const quoteQueue: TickerRecord[] = [];
    const snapshotQueue: TickerRecord[] = [];
    for (const ticker of visibleFinancialTickers) {
      const financials = financialsMap.get(ticker.metadata.ticker);
      const quoteKey = visibleWarmupKey("quote", ticker);
      if (
        needsVisibleQuoteWarmup(ticker, financials)
        && !warmupInFlightRef.current.has(quoteKey)
        && nowTimestamp - (warmupAttemptRef.current.get(quoteKey) ?? 0) >= VISIBLE_FINANCIAL_REFRESH_COOLDOWN_MS
      ) {
        quoteQueue.push(ticker);
        continue;
      }

      const snapshotKey = visibleWarmupKey("snapshot", ticker);
      if (
        needsVisibleSnapshotWarmup(ticker, financials, visibleWarmupRequirements)
        && !warmupInFlightRef.current.has(snapshotKey)
        && nowTimestamp - (warmupAttemptRef.current.get(snapshotKey) ?? 0) >= VISIBLE_FINANCIAL_REFRESH_COOLDOWN_MS
      ) {
        snapshotQueue.push(ticker);
      }
    }
    const limitedSnapshotQueue = snapshotQueue.slice(0, VISIBLE_SNAPSHOT_WARMUP_BATCH_LIMIT);
    if (quoteQueue.length === 0 && limitedSnapshotQueue.length === 0) return;

    let cancelled = false;
    const runBatch = async (): Promise<void> => {
      const quoteEntries = quoteQueue.flatMap((ticker) => {
        const instrument = instrumentFromTicker(ticker, ticker.metadata.ticker);
        if (!instrument) return [];
        const key = visibleWarmupKey("quote", ticker);
        warmupInFlightRef.current.add(key);
        warmupAttemptRef.current.set(key, nowTimestamp);
        return [{ key, instrument }];
      });
      const snapshotEntries = limitedSnapshotQueue.flatMap((ticker) => {
        const instrument = instrumentFromTicker(ticker, ticker.metadata.ticker);
        if (!instrument) return [];
        const key = visibleWarmupKey("snapshot", ticker);
        warmupInFlightRef.current.add(key);
        warmupAttemptRef.current.set(key, nowTimestamp);
        return [{ key, instrument }];
      });
      if (quoteEntries.length === 0 && snapshotEntries.length === 0) return;
      try {
        await Promise.allSettled([
          quoteEntries.length > 0
            ? sharedCoordinator.loadQuotesBatch(quoteEntries.map((entry) => entry.instrument))
            : Promise.resolve(),
          snapshotEntries.length > 0
            ? sharedCoordinator.loadSnapshotsBatch(snapshotEntries.map((entry) => entry.instrument))
            : Promise.resolve(),
        ]);
      } catch {
        // Best-effort warmup for visible rows only.
      } finally {
        for (const entry of [...quoteEntries, ...snapshotEntries]) {
          warmupInFlightRef.current.delete(entry.key);
        }
      }
    };

    const timeoutId = setTimeout(() => {
      if (!cancelled && mountedRef.current) void runBatch();
    }, VISIBLE_FINANCIAL_WARMUP_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [appActive, financialsMap, focused, sharedCoordinator, visibleFinancialTickers, visibleWarmupRequirements]);

  useQuoteStreaming(streamTargets);

  const summaryFooterInfo = useMemo<PaneFooterSegment[]>(() => {
    if (paneSettings.hideHeader) return [];

    const lastRefreshTimestamp = getMostRecentQuoteUpdate(
      sortedTickers.map((ticker) => financialsMap.get(ticker.metadata.ticker)?.quote),
    );
    const refreshText = refreshingSize > 0
      ? "Refreshing..."
      : lastRefreshTimestamp != null
        ? new Date(lastRefreshTimestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        : "-";
    const totals = calculatePortfolioSummaryTotals(
      sortedTickers,
      financialsMap,
      config.baseCurrency,
      effectiveExchangeRates,
      isPortfolioTab,
      activeCollectionId,
    );

    if (!isPortfolioTab) {
      if (totals.watchlistCount === 0) return [];
      return [
        {
          id: "avg-day",
          parts: [
            { text: "Avg Day", tone: "label" },
            { text: formatPercentRaw(totals.avgWatchlistChange), tone: "value", color: priceColor(totals.avgWatchlistChange), bold: true },
          ],
        },
        {
          id: "refresh",
          parts: [{ text: refreshText, tone: "muted" }],
        },
      ];
    }

    if (!totals.hasPositions && !accountState) return [];
    return buildPortfolioSummarySegments({
      totals,
      accountState: accountState ? { account: accountState.account, sourceLabel: accountState.sourceLabel } : null,
      widthBudget: Math.max(16, width - 14),
      refreshText,
    }).map((segment) => ({
      id: segment.id,
      parts: segment.parts,
    }));
  }, [
    accountState,
    activeCollectionId,
    effectiveExchangeRates,
    financialsMap,
    isPortfolioTab,
    paneSettings.hideHeader,
    config.baseCurrency,
    refreshingSize,
    sortedTickers,
    width,
  ]);

  usePaneFooter("portfolio-list", () => ({
    info: summaryFooterInfo,
    hints: showCashDrawer
      ? [{
          id: "cash",
          key: "c",
          label: "ash",
          onPress: () => setCashDrawerExpanded(!cashDrawerExpanded),
        }]
      : [],
  }), [cashDrawerExpanded, setCashDrawerExpanded, showCashDrawer, summaryFooterInfo]);

  const quickAddCollectionKind = useMemo<QuickAddCollectionKind | null>(() => {
    if (!activeCollectionId) return null;
    const collectionType = getCollectionTypeFromConfig(config, activeCollectionId);
    if (collectionType === "watchlist") return "watchlist";
    if (collectionType === "portfolio" && currentPortfolio && isManualPortfolio(currentPortfolio)) {
      return "portfolio";
    }
    return null;
  }, [activeCollectionId, config, currentPortfolio]);
  const showQuickAdd = !!(activeCollectionId && activeCollectionEntry && quickAddCollectionKind);
  const quickAddHeight = showQuickAdd ? 1 : 0;
  const tableHeight = Math.max(1, height - headerHeight - drawerHeight - quickAddHeight);
  const quickAddRow = activeCollectionId && activeCollectionEntry && quickAddCollectionKind ? (
    <QuickAddTickerInput
      collectionId={activeCollectionId}
      collectionKind={quickAddCollectionKind}
      collectionName={activeCollectionEntry.name}
      focused={focused}
      width={width}
      onAdded={handleTickerAdded}
      onFocusChange={setQuickAddFocused}
    />
  ) : null;

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box flexDirection="column" height={headerHeight}>
        {showCollectionTabs && (
          <Box flexDirection="row" height={1}>
            <Box flexShrink={1} overflow="hidden">
              <Tabs
                tabs={visibleCollections.map((collection) => ({ label: collection.name, value: collection.id }))}
                activeValue={activeCollectionId}
                onSelect={handleCollectionSelect}
                compact
                focused={focused}
              />
            </Box>
          </Box>
        )}
      </Box>

      <PortfolioTickerTable
        columns={columns}
        focused={focused && !quickAddFocused}
        sortColumnId={activeSort.columnId}
        sortDirection={activeSort.direction}
        onHeaderClick={handleHeaderClick}
        sortedTickers={sortedTickers}
        cursorSymbol={cursorSymbol}
        setCursorSymbol={setCursorSymbol}
        financialsMap={financialsMap}
        columnContext={columnContext}
        flashSymbols={flashSymbols}
        onRootKeyDown={handleTableKeyDown}
        onVisibleRangeChange={handleVisibleRangeChange}
        visibleRangeBuffer={3}
        resetScrollKey={activeCollectionId}
        onRowActivate={handleRowActivate}
        rootHeight={tableHeight}
      />

      {quickAddRow}

      {showCashDrawer && accountState && (
        <Box height={drawerHeight} paddingX={1}>
          <PortfolioCashMarginDrawer
            accountState={accountState}
            expanded={cashDrawerExpanded}
            onToggle={() => setCashDrawerExpanded(!cashDrawerExpanded)}
            width={Math.max(0, width - 2)}
            height={drawerHeight}
          />
        </Box>
      )}
    </Box>
  );
}
