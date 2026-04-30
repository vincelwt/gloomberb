import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSharedRegistry } from "../plugins/registry";
import { useAppDispatch, useAppSelector } from "./app-context";
import { resolveTickerSearch, upsertTickerFromSearchResult } from "../utils/ticker-search";
import { collectUniqueTickerSymbols } from "../utils/ticker-tokenizer";
import { useQuoteStreaming } from "./use-quote-streaming";
import type { Quote } from "../types/financials";
import type { TickerRecord } from "../types/ticker";

export type InlineTickerStatus = "loading" | "ready" | "missing";

export interface InlineTickerCatalogEntry {
  status: InlineTickerStatus;
  ticker: TickerRecord | null;
  quote: Quote | null;
}

const resolutionInFlight = new Map<string, Promise<void>>();
const quoteInFlight = new Map<string, Promise<void>>();
const missingSymbols = new Set<string>();
const initialQuoteRequested = new Set<string>();

function normalizeSymbols(texts: readonly string[]): string[] {
  return collectUniqueTickerSymbols(texts);
}

export function useInlineTickers(texts: readonly string[]): {
  catalog: Record<string, InlineTickerCatalogEntry>;
  openTicker: (symbol: string) => void;
} {
  const dispatch = useAppDispatch();
  const tickers = useAppSelector((state) => state.tickers);
  const financials = useAppSelector((state) => state.financials);
  const registry = getSharedRegistry();
  const [, setRefreshVersion] = useState(0);
  const textsKey = texts.join("\u0000");
  const symbols = useMemo(() => normalizeSymbols(texts), [textsKey]);
  const symbolsKey = symbols.join("|");
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
      const currentQuote = current.financials.get(symbol)?.quote ?? null;

      if (currentTicker && currentQuote) {
        missingSymbols.delete(symbol);
        initialQuoteRequested.delete(symbol);
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

      if (!currentTicker || currentQuote || initialQuoteRequested.has(symbol)) continue;

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
          current.dispatch({ type: "MERGE_QUOTE", symbol, quote });
        })()
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
  }, [dispatch, financials, registry, symbols, symbolsKey, tickers]);

  const streamingTargets = symbols
    .map((symbol) => tickers.get(symbol))
    .filter((ticker): ticker is TickerRecord => ticker != null)
    .map((ticker) => {
      const instrument = ticker.metadata.broker_contracts?.[0] ?? null;
      return {
        symbol: ticker.metadata.ticker,
        exchange: ticker.metadata.exchange,
        context: instrument
          ? {
            brokerId: instrument.brokerId,
            brokerInstanceId: instrument.brokerInstanceId,
            instrument,
          }
          : undefined,
      };
    });

  useQuoteStreaming(streamingTargets);

  const openTicker = useCallback((symbol: string) => {
    registry?.pinTicker(symbol, { floating: true, paneType: "ticker-detail" });
  }, [registry]);

  const catalog: Record<string, InlineTickerCatalogEntry> = {};
  for (const symbol of symbols) {
    const ticker = tickers.get(symbol) ?? null;
    const quote = financials.get(symbol)?.quote ?? null;
    const status: InlineTickerStatus = ticker
      ? (quote ? "ready" : "loading")
      : (missingSymbols.has(symbol) ? "missing" : "loading");
    catalog[symbol] = { status, ticker, quote };
  }

  return { catalog, openTicker };
}
