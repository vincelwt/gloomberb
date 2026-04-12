import type { Database } from "bun:sqlite";
import { safeParseJson, serializeJson } from "./sqlite-json";
import { withSqliteBusyRetry } from "./sqlite-retry";

export const DEFAULT_PLUGIN_STATE_SCHEMA_VERSION = 1;

export interface PluginStateRecord<T = unknown> {
  value: T;
  schemaVersion: number;
  updatedAt: number;
}

interface CachedPluginStateRecord {
  value: unknown;
  schemaVersion: number;
  updatedAt: number;
  rawValue: string;
}

export class PluginStateStore {
  private readonly cache = new Map<string, CachedPluginStateRecord>();

  constructor(private readonly db: Database) {}

  get<T>(pluginId: string, key: string, schemaVersion = DEFAULT_PLUGIN_STATE_SCHEMA_VERSION): PluginStateRecord<T> | null {
    const cacheKey = `${pluginId}:${key}`;
    const row = withSqliteBusyRetry("load plugin state", () => (
      this.db
        .query<{ schema_version: number; value: string; updated_at: number }, [string, string]>(
          "SELECT schema_version, value, updated_at FROM plugin_state WHERE plugin_id = ? AND key = ?",
        )
        .get(pluginId, key)
    ));
    if (!row) {
      this.cache.delete(cacheKey);
      return null;
    }
    if (row.schema_version !== schemaVersion) {
      this.cache.delete(cacheKey);
      this.delete(pluginId, key);
      return null;
    }

    const cached = this.cache.get(cacheKey);
    if (cached && cached.schemaVersion === row.schema_version && cached.updatedAt === row.updated_at && cached.rawValue === row.value) {
      return cached as PluginStateRecord<T>;
    }

    const value = safeParseJson<T>(row.value);
    if (value == null) {
      this.cache.delete(cacheKey);
      this.delete(pluginId, key);
      return null;
    }

    const record: CachedPluginStateRecord = {
      value,
      schemaVersion: row.schema_version,
      updatedAt: row.updated_at,
      rawValue: row.value,
    };
    this.cache.set(cacheKey, record);
    return record as PluginStateRecord<T>;
  }

  set(pluginId: string, key: string, value: unknown, schemaVersion = DEFAULT_PLUGIN_STATE_SCHEMA_VERSION): void {
    const rawValue = serializeJson(value);
    const updatedAt = Date.now();
    withSqliteBusyRetry("save plugin state", () => {
      this.db
        .query(
          `INSERT OR REPLACE INTO plugin_state (plugin_id, key, schema_version, value, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(pluginId, key, schemaVersion, rawValue, updatedAt);
    });
    this.cache.set(`${pluginId}:${key}`, {
      value,
      schemaVersion,
      updatedAt,
      rawValue,
    });
  }

  delete(pluginId: string, key: string): void {
    withSqliteBusyRetry("delete plugin state", () => {
      this.db.query("DELETE FROM plugin_state WHERE plugin_id = ? AND key = ?").run(pluginId, key);
    });
    this.cache.delete(`${pluginId}:${key}`);
  }

  keys(pluginId: string): string[] {
    return withSqliteBusyRetry("list plugin state keys", () => (
      this.db
        .query<{ key: string }, [string]>(
          "SELECT key FROM plugin_state WHERE plugin_id = ? ORDER BY key",
        )
        .all(pluginId)
        .map((row) => row.key)
    ));
  }

  clear(pluginId: string): void {
    withSqliteBusyRetry("clear plugin state", () => {
      this.db.query("DELETE FROM plugin_state WHERE plugin_id = ?").run(pluginId);
    });
    for (const cacheKey of this.cache.keys()) {
      if (cacheKey.startsWith(`${pluginId}:`)) {
        this.cache.delete(cacheKey);
      }
    }
  }
}
