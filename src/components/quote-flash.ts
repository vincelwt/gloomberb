import { useEffect, useRef, useState } from "react";
import type { TickerFinancials } from "../types/financials";
import { getActiveQuoteDisplay } from "../market-data/market/status";

export type QuoteFlashDirection = "up" | "down" | "flat";

const FLASH_DURATION_MS = 450;

function resolveFlashPrice(financials: TickerFinancials | null | undefined): number | null {
  return getActiveQuoteDisplay(financials?.quote)?.price ?? financials?.quote?.price ?? null;
}

function resolveFlashDirection(previousPrice: number, nextPrice: number): QuoteFlashDirection {
  if (nextPrice > previousPrice) return "up";
  if (nextPrice < previousPrice) return "down";
  return "flat";
}

export function useQuoteFlashMap(
  financialsMap: Map<string, TickerFinancials>,
  enabled: boolean,
): Map<string, QuoteFlashDirection> {
  const [flashSymbols, setFlashSymbols] = useState<Map<string, QuoteFlashDirection>>(new Map());
  const previousPricesRef = useRef<Map<string, number>>(new Map());
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const changed = new Map<string, QuoteFlashDirection>();

    for (const [symbol, financials] of financialsMap) {
      const price = resolveFlashPrice(financials);
      if (price == null) continue;

      const previousPrice = previousPricesRef.current.get(symbol);
      if (previousPrice != null && previousPrice !== price) {
        changed.set(symbol, resolveFlashDirection(previousPrice, price));
      }
      previousPricesRef.current.set(symbol, price);
    }

    if (!enabled) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      setFlashSymbols((current) => (current.size === 0 ? current : new Map()));
      return;
    }

    if (changed.size === 0) return;

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setFlashSymbols(changed);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setFlashSymbols(new Map());
    }, FLASH_DURATION_MS);
  }, [enabled, financialsMap]);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  return flashSymbols;
}

export function useQuoteFlashDirection(
  financials: TickerFinancials | null | undefined,
  enabled: boolean,
): QuoteFlashDirection | undefined {
  const [flashDirection, setFlashDirection] = useState<QuoteFlashDirection | undefined>();
  const previousPriceRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const price = resolveFlashPrice(financials);
    const previousPrice = previousPriceRef.current;
    if (price != null) {
      previousPriceRef.current = price;
    }

    if (!enabled) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      setFlashDirection(undefined);
      return;
    }

    if (price == null) return;
    if (previousPrice == null || previousPrice === price) return;

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setFlashDirection(resolveFlashDirection(previousPrice, price));
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setFlashDirection(undefined);
    }, FLASH_DURATION_MS);
  }, [enabled, financials]);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  return flashDirection;
}
