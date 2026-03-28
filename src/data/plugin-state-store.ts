import type { Database } from "bun:sqlite";
import { safeParseJson, serializeJson } from "./sqlite-json";

export const DEFAULT_PLUGIN_STATE_SCHEMA_VERSION = 1;

export interface PluginStateRecord<T = unknown> {
  value: T;
  schemaVersion: number;
  updatedAt: number;
}

export class PluginStateStore {
  constructor(private readonly db: Database) {}

  get<T>(pluginId: string, key: string, schemaVersion = DEFAULT_PLUGIN_STATE_SCHEMA_VERSION): PluginStateRecord<T> | null {
    const row = this.db
      .query<{ schema_version: number; value: string; updated_at: number }, [string, string]>(
        "SELECT schema_version, value, updated_at FROM plugin_state WHERE plugin_id = ? AND key = ?",
      )
      .get(pluginId, key);
    if (!row) return null;
    if (row.schema_version !== schemaVersion) {
      this.delete(pluginId, key);
      return null;
    }
    const value = safeParseJson<T>(row.value);
    if (value == null) {
      this.delete(pluginId, key);
      return null;
    }
    return {
      value,
      schemaVersion: row.schema_version,
      updatedAt: row.updated_at,
    };
  }

  set(pluginId: string, key: string, value: unknown, schemaVersion = DEFAULT_PLUGIN_STATE_SCHEMA_VERSION): void {
    this.db
      .query(
        `INSERT OR REPLACE INTO plugin_state (plugin_id, key, schema_version, value, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(pluginId, key, schemaVersion, serializeJson(value), Date.now());
  }

  delete(pluginId: string, key: string): void {
    this.db.query("DELETE FROM plugin_state WHERE plugin_id = ? AND key = ?").run(pluginId, key);
  }

  keys(pluginId: string): string[] {
    return this.db
      .query<{ key: string }, [string]>(
        "SELECT key FROM plugin_state WHERE plugin_id = ? ORDER BY key",
      )
      .all(pluginId)
      .map((row) => row.key);
  }

  clear(pluginId: string): void {
    this.db.query("DELETE FROM plugin_state WHERE plugin_id = ?").run(pluginId);
  }
}
