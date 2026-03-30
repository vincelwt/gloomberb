import { useEffect } from "react";
import { getSharedDataProvider } from "../plugins/registry";
import { useAppActive } from "./app-activity";
import { useAppState } from "./app-context";
import type { QuoteSubscriptionTarget } from "../types/data-provider";
import { debugLog } from "../utils/debug-log";

const quoteStreamLog = debugLog.createLogger("quote-stream");

function normalizeTarget(target: QuoteSubscriptionTarget): QuoteSubscriptionTarget | null {
  const symbol = target.symbol.trim().toUpperCase();
  if (!symbol) return null;
  return {
    ...target,
    symbol,
    exchange: target.exchange?.trim().toUpperCase() ?? "",
  };
}

export function useQuoteStreaming(targets: QuoteSubscriptionTarget[]): void {
  const { dispatch } = useAppState();
  const appActive = useAppActive();
  const provider = getSharedDataProvider();

  const normalizedEntries = new Map<string, QuoteSubscriptionTarget>();
  for (const target of targets) {
    const normalized = normalizeTarget(target);
    if (!normalized) continue;
    const key = normalized.exchange ? `${normalized.symbol}:${normalized.exchange}` : normalized.symbol;
    normalizedEntries.set(key, normalized);
  }
  const sortedEntries = [...normalizedEntries.entries()].sort(([left], [right]) => left.localeCompare(right));
  const normalizedTargets = sortedEntries.map(([, target]) => target);
  const subscriptionKey = sortedEntries.map(([key]) => key).join("|");

  useEffect(() => {
    if (!appActive) {
      if (normalizedTargets.length > 0) {
        quoteStreamLog.info("skipping subscription while inactive", { targets: subscriptionKey });
      }
      return;
    }
    if (!provider?.subscribeQuotes || normalizedTargets.length === 0) return;
    quoteStreamLog.info("subscribe", {
      providerId: provider.id,
      count: normalizedTargets.length,
      targets: subscriptionKey,
    });
    const unsubscribe = provider.subscribeQuotes(normalizedTargets, (target, quote) => {
      dispatch({
        type: "MERGE_QUOTE",
        symbol: target.symbol,
        quote,
      });
    });
    return () => {
      quoteStreamLog.info("unsubscribe", {
        providerId: provider.id,
        count: normalizedTargets.length,
        targets: subscriptionKey,
      });
      unsubscribe?.();
    };
  }, [appActive, dispatch, normalizedTargets, provider, subscriptionKey]);
}
