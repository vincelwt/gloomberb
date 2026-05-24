import type { DataProvider, MarketDataRequestContext } from "../../types/data-provider";
import { shouldLogProviderError } from "../provider-errors";
import type { ProviderRouterCoreDeps, SourceResult } from "./route-types";

export function makeRouterRevalidationKey(
  deps: Pick<ProviderRouterCoreDeps, "getEntityKey">,
  kind: string,
  ticker: string,
  context?: MarketDataRequestContext,
  extra?: string | number,
): string {
  return [
    kind,
    deps.getEntityKey(ticker, context?.instrument),
    extra != null ? String(extra) : "",
  ].join("|");
}

export function scheduleRouterRevalidation(
  inFlight: Map<string, Promise<unknown>>,
  key: string,
  task: () => Promise<void>,
): void {
  if (inFlight.has(key)) return;
  const promise = task()
    .catch(() => {})
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, promise);
}

export async function firstProviderResult<T>(
  deps: Pick<ProviderRouterCoreDeps, "providersInPriorityOrder" | "providerSourceKey" | "logProviderError">,
  fn: (provider: DataProvider) => Promise<T | null | undefined>,
): Promise<SourceResult<T> | null> {
  for (const provider of deps.providersInPriorityOrder()) {
    try {
      const result = await fn(provider);
      if (result != null) return { sourceKey: deps.providerSourceKey(provider), value: result };
    } catch (err) {
      if (shouldLogProviderError(err)) {
        deps.logProviderError(`${provider.id} failed: ${err}`);
      }
    }
  }
  return null;
}

export function resolveProviderBySourceKey(
  deps: Pick<ProviderRouterCoreDeps, "providersInPriorityOrder" | "providerSourceKey">,
  sourceKey: string,
): DataProvider | null {
  for (const provider of deps.providersInPriorityOrder()) {
    if (deps.providerSourceKey(provider) === sourceKey) return provider;
  }
  return null;
}
