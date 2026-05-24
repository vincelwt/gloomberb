import type { Dispatch } from "react";
import type { ColumnConfig } from "../../../../types/config";
import type { DataProvider } from "../../../../types/data-provider";
import type { TickerFinancials } from "../../../../types/financials";
import type { InstrumentSearchResult } from "../../../../types/instrument";
import type { TickerRecord } from "../../../../types/ticker";
import type { AppAction } from "../../../../state/app/context";
import { canonicalExchange } from "../../../../utils/exchanges";
import { compareSortValues } from "../../../../utils/sort-values";
import { upsertTickerFromSearchResult } from "../../../../tickers/search";
import { getSharedRegistry } from "../../../registry";
import { getSortValue, type ColumnContext } from "../../portfolio-list/metrics";
import type { ScreenerSortPreference } from "./model";
import type { ValidatedScreenerResult } from "./contract";

function summarizeWarning(unresolved: string[], duplicateCount: number): string | null {
  const parts: string[] = [];
  if (duplicateCount > 0) {
    parts.push(`Dropped ${duplicateCount} duplicate${duplicateCount === 1 ? "" : "s"}.`);
  }
  if (unresolved.length > 0) {
    parts.push(`Could not resolve ${unresolved.length}: ${unresolved.slice(0, 5).join(", ")}${unresolved.length > 5 ? "..." : ""}.`);
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

function resolveResultSymbol(result: InstrumentSearchResult): string {
  return (result.brokerContract?.localSymbol || result.symbol.split(".")[0] || "").trim().toUpperCase();
}

function matchesExchange(result: InstrumentSearchResult, exchange: string): boolean {
  if (!exchange) return true;
  const normalized = canonicalExchange(exchange);
  return canonicalExchange(result.exchange) === normalized
    || canonicalExchange(result.primaryExchange) === normalized
    || canonicalExchange(result.brokerContract?.exchange) === normalized
    || canonicalExchange(result.brokerContract?.primaryExchange) === normalized;
}

async function resolveCandidateTicker(
  candidate: { symbol: string; exchange: string; reason: string },
  localTickers: ReadonlyMap<string, TickerRecord>,
  stateDispatch: Dispatch<AppAction>,
  dataProvider: DataProvider | null,
): Promise<ValidatedScreenerResult | null> {
  const registry = getSharedRegistry();
  if (!registry || !dataProvider) {
    throw new Error("AI screener could not access the ticker repository.");
  }

  const localTicker = localTickers.get(candidate.symbol);
  if (localTicker && (!candidate.exchange || localTicker.metadata.exchange.toUpperCase() === candidate.exchange)) {
    return {
      symbol: localTicker.metadata.ticker,
      exchange: localTicker.metadata.exchange,
      reason: candidate.reason,
      resolvedName: localTicker.metadata.name,
    };
  }

  const searchResults = await dataProvider.search(candidate.symbol);
  const matches = searchResults.filter((result) => resolveResultSymbol(result) === candidate.symbol);
  const selected = matches.find((result) => matchesExchange(result, candidate.exchange))
    ?? matches[0]
    ?? null;
  if (!selected) return null;

  const { ticker, created } = await upsertTickerFromSearchResult(registry.tickerRepository, selected);
  stateDispatch({ type: "UPDATE_TICKER", ticker });
  if (created) {
    registry.events.emit("ticker:added", {
      symbol: ticker.metadata.ticker,
      ticker,
    });
  }

  return {
    symbol: ticker.metadata.ticker,
    exchange: ticker.metadata.exchange,
    reason: candidate.reason,
    resolvedName: ticker.metadata.name,
  };
}

export async function validateScreenerResults(
  candidates: Array<{ symbol: string; exchange: string; reason: string }>,
  localTickers: ReadonlyMap<string, TickerRecord>,
  stateDispatch: Dispatch<AppAction>,
  dataProvider: DataProvider | null,
): Promise<{ results: ValidatedScreenerResult[]; warning: string | null }> {
  const resolved: ValidatedScreenerResult[] = [];
  const unresolved: string[] = [];
  let duplicateCount = 0;
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const result = await resolveCandidateTicker(candidate, localTickers, stateDispatch, dataProvider);
    if (!result) {
      unresolved.push(candidate.symbol);
      continue;
    }
    if (seen.has(result.symbol)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(result.symbol);
    resolved.push(result);
  }

  return {
    results: resolved,
    warning: summarizeWarning(unresolved, duplicateCount),
  };
}

export function sortScreenerRows(
  rows: TickerRecord[],
  resultMap: Map<string, ValidatedScreenerResult>,
  financialsMap: Map<string, TickerFinancials>,
  sortPreference: ScreenerSortPreference,
  columnContext: ColumnContext,
  columns: ColumnConfig[],
): TickerRecord[] {
  if (!sortPreference.columnId) return rows;

  const column = columns.find((entry) => entry.id === sortPreference.columnId);
  if (!column) return rows;

  return [...rows].sort((left, right) => {
    const leftValue = column.id === "reason"
      ? (resultMap.get(left.metadata.ticker)?.reason ?? "")
      : getSortValue(column, left, financialsMap.get(left.metadata.ticker), columnContext);
    const rightValue = column.id === "reason"
      ? (resultMap.get(right.metadata.ticker)?.reason ?? "")
      : getSortValue(column, right, financialsMap.get(right.metadata.ticker), columnContext);

    return compareSortValues(leftValue, rightValue, sortPreference.direction);
  });
}
