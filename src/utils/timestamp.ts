
const ISO_TIMEZONE_SUFFIX = /(Z|[+-]\d{2}:?\d{2})$/i;
const DATE_TIME_SPACE = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)$/i;
const TWITTER_TIMESTAMP = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})\s+([+-]\d{4})\s+(\d{4})$/i;

const TWITTER_MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

function normalizeTwitterTimestampInput(value: string): string | null {
  const match = value.match(TWITTER_TIMESTAMP);
  if (!match) return null;
  const [, monthName, day, time, offset, year] = match;
  const month = TWITTER_MONTHS[monthName!.toLowerCase()];
  if (!month) return null;
  const normalizedOffset = offset!.replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
  return `${year}-${month}-${day!.padStart(2, "0")}T${time}${normalizedOffset}`;
}

function normalizeTimestampInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  const twitterTimestamp = normalizeTwitterTimestampInput(trimmed);
  if (twitterTimestamp) return twitterTimestamp;
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
