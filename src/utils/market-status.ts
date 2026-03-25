import type { MarketState } from "../types/financials";
import { colors } from "../theme/colors";

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
