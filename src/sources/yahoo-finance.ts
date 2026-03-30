import type { Quote, Fundamentals, FinancialStatement, PricePoint, TickerFinancials, MarketState, OptionContract, OptionsChain, CompanyProfile } from "../types/financials";
import type { DataProvider, MarketDataRequestContext, NewsItem, SecFilingItem } from "../types/data-provider";
import type { TimeRange } from "../components/chart/chart-types";
import type { InstrumentSearchResult } from "../types/instrument";
import { SecEdgarClient } from "./sec-edgar";

// Exchange suffix mapping for Yahoo Finance ticker symbols
// Includes both canonical codes and common IBKR listing exchange aliases
const EXCHANGE_SUFFIX_MAP: Record<string, string> = {
  // US exchanges
  NASDAQ: "", NMS: "", NYSE: "", AMEX: "", ARCA: "", NYSEArca: "", BATS: "", BYX: "", IEX: "", PINK: "", OTC: "",
  // Canada
  TSX: ".TO", VENTURE: ".V", CSE2: ".CN", CNSX: ".CN",
  // Japan (note: TSE is ambiguous — handled via EXCHANGE_FALLBACKS)
  TYO: ".T", JPX: ".T", TSEJ: ".T",
  // Hong Kong
  HKEX: ".HK", SEHK: ".HK", HKG: ".HK",
  // China
  SSE: ".SS", SHG: ".SS", SZSE: ".SZ", SHE: ".SZ",
  // Taiwan
  TWSE: ".TW", TPE: ".TW",
  // Korea
  KRX: ".KS", KSE: ".KS", KOSDAQ: ".KQ",
  // Singapore
  SGX: ".SI", SES: ".SI",
  // Indonesia
  IDX: ".JK",
  // India
  NSE: ".NS", BSE: ".BO",
  // Australia & New Zealand
  ASX: ".AX", NZE: ".NZ",
  // Thailand, Malaysia, Philippines, Vietnam
  SET: ".BK", BKK: ".BK", KLSE: ".KL", MYX: ".KL", PSE: ".PS", HOSE: ".VN", HNX: ".VN",
  // UK
  LSE: ".L", LSEETF: ".L",
  // Germany
  XETRA: ".DE", XETR: ".DE", IBIS: ".DE", IBIS2: ".DE", FWB: ".F", FWB2: ".DE", GETTEX: ".DE", TGATE: ".DE", SWB: ".SG",
  // France, Netherlands, Belgium, Portugal (Euronext)
  EURONEXT: ".AS", AEB: ".AS", SBF: ".PA", "ENEXT.BE": ".BR", BVL: ".LS",
  // Italy & Spain
  BVME: ".MI", BM: ".MC",
  // Switzerland
  SIX: ".SW", EBS: ".SW", SWX: ".SW",
  // Nordics
  SFB: ".ST", Stockholm: ".ST", OMX: ".ST", CPH: ".CO", HEX: ".HE", OSE: ".OL", OMXNO: ".OL", ICEX: ".IC",
  // Central/Eastern Europe
  VSE: ".VI", WSE: ".WA", PRA: ".PR", BUX: ".BD", ATHEX: ".AT", BVB: ".RO", BIST: ".IS",
  // Israel
  TASE: ".TA",
  // South Africa
  JSE: ".JO",
  // Brazil & Latin America
  BVMF: ".SA", MEXI: ".MX", BYMA: ".BA", BCS: ".SN",
  // Middle East
  TADAWUL: ".SAU", QSE: ".QA", DFM: ".AE",
};

const EXCHANGE_FALLBACKS: Record<string, string[]> = {
  // TSE is ambiguous: Toronto (.TO) vs Tokyo (.T) — try both
  TSE: [".TO", ".T"],
  KRX: [".KS", ".KQ"], KSE: [".KS", ".KQ"],
  TWSE: [".TW", ".TWO"], TPE: [".TW", ".TWO"],
  EURONEXT: [".AS", ".PA", ".BR"], AEB: [".AS", ".PA", ".BR"], SBF: [".PA", ".AS", ".BR"],
};

const GENERIC_SUFFIX_FALLBACKS = [
  "", ".HK", ".T", ".TO", ".KS", ".KQ", ".TW", ".TWO", ".SS", ".SZ",
  ".AS", ".PA", ".BR", ".DE", ".F", ".L", ".MI", ".MC", ".SW", ".AX",
  ".SI", ".JK", ".OL", ".ST", ".CO", ".HE", ".NS", ".BO", ".SA",
  ".BK", ".KL", ".NZ", ".JO", ".TA", ".WA", ".VI",
];

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1500;
const FETCH_TIMEOUT_MS = 20_000;
const RETRYABLE_ERROR = /429|403|401|Too Many Requests|Forbidden|Unauthorized|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed|Failed to get crumb|socket hang up|503|502|504/i;

