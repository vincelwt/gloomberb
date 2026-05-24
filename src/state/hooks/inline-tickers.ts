import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSharedRegistry } from "../../plugins/registry";
import { useAppDispatch, useAppSelector } from "../app/context";
import { resolveTickerSearch, upsertTickerFromSearchResult } from "../../tickers/search";
import { collectUniqueTickerSymbols } from "../../tickers/tokenizer";
import { useQuoteStreaming } from "./quote-streaming";
import type { Quote } from "../../types/financials";
import type { TickerRecord } from "../../types/ticker";
import { TICKER_RESEARCH_PANE_ID } from "../../types/config";

type InlineTickerStatus = "loading" | "ready" | "missing";

export interface InlineTickerCatalogEntry {
  status: InlineTickerStatus;
  ticker: TickerRecord | null;
  quote: Quote | null;
}

export interface UseInlineTickersOptions {
  liveQuotes?: boolean;
}

const resolutionInFlight = new Map<string, Promise<void>>();
const quoteInFlight = new Map<string, Promise<void>>();
const missingSymbols = new Set<string>();
const quoteMissingSymbols = new Set<string>();
const initialQuoteRequested = new Set<string>();

function normalizeSymbols(texts: readonly string[]): string[] {
  return collectUniqueTickerSymbols(texts);
}

export function useInlineTickerOpener(): (symbol: string) => void {
  const registry = getSharedRegistry();
  return useCallback((symbol: string) => {
    registry?.pinTicker(symbol, { floating: true, paneType: TICKER_RESEARCH_PANE_ID });
  }, [registry]);
}

export function useInlineTickers(
  texts: readonly string[],
  options: UseInlineTickersOptions = {},
): {
  catalog: Record<string, InlineTickerCatalogEntry>;
  openTicker: (symbol: string) => void;
} {
  const liveQuotes = options.liveQuotes ?? true;
  const dispatch = useAppDispatch();
  const tickers = useAppSelector((state) => state.tickers);
  const financials = useAppSelector((state) => state.financials);
  const registry = getSharedRegistry();
  const [refreshVersion, setRefreshVersion] = useState(0);
  const textsKey = texts.join("\u0000");
  const symbols = useMemo(() => normalizeSymbols(texts), [textsKey]);
  const symbolsKey = symbols.join("|");
  const financialsEffectTarget = liveQuotes ? financials : null;
  const latestRef = useRef({ tickers, financials, dispatch, registry });

  latestRef.current = { tickers, financials, dispatch, registry };

  useEffect(() => {
    let mounted = true;
    const notify = () => {
      if (!mounted) return;
      setRefreshVersion((value) => value + 1);
    };

    for (const symbol of symbols) {
      const current = latestRef.current;
      const currentTicker = current.tickers.get(symbol) ?? null;
      const currentQuote = liveQuotes
        ? current.financials.get(symbol)?.quote ?? null
        : null;

      if (currentTicker && (!liveQuotes || currentQuote)) {
        missingSymbols.delete(symbol);
        if (liveQuotes) {
          quoteMissingSymbols.delete(symbol);
          initialQuoteRequested.delete(symbol);
        }
        continue;
      }

      if (!currentTicker && !missingSymbols.has(symbol)) {
        let resolution = resolutionInFlight.get(symbol);
        if (!resolution) {
          resolution = (async () => {
            const current = latestRef.current;
            const activeRegistry = current.registry;
            if (!activeRegistry) return;
            const resolved = await resolveTickerSearch({
              query: symbol,
              activeTicker: null,
              tickers: current.tickers,
              dataProvider: activeRegistry.marketData,
            });

            if (!resolved) {
              missingSymbols.add(symbol);
              return;
            }

            if (resolved.kind === "local") return;

            const { ticker, created } = await upsertTickerFromSearchResult(activeRegistry.tickerRepository, resolved.result);
            current.dispatch({ type: "UPDATE_TICKER", ticker });
            if (created) {
              activeRegistry.events.emit("ticker:added", { symbol: ticker.metadata.ticker, ticker });
            }
            missingSymbols.delete(symbol);
          })()
            .catch(() => {
              missingSymbols.add(symbol);
            })
            .finally(() => {
              resolutionInFlight.delete(symbol);
            });
          resolutionInFlight.set(symbol, resolution);
        }
        void resolution.finally(notify);
        continue;
      }

      if (!liveQuotes || !currentTicker || currentQuote || initialQuoteRequested.has(symbol)) continue;

      let quoteRequest = quoteInFlight.get(symbol);
      if (!quoteRequest) {
        initialQuoteRequested.add(symbol);
        quoteRequest = (async () => {
          const current = latestRef.current;
          const activeRegistry = current.registry;
          if (!activeRegistry) return;

          const latestTicker = current.tickers.get(symbol);
          if (!latestTicker) return;

          const instrument = latestTicker.metadata.broker_contracts?.[0] ?? null;
          const quote = await activeRegistry.marketData.getQuote(
            symbol,
            latestTicker.metadata.exchange,
            instrument
              ? {
                brokerId: instrument.brokerId,
                brokerInstanceId: instrument.brokerInstanceId,
                instrument,
              }
              : undefined,
          );
          quoteMissingSymbols.delete(symbol);
          current.dispatch({ type: "MERGE_QUOTE", symbol, quote });
        })()
          .catch(() => {
            quoteMissingSymbols.add(symbol);
          })
          .finally(() => {
            quoteInFlight.delete(symbol);
          });
        quoteInFlight.set(symbol, quoteRequest);
      }
      void quoteRequest.finally(notify);
    }

    return () => {
      mounted = false;
    };
  }, [dispatch, financialsEffectTarget, liveQuotes, registry, symbols, symbolsKey, tickers]);

  const streamingTargets = useMemo(() => {
    if (!liveQuotes) return [];
    return symbols
      .map((symbol) => tickers.get(symbol))
      .filter((ticker): ticker is TickerRecord => ticker != null)
      .map((ticker) => {
        const instrument = ticker.metadata.broker_contracts?.[0] ?? null;
        return {
          symbol: ticker.metadata.ticker,
          exchange: ticker.metadata.exchange,
          surface: "inline" as const,
          visible: true,
          weight: 40,
          context: instrument
            ? {
              brokerId: instrument.brokerId,
              brokerInstanceId: instrument.brokerInstanceId,
              instrument,
            }
            : undefined,
        };
      });
  }, [liveQuotes, symbols, tickers]);

  useQuoteStreaming(streamingTargets);

  const openTicker = useInlineTickerOpener();

  const catalog = useMemo(() => {
    const entries: Record<string, InlineTickerCatalogEntry> = {};
    for (const symbol of symbols) {
      const ticker = tickers.get(symbol) ?? null;
      const quote = liveQuotes ? financials.get(symbol)?.quote ?? null : null;
      const status: InlineTickerStatus = ticker
        ? liveQuotes
          ? (quote ? "ready" : quoteMissingSymbols.has(symbol) ? "missing" : "loading")
          : "ready"
        : (missingSymbols.has(symbol) ? "missing" : "loading");
      entries[symbol] = { status, ticker, quote };
    }
    return entries;
  }, [financials, liveQuotes, refreshVersion, symbols, tickers]);

  return { catalog, openTicker };
}
