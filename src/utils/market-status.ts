import type { MarketState, Quote, QuoteFieldProvenance } from "../types/financials";
import { colors, priceColor } from "../theme/colors";
import { formatPercentRaw } from "./format";
import { formatMarketPrice } from "./market-format";

export interface ActiveQuoteDisplay {
  price: number;
  change: number;
  changePercent: number;
}

export function marketStateLabel(state: MarketState): string {
  switch (state) {
    case "PRE": return "PRE-MKT";
    case "REGULAR": return "OPEN";
    case "POST": return "AFTER-HRS";
    case "PREPRE":
    case "POSTPOST":
    case "CLOSED": return "CLOSED";
  }
}

export function marketStateColor(state: MarketState): string {
  switch (state) {
    case "REGULAR": return colors.positive;
    case "PRE":
    case "POST": return colors.textBright;
    case "PREPRE":
    case "POSTPOST":
    case "CLOSED": return colors.textDim;
  }
}

export function marketStateDot(state?: MarketState): string {
  switch (state) {
    case "REGULAR":
      return "\u25CF";
    case "PRE":
    case "POST":
      return "\u25D0";
    case "CLOSED":
    case "PREPRE":
    case "POSTPOST":
      return "\u25CB";
    default:
      return "\u25CC";
  }
}

/** Short exchange display name */
export function exchangeShortName(exchangeName?: string, fullExchangeName?: string): string {
  if (!exchangeName && !fullExchangeName) return "";
  const name = exchangeName || fullExchangeName || "";
  // Common Yahoo Finance exchange abbreviations
  const map: Record<string, string> = {
    NMS: "NASDAQ", NGM: "NASDAQ", NCM: "NASDAQ", NAS: "NASDAQ",
    NYQ: "NYSE", NYS: "NYSE",
    PCX: "AMEX", ASE: "AMEX",
    HKG: "HKEX",
    TYO: "TYO",
    LSE: "LSE",
    ASX: "ASX",
    SGX: "SGX",
    KSC: "KRX", KOE: "KOSDAQ",
    TAI: "TWSE",
    SHH: "SSE", SHZ: "SZSE",
    PAR: "EURONEXT", AMS: "EURONEXT", BRU: "EURONEXT",
    GER: "XETRA",
    OSL: "OSE",
    BOM: "BSE", NSI: "NSE",
    SAO: "B3",
    JPX: "TYO",
  };
  return map[name] || name;
}

export function quoteProviderLabel(providerId?: string): string {
  switch (providerId) {
    case "ibkr":
      return "Broker";
    case "gloomberb-cloud":
      return "Cloud";
    case "yahoo":
      return "Yahoo";
    default:
      return providerId || "Unknown";
  }
}

export function quoteSourceLabel(
  provenance?: QuoteFieldProvenance,
  kind: "price" | "session" = "price",
): string {
  if (!provenance?.providerId) return "Unknown";
  if (provenance.providerId === "ibkr") {
    if (kind === "session") return "Broker";
    if (provenance.dataSource === "live") return "IBKR live";
    if (provenance.dataSource === "delayed") return "IBKR delayed";
    return "IBKR";
  }
  if (provenance.providerId === "gloomberb-cloud") return "Cloud";
  if (provenance.providerId === "yahoo") return "Yahoo";
  return provenance.providerId;
}

/** Get extended hours price info (pre-market or after-hours) for display */
export function getExtendedHoursInfo(quote: Quote | null | undefined): { text: string; color: string } | null {
  if (!quote) return null;
  if ((quote.marketState === "PRE" || quote.marketState === "PREPRE") && quote.preMarketPrice != null) {
    const chg = quote.preMarketChangePercent ?? 0;
    return { text: `Pre ${formatMarketPrice(quote.preMarketPrice)} ${formatPercentRaw(chg)}`, color: priceColor(chg) };
  }
  if ((quote.marketState === "POST" || quote.marketState === "POSTPOST") && quote.postMarketPrice != null) {
    const chg = quote.postMarketChangePercent ?? 0;
    return { text: `AH ${formatMarketPrice(quote.postMarketPrice)} ${formatPercentRaw(chg)}`, color: priceColor(chg) };
  }
  return null;
}

export function getActiveQuoteDisplay(quote: Quote | null | undefined): ActiveQuoteDisplay | null {
  if (!quote) return null;
  if ((quote.marketState === "PRE" || quote.marketState === "PREPRE") && quote.preMarketPrice != null) {
    return {
      price: quote.preMarketPrice,
      change: quote.preMarketChange ?? 0,
      changePercent: quote.preMarketChangePercent ?? 0,
    };
  }
  if ((quote.marketState === "POST" || quote.marketState === "POSTPOST") && quote.postMarketPrice != null) {
    return {
      price: quote.postMarketPrice,
      change: quote.postMarketChange ?? 0,
      changePercent: quote.postMarketChangePercent ?? 0,
    };
  }
  return {
    price: quote.price,
    change: quote.change,
    changePercent: quote.changePercent,
  };
}