const TIMESERIES_TYPES = {
  annual: [
    // Income Statement
    "annualTotalRevenue", "annualCostOfRevenue", "annualGrossProfit",
    "annualSellingGeneralAndAdministration", "annualResearchAndDevelopment",
    "annualOperatingExpense", "annualOperatingIncome",
    "annualInterestExpense", "annualTaxProvision",
    "annualNetIncome", "annualEBITDA",
    "annualBasicEPS", "annualDilutedEPS", "annualDilutedAverageShares",
    // Cash Flow
    "annualOperatingCashFlow", "annualCapitalExpenditure", "annualFreeCashFlow",
    "annualInvestingCashFlow", "annualFinancingCashFlow",
    "annualIssuanceOfDebt", "annualRepurchaseOfCapitalStock", "annualCashDividendsPaid",
    // Balance Sheet
    "annualTotalAssets", "annualCurrentAssets", "annualCashAndCashEquivalents",
    "annualTotalLiabilitiesNetMinorityInterest", "annualCurrentLiabilities",
    "annualLongTermDebt", "annualTotalDebt",
    "annualStockholdersEquity", "annualRetainedEarnings",
  ],
  quarterly: [
    // Income Statement
    "quarterlyTotalRevenue", "quarterlyCostOfRevenue", "quarterlyGrossProfit",
    "quarterlySellingGeneralAndAdministration", "quarterlyResearchAndDevelopment",
    "quarterlyOperatingExpense", "quarterlyOperatingIncome",
    "quarterlyInterestExpense", "quarterlyTaxProvision",
    "quarterlyNetIncome", "quarterlyEBITDA",
    "quarterlyBasicEPS", "quarterlyDilutedEPS", "quarterlyDilutedAverageShares",
    // Cash Flow
    "quarterlyOperatingCashFlow", "quarterlyCapitalExpenditure", "quarterlyFreeCashFlow",
    "quarterlyInvestingCashFlow", "quarterlyFinancingCashFlow",
    "quarterlyIssuanceOfDebt", "quarterlyRepurchaseOfCapitalStock", "quarterlyCashDividendsPaid",
    // Balance Sheet
    "quarterlyTotalAssets", "quarterlyCurrentAssets", "quarterlyCashAndCashEquivalents",
    "quarterlyTotalLiabilitiesNetMinorityInterest", "quarterlyCurrentLiabilities",
    "quarterlyLongTermDebt", "quarterlyTotalDebt",
    "quarterlyStockholdersEquity", "quarterlyRetainedEarnings",
  ],
  trailing: [
    "trailingMarketCap", "trailingPeRatio", "trailingForwardPeRatio",
    "trailingPegRatio", "trailingEnterpriseValue", "trailingOperatingCashFlow",
    "trailingFreeCashFlow", "trailingDividendYield",
  ],
};

type TradingPeriod = { start?: number; end?: number; gmtoffset?: number; timezone?: string };

type ChartResult = {
  meta?: {
    currency?: string; longName?: string; shortName?: string;
    regularMarketPrice?: number; chartPreviousClose?: number;
    fiftyTwoWeekHigh?: number; fiftyTwoWeekLow?: number;
    exchangeName?: string; fullExchangeName?: string;
    regularMarketTime?: number;
    currentTradingPeriod?: { pre?: TradingPeriod; regular?: TradingPeriod; post?: TradingPeriod };
    preMarketPrice?: number; postMarketPrice?: number;
  };
  timestamp?: number[];
  indicators?: { quote?: Array<{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }> };
};

type ChartResponse = { chart?: { result?: ChartResult[]; error?: { description?: string } | null } };
type TimeseriesResponse = { timeseries?: { result?: Array<Record<string, any>>; error?: { description?: string } | null } };
type QuoteSummaryResponse = {
  quoteSummary?: {
    result?: Array<{
      assetProfile?: {
        longBusinessSummary?: string;
        sector?: string;
        industry?: string;
      };
      summaryDetail?: {
        bid?: { raw?: number } | number | null;
        ask?: { raw?: number } | number | null;
        bidSize?: { raw?: number } | number | null;
        askSize?: { raw?: number } | number | null;
        previousClose?: { raw?: number } | number | null;
        open?: { raw?: number } | number | null;
        dayHigh?: { raw?: number } | number | null;
        dayLow?: { raw?: number } | number | null;
      };
    }>;
    error?: { description?: string } | null;
  };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sub-unit currency normalization.
 * Yahoo Finance returns prices for some exchanges in sub-units (e.g. pence instead of pounds).
 * IBKR and most brokers report in the main currency unit, so we normalize here to avoid mismatches.
 */
const SUB_UNIT_CURRENCIES: Record<string, { main: string; divisor: number }> = {
  GBp: { main: "GBP", divisor: 100 },
  GBX: { main: "GBP", divisor: 100 },
  ILA: { main: "ILS", divisor: 100 },
  ZAc: { main: "ZAR", divisor: 100 },
};

function normalizeSubUnitCurrency(currency: string): { currency: string; divisor: number } {
  const sub = SUB_UNIT_CURRENCIES[currency];
  if (sub) return { currency: sub.main, divisor: sub.divisor };
  return { currency, divisor: 1 };
}

function financeRawNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") {
    const raw = (value as { raw?: unknown }).raw;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  }
  return undefined;
}

function normalizePositiveMarketValue(value: number | undefined, divisor = 1): number | undefined {
  if (value == null || !Number.isFinite(value) || value <= 0) return undefined;
  return value / divisor;
}

function normalizeMarketValue(value: number | undefined, divisor = 1): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  return value / divisor;
}

function deriveMarketState(meta: NonNullable<ChartResult["meta"]>): MarketState {
  const ctp = meta.currentTradingPeriod;
  if (!ctp) return "CLOSED";
  const now = Math.floor(Date.now() / 1000);
  if (ctp.regular?.start && ctp.regular?.end && now >= ctp.regular.start && now < ctp.regular.end) return "REGULAR";
  if (ctp.pre?.start && ctp.pre?.end && now >= ctp.pre.start && now < ctp.pre.end) return "PRE";
  if (ctp.post?.start && ctp.post?.end && now >= ctp.post.start && now < ctp.post.end) return "POST";
  return "CLOSED";
}

