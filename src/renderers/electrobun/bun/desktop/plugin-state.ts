import type { PluginRegistry } from "../../../../plugins/registry";
import type { PersistedAuthUser } from "../../../../api-client";
import { apiClient } from "../../../../api-client";

interface PluginStateBackendSetEntry {
  pluginId: string;
  key: string;
  value: unknown;
  schemaVersion?: number;
}

interface PluginStateBackendStore {
  set(pluginId: string, key: string, value: unknown, schemaVersion?: number): void;
  setMany(entries: PluginStateBackendSetEntry[]): void;
  delete(pluginId: string, key: string): void;
}

interface PersistedCloudSession {
  sessionToken?: string | null;
  user?: PersistedAuthUser | null;
}

function normalizePluginStateSetEntry(entry: unknown): PluginStateBackendSetEntry | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  if (typeof record.pluginId !== "string" || typeof record.key !== "string") return null;
  return {
    pluginId: record.pluginId,
    key: record.key,
    value: record.value,
    schemaVersion: typeof record.schemaVersion === "number" ? record.schemaVersion : undefined,
  };
}

function syncBackendCloudAuthState(pluginId: string, key: string, value: unknown): void {
  if (pluginId !== "gloomberb-cloud" || (key !== "session" && key !== "resume:session")) return;

  const session = value && typeof value === "object" ? value as PersistedCloudSession : null;
  const token = typeof session?.sessionToken === "string" && session.sessionToken.length > 0
    ? session.sessionToken
    : null;

  apiClient.setSessionToken(token);
  apiClient.setWebSocketToken(null);
  apiClient.restoreCachedUser(token ? session?.user ?? null : null);
}

export function handleDesktopPluginStateRequest(
  store: PluginStateBackendStore,
  method: string,
  payload: Record<string, unknown>,
): null {
  switch (method) {
    case "pluginState.set":
      store.set(payload.pluginId as string, payload.key as string, payload.value, payload.schemaVersion as number | undefined);
      syncBackendCloudAuthState(payload.pluginId as string, payload.key as string, payload.value);
      return null;
    case "pluginState.setMany": {
      const entries = Array.isArray(payload.entries)
        ? payload.entries.flatMap((entry) => {
            const normalized = normalizePluginStateSetEntry(entry);
            return normalized ? [normalized] : [];
          })
        : [];
      store.setMany(entries);
      for (const entry of entries) {
        syncBackendCloudAuthState(entry.pluginId, entry.key, entry.value);
      }
      return null;
    }
    case "pluginState.delete":
      store.delete(payload.pluginId as string, payload.key as string);
      syncBackendCloudAuthState(payload.pluginId as string, payload.key as string, null);
      return null;
    default:
      throw new Error(`Unknown plugin state method: ${method}`);
  }
}

export function loadDesktopPluginState(registry: PluginRegistry): Record<string, Record<string, unknown>> {
  const state: Record<string, Record<string, unknown>> = {};
  for (const pluginId of registry.allPlugins.keys()) {
    const keys = registry.persistence.pluginState.keys(pluginId);
    if (keys.length === 0) continue;
    state[pluginId] = {};
    for (const key of keys) {
      const record = registry.persistence.pluginState.get(pluginId, key);
      if (record) state[pluginId]![key] = record.value;
    }
  }
  return state;
}
