import type { PluginStateStore } from "../data/plugin-state-store";
import type { ResourceStore } from "../data/resource-store";
import type { PluginPersistence, PluginStorage } from "../types/plugin";

export function createPluginStorage(pluginState: PluginStateStore, pluginId: string): PluginStorage {
  return {
    get: <T,>(key: string): T | null => pluginState.get<T>(pluginId, key)?.value ?? null,
    set: (key: string, value: unknown) => {
      pluginState.set(pluginId, key, value);
    },
    delete: (key: string) => {
      pluginState.delete(pluginId, key);
    },
    keys: () => pluginState.keys(pluginId),
  };
}

export function createPluginPersistence(
  pluginState: PluginStateStore,
  resources: ResourceStore,
  namespace: string,
  pluginId: string,
): PluginPersistence {
  return {
    getState: <T,>(key: string, options?: { schemaVersion?: number }): T | null => (
      pluginState.get<T>(pluginId, key, options?.schemaVersion)?.value ?? null
    ),
    setState: (key: string, value: unknown, options?: { schemaVersion?: number }) => {
      pluginState.set(pluginId, key, value, options?.schemaVersion);
    },
    deleteState: (key: string) => {
      pluginState.delete(pluginId, key);
    },
    getResource: <T,>(
      kind: string,
      key: string,
      options?: { sourceKey?: string; schemaVersion?: number; allowExpired?: boolean },
    ) => {
      const record = resources.get<T>({
        namespace,
        kind,
        entityKey: key,
        sourceKey: options?.sourceKey,
      }, {
        schemaVersion: options?.schemaVersion,
        allowExpired: options?.allowExpired,
      });
      if (!record) return null;
      return {
        value: record.value,
        fetchedAt: record.fetchedAt,
        staleAt: record.staleAt,
        expiresAt: record.expiresAt,
        sourceKey: record.sourceKey,
        schemaVersion: record.schemaVersion,
        provenance: record.provenance,
        stale: record.stale,
        expired: record.expired,
      };
    },
    setResource: <T,>(
      kind: string,
      key: string,
      value: T,
      options: { cachePolicy: { staleMs: number; expireMs: number }; sourceKey?: string; schemaVersion?: number; provenance?: unknown },
    ) => {
      const record = resources.set<T>({
        namespace,
        kind,
        entityKey: key,
        sourceKey: options.sourceKey,
      }, value, {
        cachePolicy: options.cachePolicy,
        schemaVersion: options.schemaVersion,
        provenance: options.provenance as any,
      });
      return {
        value: record.value,
        fetchedAt: record.fetchedAt,
        staleAt: record.staleAt,
        expiresAt: record.expiresAt,
        sourceKey: record.sourceKey,
        schemaVersion: record.schemaVersion,
        provenance: record.provenance,
        stale: record.stale,
        expired: record.expired,
      };
    },
    deleteResource: (kind: string, key: string, options?: { sourceKey?: string }) => {
      resources.delete({
        namespace,
        kind,
        entityKey: key,
        sourceKey: options?.sourceKey,
      });
    },
  };
}