function computeExtendedHoursChange(extPrice: number | undefined, regularPrice: number | undefined): { change?: number; changePct?: number } {
  if (extPrice == null || regularPrice == null || regularPrice === 0) return {};
  const change = extPrice - regularPrice;
  return { change, changePct: (change / regularPrice) * 100 };
}

type ExtendedHoursData = {
  preMarketPrice?: number;
  preMarketChange?: number;
  preMarketChangePercent?: number;
  postMarketPrice?: number;
  postMarketChange?: number;
  postMarketChangePercent?: number;
};

/**
 * Extract extended hours prices from a 1d intraday chart with includePrePost=true.
 * Pre/post market data points sit outside the regular trading period timestamps.
 */
function extractExtendedHoursPrices(
  meta: NonNullable<ChartResult["meta"]>,
  timestamps: number[],
  closes: (number | null)[],
  marketState: MarketState,
): ExtendedHoursData {
  const ctp = meta.currentTradingPeriod;
  if (!ctp || !timestamps.length) return {};

  const regStart = ctp.regular?.start ?? 0;
  const regEnd = ctp.regular?.end ?? Infinity;
  const regularClose = meta.regularMarketPrice ?? meta.chartPreviousClose;

  if (marketState === "PRE") {
    // Find the last pre-market data point (before regular open)
    for (let i = timestamps.length - 1; i >= 0; i--) {
      if (timestamps[i]! < regStart && closes[i] != null) {
        const ext = computeExtendedHoursChange(closes[i]!, regularClose);
        return { preMarketPrice: closes[i]!, preMarketChange: ext.change, preMarketChangePercent: ext.changePct };
      }
    }
  } else if (marketState === "POST") {
    // Find the last post-market data point (after regular close)
    for (let i = timestamps.length - 1; i >= 0; i--) {
      if (timestamps[i]! >= regEnd && closes[i] != null) {
        const ext = computeExtendedHoursChange(closes[i]!, regularClose);
        return { postMarketPrice: closes[i]!, postMarketChange: ext.change, postMarketChangePercent: ext.changePct };
      }
    }
  }
  return {};
}

// Cache TTLs
const QUOTE_TTL = 5 * 60_000; // 5 min
const FUNDAMENTALS_TTL = 60 * 60_000; // 1 hour
const HISTORY_TTL = 24 * 60 * 60_000; // 24 hours
const NEWS_TTL = 15 * 60_000; // 15 min
const OPTIONS_TTL = 5 * 60_000; // 5 min
const INTRADAY_HISTORY_TTL = 5 * 60_000; // 5 min for intraday ranges

// Maps TimeRange → Yahoo API { range, interval } for optimal granularity
const RANGE_PARAMS: Record<TimeRange, { range: string; interval: string; ttl: number }> = {
  "1W": { range: "5d", interval: "5m", ttl: INTRADAY_HISTORY_TTL },
  "1M": { range: "1mo", interval: "15m", ttl: INTRADAY_HISTORY_TTL },
  "3M": { range: "3mo", interval: "1h", ttl: QUOTE_TTL },
  "6M": { range: "6mo", interval: "1d", ttl: HISTORY_TTL },
  "1Y": { range: "1y", interval: "1d", ttl: HISTORY_TTL },
  "5Y": { range: "5y", interval: "1d", ttl: HISTORY_TTL },
  "ALL": { range: "max", interval: "1wk", ttl: HISTORY_TTL },
};

export class YahooFinanceClient implements DataProvider {
  readonly id = "yahoo";
  readonly name = "Yahoo Finance";

  private crumb: string | null = null;
  private cookie: string | null = null;
  private crumbPromise: Promise<void> | null = null;
  private readonly secClient = new SecEdgarClient();

  constructor() {}

  private defaultHeaders() {
    return {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "application/json,text/plain,*/*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://finance.yahoo.com/",
    };
  }

