import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { TabBar } from "../../../components/tab-bar";
import { getSharedRegistry } from "../../registry";
import { getSharedMarketDataCoordinator } from "../../../market-data/coordinator";
import { useFxRatesMap, useTickerFinancialsMap } from "../../../market-data/hooks";
import { instrumentFromTicker, quoteSubscriptionTargetFromTicker } from "../../../market-data/request-types";
import { useAppActive } from "../../../state/app-activity";
import {
  useAppState,
  usePaneCollection,
  usePaneInstance,
  usePaneInstanceId,
  usePaneStateValue,
  type CollectionSortPreference,
} from "../../../state/app-context";
import { getCollectionTickers, getCollectionType } from "../../../state/selectors";
import { useQuoteStreaming } from "../../../state/use-quote-streaming";
import { selectEffectiveExchangeRates } from "../../../utils/exchange-rate-map";
import { getActiveQuoteDisplay } from "../../../utils/market-status";
import type { ColumnConfig } from "../../../types/config";
import type { TickerRecord } from "../../../types/ticker";
import type { PaneProps } from "../../../types/plugin";
import type { TickerFinancials } from "../../../types/financials";
import { getSortValue, resolveCollectionSortPreference, type ColumnContext } from "./metrics";
import {
  PortfolioCashMarginDrawer,
  PortfolioSummaryBar,
  shouldToggleCashMarginDrawer,
  usePortfolioAccountState,
} from "./header";
import type { ResolvedPortfolioAccountState } from "./summary";
import {
  getCollectionEntries,
  getPortfolioPaneSettings,
  resolveActiveCollectionId,
  resolveScopedCollectionEntries,
  resolveVisibleColumns,
} from "./settings";
import { PortfolioTickerTable, type QuoteFlashDirection } from "./table";
import { useThrottledCursorSymbol } from "./use-throttled-cursor-symbol";

const VISIBLE_FINANCIAL_REFRESH_COOLDOWN_MS = 5 * 60_000;

function needsVisibleFinancialWarmup(ticker: TickerRecord, financials: TickerFinancials | undefined): boolean {
  if (ticker.metadata.assetCategory === "OPT") return false;
  if (!financials) return true;
  if (Object.keys(financials.fundamentals ?? {}).length === 0) return true;
  return financials.priceHistory.length === 0;
}

