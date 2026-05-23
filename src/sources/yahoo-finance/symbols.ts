const EXCHANGE_SUFFIX_MAP: Record<string, string> = {
  NASDAQ: "", NMS: "", NYSE: "", AMEX: "", ARCA: "", NYSEArca: "", BATS: "", BYX: "", IEX: "", PINK: "", OTC: "",
  TSX: ".TO", VENTURE: ".V", CSE2: ".CN", CNSX: ".CN",
  TYO: ".T", JPX: ".T", TSEJ: ".T",
  HKEX: ".HK", SEHK: ".HK", HKG: ".HK",
  SSE: ".SS", SHG: ".SS", SZSE: ".SZ", SHE: ".SZ",
  TWSE: ".TW", TPE: ".TW", TPEX: ".TWO",
  KRX: ".KS", KSE: ".KS", KOSDAQ: ".KQ",
  SGX: ".SI", SES: ".SI",
  IDX: ".JK",
  NSE: ".NS", BSE: ".BO",
  ASX: ".AX", NZE: ".NZ",
  SET: ".BK", BKK: ".BK", KLSE: ".KL", MYX: ".KL", PSE: ".PS", HOSE: ".VN", HNX: ".VN",
  LSE: ".L", LSEETF: ".L",
  XETRA: ".DE", XETR: ".DE", IBIS: ".DE", IBIS2: ".DE", FWB: ".F", FWB2: ".F", GETTEX: ".DE", TGATE: ".DE", SWB: ".SG",
  EURONEXT: ".AS", AEB: ".AS", SBF: ".PA", "ENEXT.BE": ".BR", BVL: ".LS",
  BVME: ".MI", BM: ".MC",
  SIX: ".SW", EBS: ".SW", SWX: ".SW",
  SFB: ".ST", Stockholm: ".ST", OMX: ".ST", CPH: ".CO", HEX: ".HE", OSE: ".OL", OMXNO: ".OL", ICEX: ".IC",
  VSE: ".VI", WSE: ".WA", PRA: ".PR", BUX: ".BD", ATHEX: ".AT", BVB: ".RO", BIST: ".IS",
  TASE: ".TA",
  JSE: ".JO",
  BVMF: ".SA", MEXI: ".MX", BYMA: ".BA", BCS: ".SN",
  TADAWUL: ".SAU", QSE: ".QA", DFM: ".AE",
};

const EXCHANGE_FALLBACKS: Record<string, string[]> = {
  TSE: [".TO", ".T"],
  KRX: [".KS", ".KQ"], KSE: [".KS", ".KQ"],
  TWSE: [".TW", ".TWO"], TPE: [".TW", ".TWO"], TPEX: [".TWO", ".TW"],
  FWB2: [".F", ".DE"],
  EURONEXT: [".AS", ".PA", ".BR"], AEB: [".AS", ".PA", ".BR"], SBF: [".PA", ".AS", ".BR"],
};

const GENERIC_SUFFIX_FALLBACKS = [
  "", ".HK", ".T", ".TO", ".KS", ".KQ", ".TW", ".TWO", ".SS", ".SZ",
  ".AS", ".PA", ".BR", ".DE", ".F", ".L", ".MI", ".MC", ".SW", ".AX",
  ".SI", ".JK", ".OL", ".ST", ".CO", ".HE", ".NS", ".BO", ".SA",
  ".BK", ".KL", ".NZ", ".JO", ".TA", ".WA", ".VI",
];

const KNOWN_SUFFIXES = new Set(
  Object.values(EXCHANGE_SUFFIX_MAP).filter(Boolean)
    .concat(GENERIC_SUFFIX_FALLBACKS.filter(Boolean)),
);

export function getYahooSymbol(ticker: string, exchange: string): string {
  if (tickerHasYahooSuffix(ticker)) return ticker;
  const suffix = EXCHANGE_SUFFIX_MAP[exchange] ?? "";
  return `${normalizeYahooTicker(ticker, exchange)}${suffix}`;
}

export function getYahooSymbolsToTry(ticker: string, exchange: string): string[] {
  if (tickerHasYahooSuffix(ticker)) return [ticker];

  const normalized = normalizeYahooTicker(ticker, exchange);
  const dotVariant = normalized.includes(".") ? normalized.replace(/\./g, "-") : null;

  if (!exchange) {
    const symbols = new Set<string>();
    const candidates = [normalized];
    if (dotVariant) candidates.unshift(dotVariant);
    if (/^\d+$/.test(normalized) && normalized.length < 4) {
      candidates.push(normalized.padStart(4, "0"));
    }
    for (const candidate of candidates) {
      for (const suffix of GENERIC_SUFFIX_FALLBACKS) symbols.add(`${candidate}${suffix}`);
    }
    return Array.from(symbols);
  }

  const fallbacks = EXCHANGE_FALLBACKS[exchange];
  if (fallbacks) {
    const results = fallbacks.map((suffix) => `${normalized}${suffix}`);
    if (dotVariant) results.unshift(...fallbacks.map((suffix) => `${dotVariant}${suffix}`));
    return results;
  }

  const primary = getYahooSymbol(ticker, exchange);
  if (dotVariant) {
    const suffix = EXCHANGE_SUFFIX_MAP[exchange] ?? "";
    return [`${dotVariant}${suffix}`, primary];
  }
  return [primary];
}

function tickerHasYahooSuffix(ticker: string): boolean {
  const dot = ticker.indexOf(".");
  if (dot < 0) return false;
  return KNOWN_SUFFIXES.has(ticker.slice(dot));
}

function normalizeYahooTicker(ticker: string, exchange: string): string {
  if (isHongKongExchange(exchange) && /^\d+$/.test(ticker)) {
    return ticker.padStart(4, "0");
  }
  return ticker.replace(/ /g, "-");
}

function isHongKongExchange(exchange: string): boolean {
  return exchange === "HKEX" || exchange === "SEHK" || exchange === "HKG";
}
