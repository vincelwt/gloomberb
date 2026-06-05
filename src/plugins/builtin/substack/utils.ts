import { decodeHtmlEntities } from "../../../utils/html-entities";
import { normalizedHttpUrl } from "../../../utils/url";

export type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

export function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function rawStringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function firstString(record: JsonRecord | null, keys: string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return null;
}

export function firstRawString(record: JsonRecord | null, keys: string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = rawStringValue(record[key]);
    if (value) return value;
  }
  return null;
}

export function firstNumber(record: JsonRecord | null, keys: string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = numberValue(record[key]);
    if (value != null) return value;
  }
  return null;
}

export function firstValue(record: JsonRecord | null, keys: string[]): unknown {
  if (!record) return null;
  for (const key of keys) {
    if (record[key] != null) return record[key];
  }
  return null;
}

export function firstRecord(...values: unknown[]): JsonRecord | null {
  for (const value of values) {
    const record = asRecord(value);
    if (record) return record;
  }
  return null;
}

export function parseDateIso(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeUrl(value: unknown, baseUrl?: string | null): string | null {
  const raw = rawStringValue(value);
  if (!raw) return null;
  const direct = normalizedHttpUrl(raw);
  if (direct) return direct;
  if (!baseUrl) return null;
  try {
    const resolved = new URL(raw, baseUrl);
    return normalizedHttpUrl(resolved.toString());
  } catch {
    return null;
  }
}

export function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

export function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return timestamp(a) >= timestamp(b) ? a : b;
}

export function extractAttribute(tag: string, name: string): string | null {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = tag.match(pattern);
  return rawStringValue(match?.[1] ?? match?.[2] ?? match?.[3] ?? null);
}
