const ISO_TIMEZONE_SUFFIX = /(Z|[+-]\d{2}:?\d{2})$/i;
const DATE_TIME_SPACE = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)$/i;

function normalizeTimestampInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  const withSeparator = DATE_TIME_SPACE.test(trimmed)
    ? trimmed.replace(DATE_TIME_SPACE, "$1T$2")
    : trimmed;
  return ISO_TIMEZONE_SUFFIX.test(withSeparator) ? withSeparator : `${withSeparator}Z`;
}

export function normalizeTimestamp(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();

  const normalized = normalizeTimestampInput(value);
  if (!normalized) return normalized;

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? normalized : parsed.toISOString();
}

export function toTimestampMillis(value: Date | string): number {
  return new Date(normalizeTimestamp(value)).getTime();
}