  /** Fetch a crumb + cookie pair needed by some Yahoo endpoints (e.g. options). */
  private async ensureCrumb(): Promise<void> {
    if (this.crumb && this.cookie) return;
    if (this.crumbPromise) return this.crumbPromise;
    this.crumbPromise = (async () => {
      try {
        // Step 1: get a cookie from Yahoo
        const cookieResp = await fetch("https://fc.yahoo.com/", {
          headers: this.defaultHeaders(),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          redirect: "manual",
        });
        const setCookie = cookieResp.headers.get("set-cookie");
        if (!setCookie) throw new Error("Failed to get Yahoo cookie");
        // Extract just the cookie key=value pairs
        this.cookie = setCookie.split(",").map((c) => c.split(";")[0]!.trim()).join("; ");

        // Step 2: get the crumb value
        const crumbResp = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
          headers: { ...this.defaultHeaders(), Cookie: this.cookie },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!crumbResp.ok) throw new Error(`Failed to get crumb: ${crumbResp.status}`);
        this.crumb = await crumbResp.text();
        if (!this.crumb) throw new Error("Empty crumb response");
      } catch (err) {
        this.crumb = null;
        this.cookie = null;
        throw err;
      } finally {
        this.crumbPromise = null;
      }
    })();
    return this.crumbPromise;
  }

  /** Fetch JSON from a Yahoo endpoint that requires crumb authentication. */
  private async fetchJsonWithCrumb<T>(label: string, url: string): Promise<T> {
    return this.withRetry(label, async () => {
      await this.ensureCrumb();
      const separator = url.includes("?") ? "&" : "?";
      const fullUrl = `${url}${separator}crumb=${encodeURIComponent(this.crumb!)}`;
      const resp = await fetch(fullUrl, {
        headers: { ...this.defaultHeaders(), Cookie: this.cookie! },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (resp.status === 401) {
        // Crumb expired — clear and let retry logic re-fetch
        this.crumb = null;
        this.cookie = null;
        throw new Error(`[401] Invalid Crumb`);
      }
      if (!resp.ok) throw new Error(`[${resp.status}] ${(await resp.text()).slice(0, 200)}`);
      return resp.json() as Promise<T>;
    });
  }

  private async withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let lastError: any;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        if (!RETRYABLE_ERROR.test(error?.message || String(error)) || attempt === MAX_RETRIES) throw error;
        const delay = Math.min(30_000, RETRY_BASE_MS * Math.pow(2, attempt)) + Math.round(Math.random() * 300);
        await sleep(delay);
      }
    }
    throw lastError;
  }

  private async fetchJson<T>(label: string, url: string): Promise<T> {
    return this.withRetry(label, async () => {
      const resp = await fetch(url, {
        headers: this.defaultHeaders(),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!resp.ok) throw new Error(`[${resp.status}] ${(await resp.text()).slice(0, 200)}`);
      return resp.json() as Promise<T>;
    });
  }

  /** All known Yahoo Finance suffixes — used to detect tickers that already include one */
  private static KNOWN_SUFFIXES = new Set(
    Object.values(EXCHANGE_SUFFIX_MAP).filter(Boolean)
      .concat(GENERIC_SUFFIX_FALLBACKS.filter(Boolean)),
  );

  /** Check if the ticker already ends with a known Yahoo suffix (e.g. "6324.T") */
  private tickerHasSuffix(ticker: string): boolean {
    const dot = ticker.indexOf(".");
    if (dot < 0) return false;
    return YahooFinanceClient.KNOWN_SUFFIXES.has(ticker.slice(dot));
  }

  private isHKExchange(exchange: string): boolean {
    return exchange === "HKEX" || exchange === "SEHK" || exchange === "HKG";
  }

  private normalizeTicker(ticker: string, exchange: string): string {
    // Hong Kong stocks need 4-digit codes with leading zeros
    if (this.isHKExchange(exchange) && /^\d+$/.test(ticker)) {
      return ticker.padStart(4, "0");
    }
    // Yahoo Finance uses hyphens where IBKR uses spaces (e.g. "HEXA B" → "HEXA-B")
    return ticker.replace(/ /g, "-");
  }

  private getSymbol(ticker: string, exchange: string): string {
    // If ticker already contains a Yahoo suffix, use it as-is
    if (this.tickerHasSuffix(ticker)) return ticker;
    const suffix = EXCHANGE_SUFFIX_MAP[exchange] ?? "";
    return `${this.normalizeTicker(ticker, exchange)}${suffix}`;
  }

  private getSymbolsToTry(ticker: string, exchange: string): string[] {
    // If ticker already contains a Yahoo suffix, use it as-is
    if (this.tickerHasSuffix(ticker)) return [ticker];

    const normalized = this.normalizeTicker(ticker, exchange);

    // For tickers with dots that aren't Yahoo suffixes (e.g. "BTC.USD"),
    // also try replacing the dot with a hyphen (Yahoo uses "BTC-USD" for crypto pairs)
    const dotVariant = normalized.includes(".") ? normalized.replace(/\./g, "-") : null;

    const ex = (exchange || "").toUpperCase();
    if (!ex) {
      const symbols = new Set<string>();
      // For numeric tickers with no exchange, also try HK-padded variant
      const candidates = [normalized];
      if (dotVariant) candidates.unshift(dotVariant); // Try hyphen variant first
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
      const results = fallbacks.map((s) => `${normalized}${s}`);
      if (dotVariant) results.unshift(...fallbacks.map((s) => `${dotVariant}${s}`));
      return results;
    }
    const primary = this.getSymbol(ticker, exchange);
    if (dotVariant) {
      const suffix = EXCHANGE_SUFFIX_MAP[exchange] ?? "";
      return [`${dotVariant}${suffix}`, primary];
    }
    return [primary];
  }

  private async fetchChart(symbol: string, range: string, interval = "1d", includePrePost = false) {
    const params = new URLSearchParams({ interval, range, includePrePost: String(includePrePost), events: "div,split" });
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`;
    const data = await this.fetchJson<ChartResponse>(`chart ${symbol}`, url);
    const result = data.chart?.result?.[0];
    if (!result?.timestamp?.length) throw new Error(data.chart?.error?.description || `No chart data for ${symbol}`);
    const quote = result.indicators?.quote?.[0];
    if (!quote) throw new Error(`Missing indicators for ${symbol}`);

    const history: PricePoint[] = [];
    for (let i = 0; i < result.timestamp.length; i++) {
      const close = quote.close?.[i];
      if (close == null || Number.isNaN(close)) continue;
      history.push({
        date: new Date((result.timestamp[i]!) * 1000),
        open: quote.open?.[i] ?? undefined,
        high: quote.high?.[i] ?? undefined,
        low: quote.low?.[i] ?? undefined,
        close,
        volume: quote.volume?.[i] ?? undefined,
      });
    }
    return { meta: result.meta || {}, history };
  }

  /** Fetch extended hours data using 1d intraday chart with pre/post market included */
  private async fetchExtendedHoursData(symbol: string, regularPrice: number, meta: NonNullable<ChartResult["meta"]>): Promise<ExtendedHoursData> {
    const marketState = deriveMarketState(meta);
    if (marketState !== "PRE" && marketState !== "POST") return {};

    try {
      const params = new URLSearchParams({ interval: "5m", range: "1d", includePrePost: "true" });
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`;
      const data = await this.fetchJson<ChartResponse>(`ext-hours ${symbol}`, url);
      const result = data.chart?.result?.[0];
      if (!result?.timestamp?.length) return {};
      const closes = result.indicators?.quote?.[0]?.close || [];
      return extractExtendedHoursPrices(meta, result.timestamp, closes, marketState);
    } catch {
      return {};
    }
  }

  private async fetchTimeseries(symbol: string, types: string[], period1 = "2010-01-01") {
    const p1 = Math.floor(new Date(period1).getTime() / 1000);
    const p2 = Math.floor(Date.now() / 1000);
    const params = new URLSearchParams({ type: types.join(","), period1: String(p1), period2: String(p2) });
    const url = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?${params}`;
    const data = await this.fetchJson<TimeseriesResponse>(`timeseries ${symbol}`, url);
    return data.timeseries?.result || [];
  }

  private async fetchAssetProfile(symbol: string): Promise<CompanyProfile | undefined> {
    const params = new URLSearchParams({ modules: "assetProfile" });
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?${params}`;
    const data = await this.fetchJsonWithCrumb<QuoteSummaryResponse>(`asset profile ${symbol}`, url);
    const profile = data.quoteSummary?.result?.[0]?.assetProfile;
    if (!profile) return undefined;

    const normalized: CompanyProfile = {
      description: profile.longBusinessSummary?.trim() || undefined,
      sector: profile.sector?.trim() || undefined,
      industry: profile.industry?.trim() || undefined,
    };

    return normalized.description || normalized.sector || normalized.industry ? normalized : undefined;
  }

  private async fetchQuoteSupplement(
    symbol: string,
    currencyDivisor = 1,
  ): Promise<Pick<Quote, "bid" | "ask" | "bidSize" | "askSize" | "previousClose" | "open" | "high" | "low">> {
    try {
      const params = new URLSearchParams({ modules: "summaryDetail" });
      const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?${params}`;
      const data = await this.fetchJsonWithCrumb<QuoteSummaryResponse>(`quote supplement ${symbol}`, url);
      const summaryDetail = data.quoteSummary?.result?.[0]?.summaryDetail;
      if (!summaryDetail) return {};

      const bid = normalizePositiveMarketValue(financeRawNumber(summaryDetail.bid), currencyDivisor);
      const ask = normalizePositiveMarketValue(financeRawNumber(summaryDetail.ask), currencyDivisor);
      const bidSize = financeRawNumber(summaryDetail.bidSize);
      const askSize = financeRawNumber(summaryDetail.askSize);
      const previousClose = normalizeMarketValue(financeRawNumber(summaryDetail.previousClose), currencyDivisor);
      const open = normalizeMarketValue(financeRawNumber(summaryDetail.open), currencyDivisor);
      const high = normalizeMarketValue(financeRawNumber(summaryDetail.dayHigh), currencyDivisor);
      const low = normalizeMarketValue(financeRawNumber(summaryDetail.dayLow), currencyDivisor);

      return {
        bid,
        ask,
        bidSize,
        askSize,
        previousClose,
        open,
        high,
        low,
      };
    } catch {
      return {};
    }
  }

  private parseTimeseries(results: Array<Record<string, any>>) {
    const parsed: Record<string, Array<{ asOfDate: string; periodType?: string; value: number }>> = {};
    for (const result of results) {
      const type = result?.meta?.type?.[0];
      if (!type) continue;
      const key = Object.keys(result).find((k) => k !== "meta" && k !== "timestamp");
      if (!key) continue;
      parsed[type] = (Array.isArray(result[key]) ? result[key] : [])
        .map((p: any) => ({ asOfDate: p?.asOfDate, periodType: p?.periodType, value: p?.reportedValue?.raw }))
        .filter((p: any) => typeof p.asOfDate === "string" && typeof p.value === "number" && Number.isFinite(p.value));
    }
    return parsed;
  }

  private computeReturn(history: PricePoint[], days: number): number | undefined {
    if (history.length < 2) return undefined;
    const latest = history[history.length - 1]!;
    const cutoff = new Date(latest.date.getTime() - days * 86400_000);
    let baseline = history[0]!;
    for (const p of history) {
      if (p.date <= cutoff) baseline = p;
      else break;
    }
    if (!baseline.close) return undefined;
    return (latest.close - baseline.close) / baseline.close;
  }

  /** Fetch full financials for a ticker */
  async getTickerFinancials(ticker: string, exchange = "", _context?: MarketDataRequestContext): Promise<TickerFinancials> {
    const symbolsToTry = this.getSymbolsToTry(ticker, exchange);
    let lastError: any;

    for (const symbol of symbolsToTry) {
      try {
        const result = await this.fetchFullFinancials(symbol);
        return result;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error(`No data for ${ticker}`);
  }

  private async fetchFullFinancials(symbol: string): Promise<TickerFinancials> {
    const [chart, tsRaw, profile] = await Promise.all([
      this.fetchChart(symbol, "5y"),
      this.fetchTimeseries(symbol, [
        ...TIMESERIES_TYPES.annual,
        ...TIMESERIES_TYPES.quarterly,
        ...TIMESERIES_TYPES.trailing,
      ]),
      this.fetchAssetProfile(symbol).catch(() => undefined),
    ]);

    const { meta, history } = chart;
    if (!history.length) throw new Error(`No history for ${symbol}`);

    const metrics = this.parseTimeseries(tsRaw);
    const latest = (type: string) => {
      const pts = metrics[type];
      return pts?.length ? pts[pts.length - 1]!.value : undefined;
    };

    // Normalize sub-unit currencies (e.g. GBp → GBP, dividing prices by 100)
    const rawCurrency = meta.currency || "USD";
    const { currency: normalizedCurrency, divisor: currencyDivisor } = normalizeSubUnitCurrency(rawCurrency);

    if (currencyDivisor !== 1) {
      // Normalize price history points
      for (const point of history) {
        point.close /= currencyDivisor;
        if (point.open != null) point.open /= currencyDivisor;
        if (point.high != null) point.high /= currencyDivisor;
        if (point.low != null) point.low /= currencyDivisor;
      }
      // Normalize meta prices
      if (meta.regularMarketPrice != null) meta.regularMarketPrice /= currencyDivisor;
      if (meta.chartPreviousClose != null) meta.chartPreviousClose /= currencyDivisor;
      if (meta.fiftyTwoWeekHigh != null) meta.fiftyTwoWeekHigh /= currencyDivisor;
      if (meta.fiftyTwoWeekLow != null) meta.fiftyTwoWeekLow /= currencyDivisor;
    }

    const quoteSupplement = await this.fetchQuoteSupplement(symbol, currencyDivisor);

    const currentPrice = meta.regularMarketPrice ?? history[history.length - 1]!.close;
    const prev = history.length > 1 ? history[history.length - 2]!.close : meta.chartPreviousClose;
    const change = prev != null ? currentPrice - prev : 0;
    const changePct = prev ? (change / prev) * 100 : 0;

    const marketState = deriveMarketState(meta);
    const extHours = await this.fetchExtendedHoursData(symbol, currentPrice, meta);

    // Normalize extended hours prices too
    if (currencyDivisor !== 1) {
      if (extHours.preMarketPrice != null) extHours.preMarketPrice /= currencyDivisor;
      if (extHours.preMarketChange != null) extHours.preMarketChange /= currencyDivisor;
      if (extHours.postMarketPrice != null) extHours.postMarketPrice /= currencyDivisor;
      if (extHours.postMarketChange != null) extHours.postMarketChange /= currencyDivisor;
    }

    const quote: Quote = {
      symbol,
      price: currentPrice,
      currency: normalizedCurrency,
      change,
      changePercent: changePct,
      high52w: meta.fiftyTwoWeekHigh,
      low52w: meta.fiftyTwoWeekLow,
      marketCap: latest("trailingMarketCap"),
      name: meta.shortName || meta.longName,
      lastUpdated: Date.now(),
      exchangeName: meta.exchangeName,
      fullExchangeName: meta.fullExchangeName,
      marketState,
      dataSource: "yahoo",
      ...quoteSupplement,
      ...extHours,
    };

    const revenue = latest("annualTotalRevenue");
    const netIncome = latest("annualNetIncome");

    const fundamentals: Fundamentals = {
      trailingPE: latest("trailingPeRatio"),
      forwardPE: latest("trailingForwardPeRatio"),
      pegRatio: latest("trailingPegRatio"),
      enterpriseValue: latest("trailingEnterpriseValue"),
      operatingCashFlow: latest("trailingOperatingCashFlow"),
      freeCashFlow: latest("trailingFreeCashFlow"),
      dividendYield: latest("trailingDividendYield"),
      revenue,
      netIncome,
      eps: latest("annualDilutedEPS"),
      operatingMargin: revenue && latest("annualEBITDA") != null ? latest("annualEBITDA")! / revenue : undefined,
      profitMargin: revenue && netIncome != null ? netIncome / revenue : undefined,
      return1Y: this.computeReturn(history, 365),
      return3Y: this.computeReturn(history, 3 * 365),
      sharesOutstanding: latest("annualDilutedAverageShares"),
    };

    // Build statement arrays
    const buildStatements = (prefix: "annual" | "quarterly"): FinancialStatement[] => {
      const byDate = new Map<string, FinancialStatement>();
      const assign = (type: string, field: keyof FinancialStatement) => {
        for (const pt of metrics[type] || []) {
          const row = byDate.get(pt.asOfDate) || { date: pt.asOfDate };
          (row as any)[field] = pt.value;
          byDate.set(pt.asOfDate, row);
        }
      };
      // Income Statement
      assign(`${prefix}TotalRevenue`, "totalRevenue");
      assign(`${prefix}CostOfRevenue`, "costOfRevenue");
      assign(`${prefix}GrossProfit`, "grossProfit");
      assign(`${prefix}SellingGeneralAndAdministration`, "sellingGeneralAndAdministration");
      assign(`${prefix}ResearchAndDevelopment`, "researchAndDevelopment");
      assign(`${prefix}OperatingExpense`, "operatingExpense");
      assign(`${prefix}OperatingIncome`, "operatingIncome");
      assign(`${prefix}InterestExpense`, "interestExpense");
      assign(`${prefix}TaxProvision`, "taxProvision");
      assign(`${prefix}NetIncome`, "netIncome");
      assign(`${prefix}EBITDA`, "ebitda");
      assign(`${prefix}BasicEPS`, "basicEps");
      assign(`${prefix}DilutedEPS`, "eps");
      assign(`${prefix}DilutedAverageShares`, "dilutedShares");
      // Cash Flow
      assign(`${prefix}OperatingCashFlow`, "operatingCashFlow");
      assign(`${prefix}CapitalExpenditure`, "capitalExpenditure");
      assign(`${prefix}FreeCashFlow`, "freeCashFlow");
      assign(`${prefix}InvestingCashFlow`, "investingCashFlow");
      assign(`${prefix}FinancingCashFlow`, "financingCashFlow");
      assign(`${prefix}IssuanceOfDebt`, "issuanceOfDebt");
      assign(`${prefix}RepurchaseOfCapitalStock`, "repurchaseOfCapitalStock");
      assign(`${prefix}CashDividendsPaid`, "cashDividendsPaid");
      // Balance Sheet
      assign(`${prefix}TotalAssets`, "totalAssets");
      assign(`${prefix}CurrentAssets`, "currentAssets");
      assign(`${prefix}CashAndCashEquivalents`, "cashAndCashEquivalents");
      assign(`${prefix}TotalLiabilitiesNetMinorityInterest`, "totalLiabilities");
      assign(`${prefix}CurrentLiabilities`, "currentLiabilities");
      assign(`${prefix}LongTermDebt`, "longTermDebt");
      assign(`${prefix}TotalDebt`, "totalDebt");
      assign(`${prefix}StockholdersEquity`, "totalEquity");
      assign(`${prefix}RetainedEarnings`, "retainedEarnings");
      return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    };

    return {
      quote,
      fundamentals,
      profile,
      annualStatements: buildStatements("annual"),
      quarterlyStatements: buildStatements("quarterly"),
      priceHistory: history,
    };
  }

  /** Fetch just a quote (lighter weight) */
  async getQuote(ticker: string, exchange = "", _context?: MarketDataRequestContext): Promise<Quote> {
    const symbolsToTry = this.getSymbolsToTry(ticker, exchange);
    let lastError: any;

    for (const symbol of symbolsToTry) {
      try {
        const { meta, history } = await this.fetchChart(symbol, "1mo");

        // Normalize sub-unit currencies
        const rawCurrency = meta.currency || "USD";
        const { currency: normalizedCurrency, divisor: currencyDivisor } = normalizeSubUnitCurrency(rawCurrency);

        if (currencyDivisor !== 1) {
          for (const point of history) {
            point.close /= currencyDivisor;
            if (point.open != null) point.open /= currencyDivisor;
            if (point.high != null) point.high /= currencyDivisor;
            if (point.low != null) point.low /= currencyDivisor;
          }
          if (meta.regularMarketPrice != null) meta.regularMarketPrice /= currencyDivisor;
          if (meta.chartPreviousClose != null) meta.chartPreviousClose /= currencyDivisor;
          if (meta.fiftyTwoWeekHigh != null) meta.fiftyTwoWeekHigh /= currencyDivisor;
          if (meta.fiftyTwoWeekLow != null) meta.fiftyTwoWeekLow /= currencyDivisor;
        }

        const quoteSupplement = await this.fetchQuoteSupplement(symbol, currencyDivisor);
        const latest = history[history.length - 1]!;
        const prev = history.length > 1 ? history[history.length - 2]!.close : meta.chartPreviousClose;
        const price = meta.regularMarketPrice ?? latest.close;
        const change = prev != null ? price - prev : 0;

        const marketState = deriveMarketState(meta);
        const extHours = await this.fetchExtendedHoursData(symbol, price, meta);

        if (currencyDivisor !== 1) {
          if (extHours.preMarketPrice != null) extHours.preMarketPrice /= currencyDivisor;
          if (extHours.preMarketChange != null) extHours.preMarketChange /= currencyDivisor;
          if (extHours.postMarketPrice != null) extHours.postMarketPrice /= currencyDivisor;
          if (extHours.postMarketChange != null) extHours.postMarketChange /= currencyDivisor;
        }

        const quote: Quote = {
          symbol,
          price,
          currency: normalizedCurrency,
          change,
          changePercent: prev ? (change / prev) * 100 : 0,
          high52w: meta.fiftyTwoWeekHigh,
          low52w: meta.fiftyTwoWeekLow,
          name: meta.shortName || meta.longName,
          lastUpdated: Date.now(),
          exchangeName: meta.exchangeName,
          fullExchangeName: meta.fullExchangeName,
          marketState,
          dataSource: "yahoo",
          ...quoteSupplement,
          ...extHours,
        };

        return quote;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error(`No quote for ${ticker}`);
  }

  /** Fetch exchange rate to USD */
  async getExchangeRate(fromCurrency: string): Promise<number> {
    // Normalize sub-unit currencies to their main unit
    const { currency: normalized } = normalizeSubUnitCurrency(fromCurrency);
    fromCurrency = normalized;
    if (fromCurrency === "USD") return 1;

    try {
      const { meta, history } = await this.fetchChart(`${fromCurrency}USD=X`, "1mo");
      const rate = meta.regularMarketPrice || history[history.length - 1]?.close || 1;
      return rate;
    } catch {
      return 1;
    }
  }

  /** Search for a ticker by name/symbol - uses direct fetch (no retry) for speed */
  async search(query: string): Promise<InstrumentSearchResult[]> {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`;
    try {
      const resp = await fetch(url, {
        headers: this.defaultHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return [];
      const data = await resp.json() as any;
      return (data.quotes || []).map((q: any) => ({
        providerId: this.id,
        symbol: q.symbol || "",
        name: q.shortname || q.longname || "",
        exchange: q.exchDisp || q.exchange || "",
        type: q.quoteType || "",
      }));
    } catch {
      return [];
    }
  }

  /** Fetch news for a ticker */
  async getNews(ticker: string, count = 10, exchange = "", _context?: MarketDataRequestContext): Promise<NewsItem[]> {
    // Use the Yahoo symbol for better search results on international tickers
    const symbol = this.getSymbol(ticker, exchange);
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=0&newsCount=${count}`;
    try {
      const resp = await fetch(url, {
        headers: this.defaultHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return [];
      const data = await resp.json() as any;
      const items: NewsItem[] = (data.news || []).map((n: any) => ({
        title: n.title || "",
        url: n.link || "",
        source: n.publisher || "",
        publishedAt: new Date((n.providerPublishTime || 0) * 1000),
        summary: n.summary || undefined,
      }));

      return items;
    } catch {
      return [];
    }
  }

  async getSecFilings(ticker: string, count = 10, _exchange = "", _context?: MarketDataRequestContext): Promise<SecFilingItem[]> {
    return this.secClient.getRecentFilings(ticker, count);
  }

  async getSecFilingContent(filing: SecFilingItem): Promise<string | null> {
    return this.secClient.getFilingContent(filing);
  }

  /** Fetch article summary by scraping og:description from the article page */
  async getArticleSummary(url: string): Promise<string | null> {
    try {
      const resp = await fetch(url, {
        headers: {
          ...this.defaultHeaders(),
          Accept: "text/html",
        },
        signal: AbortSignal.timeout(8000),
        redirect: "follow",
      });
      if (!resp.ok) return null;
      const html = await resp.text();
      // Extract og:description content
      const match = html.match(/og:description"\s+content="([^"]*?)"/);
      if (!match?.[1]) return null;
      // Decode HTML entities
      return match[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&#39;/g, "'");
    } catch {
      return null;
    }
  }

  /** Fetch price history with appropriate granularity for the given time range */
  async getPriceHistory(ticker: string, exchange = "", range: TimeRange, _context?: MarketDataRequestContext): Promise<PricePoint[]> {
    const params = RANGE_PARAMS[range];
    const symbolsToTry = this.getSymbolsToTry(ticker, exchange);
    let lastError: any;

    for (const symbol of symbolsToTry) {
      try {
        const { meta, history } = await this.fetchChart(symbol, params.range, params.interval);

        // Normalize sub-unit currencies in price history
        const { divisor } = normalizeSubUnitCurrency(meta.currency || "USD");
        if (divisor !== 1) {
          for (const point of history) {
            point.close /= divisor;
            if (point.open != null) point.open /= divisor;
            if (point.high != null) point.high /= divisor;
            if (point.low != null) point.low /= divisor;
          }
        }

        return history;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error(`No history for ${ticker}`);
  }

  // ── Options Chain ──────────────────────────────────────────────────

  private mapContract(raw: Record<string, any>): OptionContract {
    return {
      contractSymbol: raw.contractSymbol ?? "",
      strike: raw.strike ?? 0,
      currency: raw.currency ?? "USD",
      lastPrice: raw.lastPrice ?? 0,
      change: raw.change ?? 0,
      percentChange: raw.percentChange ?? 0,
      volume: raw.volume ?? 0,
      openInterest: raw.openInterest ?? 0,
      bid: raw.bid ?? 0,
      ask: raw.ask ?? 0,
      impliedVolatility: raw.impliedVolatility ?? 0,
      inTheMoney: raw.inTheMoney ?? false,
      expiration: raw.expiration ?? 0,
      lastTradeDate: raw.lastTradeDate ?? 0,
    };
  }

  async getOptionsChain(ticker: string, exchange = "", expirationDate?: number, _context?: MarketDataRequestContext): Promise<OptionsChain> {
    const symbolsToTry = this.getSymbolsToTry(ticker, exchange);
    let lastError: any;

    for (const symbol of symbolsToTry) {
      try {
        let url = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}`;
        if (expirationDate != null) url += `?date=${expirationDate}`;

        const data = await this.fetchJsonWithCrumb<{
          optionChain?: {
            result?: Array<{
              underlyingSymbol?: string;
              expirationDates?: number[];
              options?: Array<{
                calls?: Array<Record<string, any>>;
                puts?: Array<Record<string, any>>;
              }>;
            }>;
          };
        }>("options " + symbol, url);

        const result = data.optionChain?.result?.[0];
        if (!result) throw new Error("No options data");

        const opts = result.options?.[0];
        const chain: OptionsChain = {
          underlyingSymbol: result.underlyingSymbol ?? symbol,
          expirationDates: result.expirationDates ?? [],
          calls: (opts?.calls ?? []).map((c) => this.mapContract(c)),
          puts: (opts?.puts ?? []).map((p) => this.mapContract(p)),
        };

        return chain;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error(`No options chain for ${ticker}`);
  }
}
