import type { MarketState } from "../../types/financials";
import { canonicalExchange, EXCHANGE_TIME_ZONES } from "../../utils/exchanges";

const US_EXTENDED_HOURS_EXCHANGES = new Set(["NASDAQ", "NYSE", "AMEX", "ARCA", "BATS"]);
const ALWAYS_OPEN_EXCHANGES = new Set(["CCC"]);
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const OVERNIGHT_CLOSE_MAX_AGE_MS = 20 * 60 * 60 * 1000;
const exchangeLocalDateFormatters = new Map<string, Intl.DateTimeFormat>();
const usSessionFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

type UsSessionState = Exclude<MarketState, never>;

function isUsExtendedHoursExchange(exchange?: string): boolean {
  return US_EXTENDED_HOURS_EXCHANGES.has(canonicalExchange(exchange));
}

function getExchangeLocalDateFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = exchangeLocalDateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    exchangeLocalDateFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function exchangeLocalDate(exchange: string, timestampMs: number): string | null {
  const timeZone = EXCHANGE_TIME_ZONES[canonicalExchange(exchange)];
  if (!timeZone) return null;

  const parts = getExchangeLocalDateFormatter(timeZone).formatToParts(new Date(timestampMs));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

function isoLocalDateToUtcDay(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

function localWeekdaysBetween(earlierDate: string, laterDate: string): number {
  const earlierDay = isoLocalDateToUtcDay(earlierDate);
  const laterDay = isoLocalDateToUtcDay(laterDate);
  if (earlierDay == null || laterDay == null || laterDay <= earlierDay) return 0;

  let weekdays = 0;
  for (let day = earlierDay + 1; day <= laterDay; day += 1) {
    const weekday = new Date(day * MS_PER_DAY).getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      weekdays += 1;
    }
  }
  return weekdays;
}

function localWeekday(date: string): number | null {
  const day = isoLocalDateToUtcDay(date);
  return day == null ? null : new Date(day * MS_PER_DAY).getUTCDay();
}

function usSessionState(timestampMs: number): UsSessionState {
  const parts = usSessionFormatter.formatToParts(new Date(timestampMs));

  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  if (weekday === "Sat" || weekday === "Sun") return "CLOSED";

  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  const totalMinutes = hour * 60 + minute;

  if (totalMinutes < 4 * 60) return "PREPRE";
  if (totalMinutes < 9 * 60 + 30) return "PRE";
  if (totalMinutes < 16 * 60) return "REGULAR";
  if (totalMinutes < 20 * 60) return "POST";
  return "POSTPOST";
}

export function isTimestampStaleForExchangeSession(
  timestampMs: number,
  exchange?: string,
  now = Date.now(),
  marketState?: MarketState,
): boolean {
  try {
    return isTimestampStaleForExchangeSessionUnsafe(timestampMs, exchange, now, marketState);
  } catch {
    return true;
  }
}

function isTimestampStaleForExchangeSessionUnsafe(
  timestampMs: number,
  exchange?: string,
  now = Date.now(),
  marketState?: MarketState,
): boolean {
  const canonical = canonicalExchange(exchange);
  if (!canonical || !Number.isFinite(timestampMs) || !Number.isFinite(now)) return false;

  const timestampDate = exchangeLocalDate(canonical, timestampMs);
  const currentDate = exchangeLocalDate(canonical, now);
  if (!timestampDate || !currentDate || timestampDate === currentDate) return false;

  if (ALWAYS_OPEN_EXCHANGES.has(canonical)) return true;
  if (marketState === "REGULAR") return true;

  if (isUsExtendedHoursExchange(canonical)) {
    const session = usSessionState(now);
    if (session === "PRE" || session === "REGULAR" || session === "POST") {
      return true;
    }
  }

  const weekdaysBehind = localWeekdaysBetween(timestampDate, currentDate);
  if (weekdaysBehind > 1) return true;
  if (weekdaysBehind === 1 && now - timestampMs > OVERNIGHT_CLOSE_MAX_AGE_MS) {
    return localWeekday(currentDate) !== 1;
  }
  return false;
}
