import { useEffect } from "react";
import { useAppActive } from "./app-activity";
import type { QuoteSubscriptionTarget } from "../types/data-provider";
import { debugLog } from "../utils/debug-log";
import { getSharedMarketDataCoordinator } from "../market-data/coordinator";

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

export function buildQuoteStreamSubscriptionKey(target: QuoteSubscriptionTarget): string {
  const contractKey = target.context?.instrument?.conId
    ?? target.context?.instrument?.localSymbol
    ?? target.context?.instrument?.symbol
    ?? "";
  return [
    target.symbol,
    target.exchange ?? "",
    target.context?.brokerId ?? "",
    target.context?.brokerInstanceId ?? "",
    contractKey,
    target.route ?? "auto",
  ].join("|");
}

export function useQuoteStreaming(targets: QuoteSubscriptionTarget[]): void {
  const appActive = useAppActive();
  const coordinator = getSharedMarketDataCoordinator();

  const normalizedEntries = new Map<string, QuoteSubscriptionTarget>();
  for (const target of targets) {
    const normalized = normalizeTarget(target);
    if (!normalized) continue;
    const key = buildQuoteStreamSubscriptionKey(normalized);
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
    if (!coordinator || normalizedTargets.length === 0) return;
    quoteStreamLog.info("subscribe", {
      providerId: "market-data",
      count: normalizedTargets.length,
      targets: subscriptionKey,
    });
    const unsubscribe = coordinator.subscribeQuotes(normalizedTargets.map((target) => ({
      instrument: {
        symbol: target.symbol,
        exchange: target.exchange,
        brokerId: target.context?.brokerId,
        brokerInstanceId: target.context?.brokerInstanceId,
        instrument: target.context?.instrument ?? null,
      },
    })));
    return () => {
      quoteStreamLog.info("unsubscribe", {
        providerId: "market-data",
        count: normalizedTargets.length,
        targets: subscriptionKey,
      });
      unsubscribe?.();
    };
  }, [appActive, coordinator, subscriptionKey]);
}
