const DATE_MARKER = "__gloomDate";
const MAP_MARKER = "__gloomMap";

export function encodeRpcValue(value: unknown): unknown {
  if (value instanceof Date) {
    return { [DATE_MARKER]: value.toISOString() };
  }
  if (value instanceof Map) {
    return { [MAP_MARKER]: [...value.entries()].map(([key, entry]) => [key, encodeRpcValue(entry)]) };
  }
  if (Array.isArray(value)) {
    return value.map(encodeRpcValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, encodeRpcValue(entry)]),
    );
  }
  return value;
}

export function decodeRpcValue<T = unknown>(value: unknown): T {
  if (Array.isArray(value)) {
    return value.map((entry) => decodeRpcValue(entry)) as T;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record[DATE_MARKER] === "string") {
      return new Date(record[DATE_MARKER]) as T;
    }
    if (Array.isArray(record[MAP_MARKER])) {
      return new Map(record[MAP_MARKER].map((entry) => {
        const pair = entry as [unknown, unknown];
        return [pair[0], decodeRpcValue(pair[1])];
      })) as T;
    }
    return Object.fromEntries(
      Object.entries(record).map(([key, entry]) => [key, decodeRpcValue(entry)]),
    ) as T;
  }
  return value as T;
}
