import type { Database } from "bun:sqlite";
import type { CachePolicy, PersistedResourceValue } from "../types/persistence";
import type { JsonValue } from "./sqlite-json";
import { safeParseJson, serializeJson } from "./sqlite-json";

const RESOURCE_CACHE_SOFT_ROW_LIMIT = 25_000;
const RESOURCE_CACHE_SOFT_SIZE_LIMIT = 100 * 1024 * 1024;
const DEFAULT_RESOURCE_SCHEMA_VERSION = 1;
const EMPTY_VARIANT_KEY = "";
const EMPTY_SOURCE_KEY = "";

interface ResourceCacheRow {
  namespace: string;
  kind: string;
  entity_key: string;
  variant_key: string;
  source_key: string;
  schema_version: number;
  payload: string;
  provenance: string | null;
  fetched_at: number;
  stale_at: number;
  expires_at: number;
  last_accessed_at: number;
  size_bytes: number;
}

export interface ResourceCacheKey {
  namespace: string;
  kind: string;
  entityKey: string;
  variantKey?: string;
  sourceKey?: string;
}

export interface CachedResourceRecord<T = unknown> extends PersistedResourceValue<T> {
  namespace: string;
  kind: string;
  entityKey: string;
  variantKey: string;
  sourceKey: string;
  provenance: JsonValue | null;
  lastAccessedAt: number;
  sizeBytes: number;
}

export interface SetResourceOptions {
  schemaVersion?: number;
  cachePolicy: CachePolicy;
  provenance?: JsonValue | null;
  fetchedAt?: number;
}

export interface GetResourceOptions {
  schemaVersion?: number;
  allowExpired?: boolean;
  touch?: boolean;
}

export interface ListResourceOptions extends GetResourceOptions {
  variantKeys?: string[];
  sourceKeys?: string[];
}

function normalizeVariantKey(value: string | undefined): string {
  return value ?? EMPTY_VARIANT_KEY;
}

function normalizeSourceKey(value: string | undefined): string {
  return value ?? EMPTY_SOURCE_KEY;
}

function isExpired(expiresAt: number): boolean {
  return expiresAt < Date.now();
}

function isStale(staleAt: number): boolean {
  return staleAt < Date.now();
}

function sortRows(rows: ResourceCacheRow[]): ResourceCacheRow[] {
  return [...rows].sort((a, b) => {
    if (a.expires_at !== b.expires_at) return b.expires_at - a.expires_at;
    if (a.stale_at !== b.stale_at) return b.stale_at - a.stale_at;
    if (a.fetched_at !== b.fetched_at) return b.fetched_at - a.fetched_at;
    return b.last_accessed_at - a.last_accessed_at;
  });
}

export class ResourceStore {
  constructor(private readonly db: Database) {}

  private toCachedResource<T>(row: ResourceCacheRow): CachedResourceRecord<T> | null {
    const value = safeParseJson<T>(row.payload);
    if (value == null) return null;
    return {
      namespace: row.namespace,
      kind: row.kind,
      entityKey: row.entity_key,
      variantKey: row.variant_key,
      sourceKey: row.source_key,
      value,
      schemaVersion: row.schema_version,
      provenance: safeParseJson<JsonValue>(row.provenance),
      fetchedAt: row.fetched_at,
      staleAt: row.stale_at,
      expiresAt: row.expires_at,
      lastAccessedAt: row.last_accessed_at,
      sizeBytes: row.size_bytes,
      stale: isStale(row.stale_at),
      expired: isExpired(row.expires_at),
    };
  }

  private deleteExact(key: ResourceCacheKey): void {
    this.db
      .query(
        `DELETE FROM resource_cache
         WHERE namespace = ? AND kind = ? AND entity_key = ? AND variant_key = ? AND source_key = ?`,
      )
      .run(
        key.namespace,
        key.kind,
        key.entityKey,
        normalizeVariantKey(key.variantKey),
        normalizeSourceKey(key.sourceKey),
      );
  }

  private touch(key: ResourceCacheKey): void {
    this.db
      .query(
        `UPDATE resource_cache
         SET last_accessed_at = ?
         WHERE namespace = ? AND kind = ? AND entity_key = ? AND variant_key = ? AND source_key = ?`,
      )
      .run(
        Date.now(),
        key.namespace,
        key.kind,
        key.entityKey,
        normalizeVariantKey(key.variantKey),
        normalizeSourceKey(key.sourceKey),
      );
  }

  private pruneIfNeeded(): void {
    const stats = this.db
      .query<{ count: number; total_size: number }, []>(
        "SELECT COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as total_size FROM resource_cache",
      )
      .get();
    const count = stats?.count ?? 0;
    const totalSize = stats?.total_size ?? 0;
    if (count <= RESOURCE_CACHE_SOFT_ROW_LIMIT && totalSize <= RESOURCE_CACHE_SOFT_SIZE_LIMIT) return;

    this.db.query("DELETE FROM resource_cache WHERE expires_at < ?").run(Date.now());

    const remaining = this.db
      .query<{ count: number; total_size: number }, []>(
        "SELECT COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as total_size FROM resource_cache",
      )
      .get();
    const remainingCount = remaining?.count ?? 0;
    const remainingSize = remaining?.total_size ?? 0;
    if (remainingCount <= RESOURCE_CACHE_SOFT_ROW_LIMIT && remainingSize <= RESOURCE_CACHE_SOFT_SIZE_LIMIT) return;

    const rowsToDelete = this.db
      .query<{ namespace: string; kind: string; entity_key: string; variant_key: string; source_key: string }, [number]>(
        `SELECT namespace, kind, entity_key, variant_key, source_key
         FROM resource_cache
         ORDER BY last_accessed_at ASC, fetched_at ASC
         LIMIT ?`,
      )
      .all(Math.max(Math.ceil((remainingCount - RESOURCE_CACHE_SOFT_ROW_LIMIT) + 250), 250));

    if (rowsToDelete.length === 0) return;
    const remove = this.db.query(
      `DELETE FROM resource_cache
       WHERE namespace = ? AND kind = ? AND entity_key = ? AND variant_key = ? AND source_key = ?`,
    );
    const tx = this.db.transaction(() => {
      for (const row of rowsToDelete) {
        remove.run(row.namespace, row.kind, row.entity_key, row.variant_key, row.source_key);
      }
    });
    tx();
  }

