import type { Database } from "bun:sqlite";
import { safeParseJson, serializeJson } from "./sqlite-json";

export const DEFAULT_SESSION_SCHEMA_VERSION = 1;

export interface SessionSnapshotRecord<T = unknown> {
  sessionId: string;
  value: T;
  schemaVersion: number;
  updatedAt: number;
}

export class SessionStore {
  constructor(private readonly db: Database) {}

  get<T>(sessionId = "app", schemaVersion = DEFAULT_SESSION_SCHEMA_VERSION): SessionSnapshotRecord<T> | null {
    const row = this.db
      .query<{ schema_version: number; value: string; updated_at: number }, [string]>(
        "SELECT schema_version, value, updated_at FROM session_snapshots WHERE session_id = ?",
      )
      .get(sessionId);
    if (!row) return null;
    if (row.schema_version !== schemaVersion) {
      this.delete(sessionId);
      return null;
    }
    const value = safeParseJson<T>(row.value);
    if (value == null) {
      this.delete(sessionId);
      return null;
    }
    return {
      sessionId,
      value,
      schemaVersion: row.schema_version,
      updatedAt: row.updated_at,
    };
  }

  set(sessionId: string, value: unknown, schemaVersion = DEFAULT_SESSION_SCHEMA_VERSION): void {
    this.db
      .query(
        `INSERT OR REPLACE INTO session_snapshots (session_id, schema_version, value, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(sessionId, schemaVersion, serializeJson(value), Date.now());
  }

  delete(sessionId: string): void {
    this.db.query("DELETE FROM session_snapshots WHERE session_id = ?").run(sessionId);
  }
}