function selectStreamTickers(
  tickers: TickerRecord[],
  _visibleRange: { start: number; end: number },
) {
  return tickers;
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

  return [...tickers].sort((leftTicker, rightTicker) => {
    const leftValue = getSortValue(sortColumn, leftTicker, financialsMap.get(leftTicker.metadata.ticker), columnContext);
    const rightValue = getSortValue(sortColumn, rightTicker, financialsMap.get(rightTicker.metadata.ticker), columnContext);

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
  const registry = getSharedRegistry();
  const paneId = usePaneInstanceId();
  const paneInstance = usePaneInstance();
  const appActive = useAppActive();
  const { state } = useAppState();
  const paneCollection = usePaneCollection();

  const [currentCollectionId, setCurrentCollectionId] = usePaneStateValue<string>("collectionId", paneCollection.collectionId ?? "");
  const [committedCursorSymbol, setCommittedCursorSymbol] = usePaneStateValue<string | null>("cursorSymbol", null);
  const [collectionSorts, setCollectionSorts] = usePaneStateValue<Record<string, CollectionSortPreference>>("collectionSorts", {});
  const [cashDrawerExpanded, setCashDrawerExpanded] = usePaneStateValue<boolean>("cashDrawerExpanded", false);

  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [flashSymbols, setFlashSymbols] = useState<Map<string, QuoteFlashDirection>>(new Map());
  const [streamWindow, setStreamWindow] = useState({ start: 0, end: 24 });

  const previousPricesRef = useRef<Map<string, number>>(new Map());
  const mountedRef = useRef(true);
  const warmupInFlightRef = useRef(new Set<string>());
  const warmupAttemptRef = useRef(new Map<string, number>());
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const headerScrollRef = useRef<ScrollBoxRenderable>(null);
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
    () => getCollectionEntries(state.config),
    [state.config],
  );
  const visibleCollections = useMemo(
    () => resolveScopedCollectionEntries(collectionEntries, paneSettings),
    [collectionEntries, paneSettings],
  );
  const activeCollectionId = resolveActiveCollectionId(currentCollectionId, visibleCollections, paneSettings);
  const isPortfolioTab = getCollectionType(state, activeCollectionId) === "portfolio";
  const currentPortfolio = useMemo(() => (
    isPortfolioTab
      ? state.config.portfolios.find((portfolio) => portfolio.id === activeCollectionId) ?? null
      : null
  ), [activeCollectionId, isPortfolioTab, state.config.portfolios]);

  const tickers = useMemo(
    () => getCollectionTickers(state, activeCollectionId),
    [activeCollectionId, state.config.portfolios, state.config.watchlists, state.tickers],
  );
  const marketFinancialsMap = useTickerFinancialsMap(tickers);
  const sharedCoordinator = getSharedMarketDataCoordinator();
  const financialsMap = useMemo(() => {
    const merged = sharedCoordinator ? new Map<string, TickerFinancials>() : new Map(state.financials);
    for (const [symbol, financials] of marketFinancialsMap) {
      merged.set(symbol, financials);
    }
    return merged;
  }, [marketFinancialsMap, sharedCoordinator, state.financials]);

  const accountState = usePortfolioAccountState(currentPortfolio, state);
  const columns = useMemo(
    () => resolveVisibleColumns(paneSettings.columnIds, isPortfolioTab),
    [isPortfolioTab, paneSettings.columnIds],
  );

  const trackedCurrencies = useMemo(
    () => buildTrackedCurrencies(tickers, financialsMap, accountState, state.config.baseCurrency),
    [tickers, financialsMap, accountState, state.config.baseCurrency],
  );
  const fetchedExchangeRates = useFxRatesMap(trackedCurrencies);
  const effectiveExchangeRates = selectEffectiveExchangeRates(fetchedExchangeRates, state.exchangeRates);

  const columnContext: ColumnContext = useMemo(() => ({
    activeTab: isPortfolioTab ? activeCollectionId : undefined,
    baseCurrency: state.config.baseCurrency,
    exchangeRates: effectiveExchangeRates,
    now,
  }), [activeCollectionId, effectiveExchangeRates, isPortfolioTab, now, state.config.baseCurrency]);

  const activeSort = resolveCollectionSortPreference(activeCollectionId, isPortfolioTab, collectionSorts);
  const sortedTickers = useMemo(
    () => sortTickers(tickers, financialsMap, activeSort, columnContext, columns),
    [tickers, financialsMap, activeSort, columnContext, columns],
  );

  const currentTabIdx = visibleCollections.findIndex((collection) => collection.id === activeCollectionId);
  const selectedIdx = sortedTickers.findIndex((ticker) => ticker.metadata.ticker === cursorSymbol);
  const safeSelectedIdx = selectedIdx >= 0 ? selectedIdx : 0;

  const showCashDrawer = !paneSettings.hideCash && !!(isPortfolioTab && currentPortfolio?.brokerInstanceId && accountState);
  const requestedDrawerHeight = showCashDrawer
    ? (cashDrawerExpanded ? Math.min(6, Math.max(3, 2 + accountState.visibleCashBalances.length)) : 1)
    : 0;
  const headerHeight = paneSettings.hideHeader
    ? (paneSettings.hideTabs ? 0 : 1)
    : paneSettings.hideTabs ? 1 : 2;
  const drawerHeight = showCashDrawer
    ? Math.min(requestedDrawerHeight, Math.max(1, height - (headerHeight + 2)))
    : 0;

  const syncHeaderScroll = useCallback(() => {
    const bodyScrollBox = scrollRef.current;
    const headerScrollBox = headerScrollRef.current;
    if (bodyScrollBox && headerScrollBox && headerScrollBox.scrollLeft !== bodyScrollBox.scrollLeft) {
      headerScrollBox.scrollLeft = bodyScrollBox.scrollLeft;
    }
  }, []);

  const updateStreamWindow = useCallback(() => {
    const scrollBox = scrollRef.current;
    if (!scrollBox) return;

    const buffer = 3;
    const start = Math.max(0, scrollBox.scrollTop - buffer);
    const end = Math.min(sortedTickers.length, scrollBox.scrollTop + scrollBox.viewport.height + buffer);
    setStreamWindow((current) => (
      current.start === start && current.end === end ? current : { start, end }
    ));
  }, [sortedTickers.length]);

  const handleBodyScrollActivity = useCallback(() => {
    syncHeaderScroll();
    updateStreamWindow();
  }, [syncHeaderScroll, updateStreamWindow]);

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

  const handleKeyboard = useCallback((event: { name?: string; shift?: boolean }) => {
    if (!focused) return;

    const key = event.name;
    const isEnter = key === "enter" || key === "return";

    if (isEnter && event.shift) {
      const ticker = sortedTickers[safeSelectedIdx];
      if (ticker) {
        registry?.pinTickerFn(ticker.metadata.ticker, { floating: true, paneType: "ticker-detail" });
      }
      return;
    }

    if (shouldToggleCashMarginDrawer(key, showCashDrawer)) {
      setCashDrawerExpanded(!cashDrawerExpanded);
      return;
    }

    if (key === "j" || key === "down") {
      const nextTicker = sortedTickers[Math.min(safeSelectedIdx + 1, sortedTickers.length - 1)];
      if (nextTicker) setCursorSymbol(nextTicker.metadata.ticker);
      return;
    }

    if (key === "k" || key === "up") {
      const nextTicker = sortedTickers[Math.max(safeSelectedIdx - 1, 0)];
      if (nextTicker) setCursorSymbol(nextTicker.metadata.ticker);
      return;
    }

    if (!paneSettings.hideTabs && (key === "h" || key === "left")) {
      const previousCollection = visibleCollections[Math.max(currentTabIdx - 1, 0)];
      if (previousCollection) handleCollectionSelect(previousCollection.id);
      return;
    }

    if (!paneSettings.hideTabs && (key === "l" || key === "right")) {
      const nextCollection = visibleCollections[Math.min(currentTabIdx + 1, visibleCollections.length - 1)];
      if (nextCollection) handleCollectionSelect(nextCollection.id);
      return;
    }

    if (!isEnter) return;

    flushCursorSymbol(cursorSymbol);

    const ticker = sortedTickers[safeSelectedIdx];
    if (ticker) {
      registry?.navigateTickerFn(ticker.metadata.ticker);
    }
  }, [
    cashDrawerExpanded,
    currentTabIdx,
    focused,
    paneId,
    paneSettings.hideTabs,
    registry,
    safeSelectedIdx,
    setCashDrawerExpanded,
    setCursorSymbol,
    flushCursorSymbol,
    handleCollectionSelect,
    showCashDrawer,
    sortedTickers,
    state.config.layout.instances,
    visibleCollections,
  ]);

  useKeyboard(handleKeyboard);

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
    if (headerScrollRef.current) {
      headerScrollRef.current.horizontalScrollBar.visible = false;
    }
    syncHeaderScroll();
  }, [syncHeaderScroll]);

  useEffect(() => {
    const scrollBox = scrollRef.current;
    if (!scrollBox) return;

    const viewportHeight = scrollBox.viewport.height;
    if (safeSelectedIdx < scrollBox.scrollTop) {
      scrollBox.scrollTo(safeSelectedIdx);
    } else if (safeSelectedIdx >= scrollBox.scrollTop + viewportHeight) {
      scrollBox.scrollTo(safeSelectedIdx - viewportHeight + 1);
    }
    queueMicrotask(updateStreamWindow);
  }, [safeSelectedIdx, updateStreamWindow]);

  useEffect(() => {
    const scrollBox = scrollRef.current;
    if (!scrollBox) return;
    scrollBox.verticalScrollBar.visible = sortedTickers.length > scrollBox.viewport.height;
    updateStreamWindow();
  }, [sortedTickers.length, drawerHeight, cashDrawerExpanded, updateStreamWindow]);

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
    () => selectStreamTickers(sortedTickers, streamWindow),
    [sortedTickers, streamWindow],
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
    if (!sharedCoordinator) return;

    const nowTimestamp = Date.now();
    const queue = visibleFinancialTickers.filter((ticker) => {
      const key = `${ticker.metadata.ticker}:${ticker.metadata.exchange ?? ""}`;
      if (warmupInFlightRef.current.has(key)) return false;
      if (nowTimestamp - (warmupAttemptRef.current.get(key) ?? 0) < VISIBLE_FINANCIAL_REFRESH_COOLDOWN_MS) return false;
      return needsVisibleFinancialWarmup(ticker, financialsMap.get(ticker.metadata.ticker));
    });
    if (queue.length === 0) return;

    const runNext = async (): Promise<void> => {
      const nextTicker = queue.shift();
      if (!nextTicker) return;

      const key = `${nextTicker.metadata.ticker}:${nextTicker.metadata.exchange ?? ""}`;
      const instrument = instrumentFromTicker(nextTicker, nextTicker.metadata.ticker);
      warmupInFlightRef.current.add(key);
      warmupAttemptRef.current.set(key, nowTimestamp);
      try {
        if (instrument) {
          await sharedCoordinator.loadSnapshot(instrument);
        }
      } catch {
        // Best-effort warmup for visible rows only.
      } finally {
        warmupInFlightRef.current.delete(key);
      }

      if (mountedRef.current) {
        await runNext();
      }
    };

    const workers = Array.from({ length: Math.min(3, queue.length) }, () => runNext());
    void Promise.all(workers);
  }, [appActive, financialsMap, sharedCoordinator, visibleFinancialTickers]);

  useQuoteStreaming(streamTargets);

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="column" height={headerHeight}>
        {!paneSettings.hideTabs && (
          <box flexDirection="row" height={1}>
            <box flexShrink={1} overflow="hidden">
              <TabBar
                tabs={visibleCollections.map((collection) => ({ label: collection.name, value: collection.id }))}
                activeValue={activeCollectionId}
                onSelect={handleCollectionSelect}
                compact
              />
            </box>
          </box>
        )}
        {!paneSettings.hideHeader && (
          <box height={1}>
            <PortfolioSummaryBar
              tickers={sortedTickers}
              financialsMap={financialsMap}
              baseCurrency={state.config.baseCurrency}
              exchangeRates={effectiveExchangeRates}
              refreshingCount={state.refreshing.size}
              isPortfolio={isPortfolioTab}
              collectionId={activeCollectionId}
              width={Math.max(0, width)}
              accountState={accountState}
            />
          </box>
        )}
      </box>

      <PortfolioTickerTable
        columns={columns}
        sortColumnId={activeSort.columnId}
        sortDirection={activeSort.direction}
        onHeaderClick={handleHeaderClick}
        headerScrollRef={headerScrollRef}
        scrollRef={scrollRef}
        syncHeaderScroll={syncHeaderScroll}
        onBodyScrollActivity={handleBodyScrollActivity}
        sortedTickers={sortedTickers}
        cursorSymbol={cursorSymbol}
        hoveredIdx={hoveredIdx}
        setHoveredIdx={setHoveredIdx}
        setCursorSymbol={setCursorSymbol}
        financialsMap={financialsMap}
        columnContext={columnContext}
        flashSymbols={flashSymbols}
      />

      {showCashDrawer && accountState && (
        <box height={drawerHeight} paddingX={1}>
          <PortfolioCashMarginDrawer
            accountState={accountState}
            expanded={cashDrawerExpanded}
            onToggle={() => setCashDrawerExpanded(!cashDrawerExpanded)}
            width={Math.max(0, width - 2)}
            height={drawerHeight}
          />
        </box>
      )}
    </box>
  );
}