  get<T>(key: ResourceCacheKey, options: GetResourceOptions = {}): CachedResourceRecord<T> | null {
    const row = this.db
      .query<ResourceCacheRow, [string, string, string, string, string]>(
        `SELECT namespace, kind, entity_key, variant_key, source_key, schema_version, payload, provenance,
                fetched_at, stale_at, expires_at, last_accessed_at, size_bytes
         FROM resource_cache
         WHERE namespace = ? AND kind = ? AND entity_key = ? AND variant_key = ? AND source_key = ?`,
      )
      .get(
        key.namespace,
        key.kind,
        key.entityKey,
        normalizeVariantKey(key.variantKey),
        normalizeSourceKey(key.sourceKey),
      );

    if (!row) return null;
    if (!options.allowExpired && isExpired(row.expires_at)) return null;
    if (options.schemaVersion != null && row.schema_version !== options.schemaVersion) {
      this.deleteExact(key);
      return null;
    }

    const record = this.toCachedResource<T>(row);
    if (!record) {
      this.deleteExact(key);
      return null;
    }

    if (options.touch !== false) {
      this.touch(key);
      record.lastAccessedAt = Date.now();
    }
    return record;
  }

  list<T>(
    key: Pick<ResourceCacheKey, "namespace" | "kind" | "entityKey">,
    options: ListResourceOptions = {},
  ): CachedResourceRecord<T>[] {
    const rows = this.db
      .query<ResourceCacheRow, [string, string, string]>(
        `SELECT namespace, kind, entity_key, variant_key, source_key, schema_version, payload, provenance,
                fetched_at, stale_at, expires_at, last_accessed_at, size_bytes
         FROM resource_cache
         WHERE namespace = ? AND kind = ? AND entity_key = ?`,
      )
      .all(key.namespace, key.kind, key.entityKey);

    const allowedVariantKeys = options.variantKeys ? new Set(options.variantKeys.map(normalizeVariantKey)) : null;
    const allowedSourceKeys = options.sourceKeys ? new Set(options.sourceKeys.map(normalizeSourceKey)) : null;

    const records: CachedResourceRecord<T>[] = [];
    for (const row of sortRows(rows)) {
      if (!options.allowExpired && isExpired(row.expires_at)) continue;
      if (allowedVariantKeys && !allowedVariantKeys.has(row.variant_key)) continue;
      if (allowedSourceKeys && !allowedSourceKeys.has(row.source_key)) continue;
      if (options.schemaVersion != null && row.schema_version !== options.schemaVersion) {
        this.deleteExact({
          namespace: row.namespace,
          kind: row.kind,
          entityKey: row.entity_key,
          variantKey: row.variant_key,
          sourceKey: row.source_key,
        });
        continue;
      }
      const record = this.toCachedResource<T>(row);
      if (!record) {
        this.deleteExact({
          namespace: row.namespace,
          kind: row.kind,
          entityKey: row.entity_key,
          variantKey: row.variant_key,
          sourceKey: row.source_key,
        });
        continue;
      }
      records.push(record);
    }
    return records;
  }

  set<T>(key: ResourceCacheKey, value: T, options: SetResourceOptions): CachedResourceRecord<T> {
    const now = options.fetchedAt ?? Date.now();
    const payload = serializeJson(value);
    const provenance = options.provenance == null ? null : serializeJson(options.provenance);
    const rowKey = {
      namespace: key.namespace,
      kind: key.kind,
      entityKey: key.entityKey,
      variantKey: normalizeVariantKey(key.variantKey),
      sourceKey: normalizeSourceKey(key.sourceKey),
    };

    this.db
      .query(
        `INSERT OR REPLACE INTO resource_cache (
          namespace, kind, entity_key, variant_key, source_key, schema_version,
          payload, provenance, fetched_at, stale_at, expires_at, last_accessed_at, size_bytes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        rowKey.namespace,
        rowKey.kind,
        rowKey.entityKey,
        rowKey.variantKey,
        rowKey.sourceKey,
        options.schemaVersion ?? DEFAULT_RESOURCE_SCHEMA_VERSION,
        payload,
        provenance,
        now,
        now + options.cachePolicy.staleMs,
        now + options.cachePolicy.expireMs,
        now,
        Buffer.byteLength(payload, "utf8"),
      );

    this.pruneIfNeeded();
    return this.get<T>(rowKey, { allowExpired: true, touch: false })!;
  }

  delete(key: ResourceCacheKey): void {
    this.deleteExact(key);
  }

  clear(namespace?: string): void {
    if (!namespace) {
      this.db.query("DELETE FROM resource_cache").run();
      return;
    }
    this.db.query("DELETE FROM resource_cache WHERE namespace = ?").run(namespace);
  }
}
