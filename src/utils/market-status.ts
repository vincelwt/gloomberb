import type { MarketState, Quote } from "../types/financials";
import { colors, priceColor } from "../theme/colors";
import { formatPercentRaw } from "./format";

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

/** Get extended hours price info (pre-market or after-hours) for display */
export function getExtendedHoursInfo(quote: Quote | null | undefined): { text: string; color: string } | null {
  if (!quote) return null;
  if ((quote.marketState === "PRE" || quote.marketState === "PREPRE") && quote.preMarketPrice != null) {
    const chg = quote.preMarketChangePercent ?? 0;
    return { text: `Pre ${quote.preMarketPrice.toFixed(2)} ${formatPercentRaw(chg)}`, color: priceColor(chg) };
  }
  if ((quote.marketState === "POST" || quote.marketState === "POSTPOST") && quote.postMarketPrice != null) {
    const chg = quote.postMarketChangePercent ?? 0;
    return { text: `AH ${quote.postMarketPrice.toFixed(2)} ${formatPercentRaw(chg)}`, color: priceColor(chg) };
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
