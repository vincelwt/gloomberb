import type { MarketState, Quote } from "../types/financials";

const US_EXTENDED_HOURS_EXCHANGES = new Set(["NASDAQ", "NYSE", "AMEX", "ARCA", "BATS"]);
const EXCHANGE_TIME_ZONES: Record<string, string> = {
  NASDAQ: "America/New_York",
  NYSE: "America/New_York",
  ARCA: "America/New_York",
  AMEX: "America/New_York",
  BATS: "America/New_York",
  FWB: "Europe/Berlin",
  FWB2: "Europe/Berlin",
  XETRA: "Europe/Berlin",
  SWX: "Europe/Zurich",
  SFB: "Europe/Stockholm",
  HKEX: "Asia/Hong_Kong",
  JPX: "Asia/Tokyo",
  TPEX: "Asia/Taipei",
  NSE: "Asia/Kolkata",
  BSE: "Asia/Kolkata",
  LSE: "Europe/London",
};
const EXCHANGE_ALIASES: Record<string, string> = {
  NMS: "NASDAQ",
  NGM: "NASDAQ",
  NCM: "NASDAQ",
  NAS: "NASDAQ",
  NYQ: "NYSE",
  NYS: "NYSE",
  PCX: "AMEX",
  ASE: "AMEX",
  HKG: "HKEX",
  GER: "XETRA",
};

type UsSessionState = Exclude<MarketState, never>;

function normalizeExchange(exchange?: string): string {
  const normalized = (exchange ?? "").trim().toUpperCase();
  return EXCHANGE_ALIASES[normalized] ?? normalized;
}

function isUsExtendedHoursExchange(exchange?: string): boolean {
  return US_EXTENDED_HOURS_EXCHANGES.has(normalizeExchange(exchange));
}

function exchangeLocalDate(exchange: string, timestampMs: number): string | null {
  const timeZone = EXCHANGE_TIME_ZONES[normalizeExchange(exchange)];
  if (!timeZone) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestampMs));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

function usSessionState(timestampMs: number): UsSessionState {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestampMs));

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

export function isQuoteMissingActiveSessionPrice(quote: Quote): boolean {
  if ((quote.marketState === "PRE" || quote.marketState === "PREPRE") && quote.preMarketPrice == null) {
    return true;
  }
  if ((quote.marketState === "POST" || quote.marketState === "POSTPOST") && quote.postMarketPrice == null) {
    return true;
  }
  return false;
}

export function isQuoteStaleForCurrentSession(quote: Quote | null | undefined, now = Date.now()): boolean {
  if (!quote) return false;
  if (isQuoteMissingActiveSessionPrice(quote)) return true;

  const exchange = normalizeExchange(quote.listingExchangeName || quote.exchangeName);
  if (!exchange || !Number.isFinite(quote.lastUpdated)) return false;

  const quoteDate = exchangeLocalDate(exchange, quote.lastUpdated);
  const currentDate = exchangeLocalDate(exchange, now);
  if (!quoteDate || !currentDate || quoteDate === currentDate) return false;

  if (quote.marketState === "REGULAR") return true;

  if (isUsExtendedHoursExchange(exchange)) {
    const session = usSessionState(now);
    return session === "PRE" || session === "REGULAR" || session === "POST";
  }

  return false;
}

export function hasFreshQuoteForCurrentSession(
  quotes: Iterable<Quote | null | undefined>,
  now = Date.now(),
): boolean {
  for (const quote of quotes) {
    if (quote && !isQuoteStaleForCurrentSession(quote, now)) {
      return true;
    }
  }
  return false;
}
