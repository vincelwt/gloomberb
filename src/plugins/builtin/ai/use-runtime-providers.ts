import { useMemo, useSyncExternalStore } from "react";
import { aiProviderFromRuntime, detectProviders, type AiProvider } from "./providers";
import {
  type AiRuntimeCatalog,
  getAiRuntimeCatalogSnapshot,
  subscribeAiRuntimeCatalog,
} from "./runner";

export function useAiRuntimeCatalog(): AiRuntimeCatalog {
  return useSyncExternalStore(
    subscribeAiRuntimeCatalog,
    getAiRuntimeCatalogSnapshot,
    getAiRuntimeCatalogSnapshot,
  );
}

export function useAiRuntimeProviders(): AiProvider[] {
  const catalog = useAiRuntimeCatalog();

  return useMemo(
    () => (
      catalog.providers.length > 0
        ? catalog.providers.map(aiProviderFromRuntime)
        : detectProviders()
    ),
    [catalog],
  );
}
