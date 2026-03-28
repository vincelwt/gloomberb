export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export function serializeJson(value: unknown): string {
  return JSON.stringify(value);
}

export function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

export function safeParseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return parseJson<T>(value);
  } catch {
    return null;
  }
}
