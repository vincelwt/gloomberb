import { useEffect, useMemo, useRef } from "react";
import { getSharedMarketDataCoordinator } from "../../../../market-data/coordinator";
import { instrumentFromTicker, quoteSubscriptionTargetFromTicker } from "../../../../market-data/request-types";
import { useQuoteStreaming } from "../../../../state/hooks/quote-streaming";
import type { TickerFinancials } from "../../../../types/financials";
import type { TickerRecord } from "../../../../types/ticker";
import {
  VISIBLE_FINANCIAL_WARMUP_DELAY_MS,
  VISIBLE_QUOTE_REFRESH_COOLDOWN_MS,
  VISIBLE_QUOTE_STREAM_WATCHDOG_MS,
  VISIBLE_SNAPSHOT_WARMUP_BATCH_LIMIT,
  VISIBLE_SNAPSHOT_REFRESH_COOLDOWN_MS,
  needsVisibleQuoteWarmup,
  needsVisibleQuoteWatchdogRefresh,
  needsVisibleSnapshotWarmup,
  selectStreamTickers,
  visibleWarmupKey,
  type VisibleWarmupRequirements,
} from "./data";

export function usePortfolioPaneStreaming({
  appActive,
  focused,
  sortedTickers,
  cursorSymbol,
  streamWindow,
  isPortfolioTab,
  financialsMap,
  visibleWarmupRequirements,
}: {
  appActive: boolean;
  focused: boolean;
  sortedTickers: TickerRecord[];
  cursorSymbol: string | null;
  streamWindow: { start: number; end: number };
  isPortfolioTab: boolean;
  financialsMap: Map<string, TickerFinancials>;
  visibleWarmupRequirements: VisibleWarmupRequirements;
}) {
  const sharedCoordinator = getSharedMarketDataCoordinator();
  const mountedRef = useRef(true);
  const warmupInFlightRef = useRef(new Set<string>());
  const warmupAttemptRef = useRef(new Map<string, number>());

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const streamTickers = useMemo(
    () => selectStreamTickers(sortedTickers, streamWindow, cursorSymbol),
    [cursorSymbol, sortedTickers, streamWindow],
  );
  const priorityStreamSymbols = useMemo(
    () => new Set(streamTickers.map((ticker) => ticker.metadata.ticker)),
    [streamTickers],
  );
  const streamSurface: "portfolio" | "watchlist" = isPortfolioTab ? "portfolio" : "watchlist";
  const streamTargets = useMemo(() => (
    sortedTickers
      .map((ticker) => {
        const target = quoteSubscriptionTargetFromTicker(ticker, ticker.metadata.ticker, "provider");
        if (!target) return null;
        const selected = ticker.metadata.ticker === cursorSymbol;
        const visible = priorityStreamSymbols.has(ticker.metadata.ticker);
        return {
          ...target,
          surface: streamSurface,
          visible,
          selected,
          weight: selected ? 100 : visible ? 80 : 10,
        };
      })
      .filter((target): target is NonNullable<typeof target> => target != null)
  ), [cursorSymbol, priorityStreamSymbols, sortedTickers, streamSurface]);
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
        needsVisibleQuoteWarmup(financials, nowTimestamp)
        && !warmupInFlightRef.current.has(quoteKey)
        && nowTimestamp - (warmupAttemptRef.current.get(quoteKey) ?? 0) >= VISIBLE_QUOTE_REFRESH_COOLDOWN_MS
      ) {
        quoteQueue.push(ticker);
        continue;
      }

      const snapshotKey = visibleWarmupKey("snapshot", ticker);
      if (
        needsVisibleSnapshotWarmup(ticker, financials, visibleWarmupRequirements)
        && !warmupInFlightRef.current.has(snapshotKey)
        && nowTimestamp - (warmupAttemptRef.current.get(snapshotKey) ?? 0) >= VISIBLE_SNAPSHOT_REFRESH_COOLDOWN_MS
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
            ? sharedCoordinator.loadQuotesBatch(quoteEntries.map((entry) => entry.instrument), { forceRefresh: true })
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

  useEffect(() => {
    if (!appActive) return;
    if (!focused) return;
    if (!sharedCoordinator) return;

    let cancelled = false;
    const runWatchdog = async (): Promise<void> => {
      const nowTimestamp = Date.now();
      const quoteEntries = visibleFinancialTickers.flatMap((ticker) => {
        const financials = financialsMap.get(ticker.metadata.ticker);
        const key = visibleWarmupKey("quote", ticker);
        if (
          !needsVisibleQuoteWatchdogRefresh(financials, nowTimestamp)
          || warmupInFlightRef.current.has(key)
          || nowTimestamp - (warmupAttemptRef.current.get(key) ?? 0) < VISIBLE_QUOTE_REFRESH_COOLDOWN_MS
        ) {
          return [];
        }
        const instrument = instrumentFromTicker(ticker, ticker.metadata.ticker);
        if (!instrument) return [];
        warmupInFlightRef.current.add(key);
        warmupAttemptRef.current.set(key, nowTimestamp);
        return [{ key, instrument }];
      });
      if (quoteEntries.length === 0) return;

      try {
        await sharedCoordinator.loadQuotesBatch(quoteEntries.map((entry) => entry.instrument), { forceRefresh: true });
      } catch {
        // Best-effort watchdog for visible rows only.
      } finally {
        for (const entry of quoteEntries) {
          warmupInFlightRef.current.delete(entry.key);
        }
      }
    };

    const intervalId = setInterval(() => {
      if (!cancelled && mountedRef.current) void runWatchdog();
    }, VISIBLE_QUOTE_STREAM_WATCHDOG_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [appActive, financialsMap, focused, sharedCoordinator, visibleFinancialTickers]);

  useQuoteStreaming(streamTargets);
}
