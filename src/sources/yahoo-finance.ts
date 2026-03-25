import type { Quote, Fundamentals, FinancialStatement, PricePoint, TickerFinancials } from "../types/financials";
import type { SqliteCache } from "../data/sqlite-cache";

// Exchange suffix mapping for Yahoo Finance ticker symbols
const EXCHANGE_SUFFIX_MAP: Record<string, string> = {
  NASDAQ: "", NYSE: "", AMEX: "",
  TYO: ".T", HKEX: ".HK", SGX: ".SI", IDX: ".JK",
  KRX: ".KS", KOSDAQ: ".KQ",
  TWSE: ".TW", TPE: ".TW",
  SSE: ".SS", SZSE: ".SZ",
  EURONEXT: ".AS", XETRA: ".DE",
  LSE: ".L", ASX: ".AX", OSE: ".OL",
};

const EXCHANGE_FALLBACKS: Record<string, string[]> = {
  KRX: [".KS", ".KQ"],
  TWSE: [".TW", ".TWO"],
  TPE: [".TW", ".TWO"],
  EURONEXT: [".AS", ".PA", ".BR"],
};

const GENERIC_SUFFIX_FALLBACKS = [
  "", ".HK", ".T", ".KS", ".KQ", ".TW", ".TWO", ".SS", ".SZ",
  ".AS", ".PA", ".BR", ".DE", ".L", ".AX", ".SI", ".JK", ".OL", ".NS", ".BO", ".SA",
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

type ChartResult = {
  meta?: {
    currency?: string; longName?: string; shortName?: string;
    regularMarketPrice?: number; chartPreviousClose?: number;
    fiftyTwoWeekHigh?: number; fiftyTwoWeekLow?: number;
  };
  timestamp?: number[];
  indicators?: { quote?: Array<{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }> };
};

type ChartResponse = { chart?: { result?: ChartResult[]; error?: { description?: string } | null } };
type TimeseriesResponse = { timeseries?: { result?: Array<Record<string, any>>; error?: { description?: string } | null } };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Cache TTLs
const QUOTE_TTL = 5 * 60_000; // 5 min
const FUNDAMENTALS_TTL = 60 * 60_000; // 1 hour
const HISTORY_TTL = 24 * 60 * 60_000; // 24 hours

export class YahooFinanceClient {
  constructor(private cache?: SqliteCache) {}

  private defaultHeaders() {
    return {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "application/json,text/plain,*/*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://finance.yahoo.com/",
    };
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

  private getSymbol(ticker: string, exchange: string): string {
    const suffix = EXCHANGE_SUFFIX_MAP[exchange] ?? "";
    const normalized = exchange === "HKEX" && /^\d+$/.test(ticker) ? ticker.padStart(4, "0") : ticker;
    return `${normalized}${suffix}`;
  }

  private getSymbolsToTry(ticker: string, exchange: string): string[] {
    const normalized = exchange === "HKEX" && /^\d+$/.test(ticker) ? ticker.padStart(4, "0") : ticker;
    const ex = (exchange || "").toUpperCase();
    if (!ex) {
      const symbols = new Set<string>();
      for (const suffix of GENERIC_SUFFIX_FALLBACKS) symbols.add(`${normalized}${suffix}`);
      return Array.from(symbols);
    }
    const fallbacks = EXCHANGE_FALLBACKS[exchange];
    if (fallbacks) return fallbacks.map((s) => `${normalized}${s}`);
    return [this.getSymbol(ticker, exchange)];
  }

  private async fetchChart(symbol: string, range: string, interval = "1d") {
    const params = new URLSearchParams({ interval, range, includePrePost: "false", events: "div,split" });
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

  private async fetchTimeseries(symbol: string, types: string[], period1 = "2010-01-01") {
    const p1 = Math.floor(new Date(period1).getTime() / 1000);
    const p2 = Math.floor(Date.now() / 1000);
    const params = new URLSearchParams({ type: types.join(","), period1: String(p1), period2: String(p2) });
    const url = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?${params}`;
    const data = await this.fetchJson<TimeseriesResponse>(`timeseries ${symbol}`, url);
    return data.timeseries?.result || [];
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
  async getTickerFinancials(ticker: string, exchange = ""): Promise<TickerFinancials> {
    // Check cache first
    if (this.cache) {
      const cached = this.cache.getCached<TickerFinancials>(ticker, "full");
      if (cached) return cached;
    }

    const symbolsToTry = this.getSymbolsToTry(ticker, exchange);
    let lastError: any;

    for (const symbol of symbolsToTry) {
      try {
        const result = await this.fetchFullFinancials(symbol);
        if (this.cache) {
          this.cache.setCache(ticker, "full", result, FUNDAMENTALS_TTL);
        }
        return result;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error(`No data for ${ticker}`);
  }

  private async fetchFullFinancials(symbol: string): Promise<TickerFinancials> {
    const [chart, tsRaw] = await Promise.all([
      this.fetchChart(symbol, "5y"),
      this.fetchTimeseries(symbol, [
        ...TIMESERIES_TYPES.annual,
        ...TIMESERIES_TYPES.quarterly,
        ...TIMESERIES_TYPES.trailing,
      ]),
    ]);

    const { meta, history } = chart;
    if (!history.length) throw new Error(`No history for ${symbol}`);

    const metrics = this.parseTimeseries(tsRaw);
    const latest = (type: string) => {
      const pts = metrics[type];
      return pts?.length ? pts[pts.length - 1]!.value : undefined;
    };

    const currentPrice = meta.regularMarketPrice ?? history[history.length - 1]!.close;
    const prev = history.length > 1 ? history[history.length - 2]!.close : meta.chartPreviousClose;
    const change = prev != null ? currentPrice - prev : 0;
    const changePct = prev ? (change / prev) * 100 : 0;

    const quote: Quote = {
      symbol,
      price: currentPrice,
      currency: meta.currency || "USD",
      change,
      changePercent: changePct,
      high52w: meta.fiftyTwoWeekHigh,
      low52w: meta.fiftyTwoWeekLow,
      marketCap: latest("trailingMarketCap"),
      name: meta.shortName || meta.longName,
      lastUpdated: Date.now(),
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
      annualStatements: buildStatements("annual"),
      quarterlyStatements: buildStatements("quarterly"),
      priceHistory: history,
    };
  }

  /** Fetch just a quote (lighter weight) */
  async getQuote(ticker: string, exchange = ""): Promise<Quote> {
    if (this.cache) {
      const cached = this.cache.getCached<Quote>(ticker, "quote");
      if (cached) return cached;
    }

    const symbol = this.getSymbol(ticker, exchange);
    const { meta, history } = await this.fetchChart(symbol, "1mo");
    const latest = history[history.length - 1]!;
    const prev = history.length > 1 ? history[history.length - 2]!.close : meta.chartPreviousClose;
    const price = meta.regularMarketPrice ?? latest.close;
    const change = prev != null ? price - prev : 0;

    const quote: Quote = {
      symbol,
      price,
      currency: meta.currency || "USD",
      change,
      changePercent: prev ? (change / prev) * 100 : 0,
      high52w: meta.fiftyTwoWeekHigh,
      low52w: meta.fiftyTwoWeekLow,
      name: meta.shortName || meta.longName,
      lastUpdated: Date.now(),
    };

    if (this.cache) this.cache.setCache(ticker, "quote", quote, QUOTE_TTL);
    return quote;
  }

  /** Fetch exchange rate to USD */
  async getExchangeRate(fromCurrency: string): Promise<number> {
    if (fromCurrency === "USD") return 1;

    if (this.cache) {
      const cached = this.cache.getExchangeRate(`${fromCurrency}/USD`);
      if (cached != null) return cached;
    }

    try {
      const { meta, history } = await this.fetchChart(`${fromCurrency}USD=X`, "1mo");
      const rate = meta.regularMarketPrice || history[history.length - 1]?.close || 1;
      if (this.cache) this.cache.setExchangeRate(`${fromCurrency}/USD`, rate);
      return rate;
    } catch {
      return 1;
    }
  }

  /** Search for a ticker by name/symbol - uses direct fetch (no retry) for speed */
  async search(query: string): Promise<Array<{ symbol: string; name: string; exchange: string; type: string }>> {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`;
    try {
      const resp = await fetch(url, {
        headers: this.defaultHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return [];
      const data = await resp.json() as any;
      return (data.quotes || []).map((q: any) => ({
        symbol: q.symbol || "",
        name: q.shortname || q.longname || "",
        exchange: q.exchDisp || q.exchange || "",
        type: q.quoteType || "",
      }));
    } catch {
      return [];
    }
  }
}
