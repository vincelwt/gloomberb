export type MarketState = "PRE" | "REGULAR" | "POST" | "PREPRE" | "POSTPOST" | "CLOSED";

export interface Quote {
  symbol: string;
  providerId?: string;
  price: number;
  currency: string;
  change: number;
  changePercent: number;
  previousClose?: number;
  high52w?: number;
  low52w?: number;
  marketCap?: number;
  volume?: number;
  name?: string;
  lastUpdated: number; // timestamp ms
  exchangeName?: string;
  fullExchangeName?: string;
  marketState?: MarketState;
  preMarketPrice?: number;
  preMarketChange?: number;
  preMarketChangePercent?: number;
  postMarketPrice?: number;
  postMarketChange?: number;
  postMarketChangePercent?: number;
  bid?: number;
  ask?: number;
  bidSize?: number;
  askSize?: number;
  open?: number;
  high?: number;
  low?: number;
  mark?: number;
  /** Where the quote data came from: live broker feed, delayed broker feed, or a fallback like Yahoo. */
  dataSource?: "live" | "delayed" | "yahoo";
}

export interface Fundamentals {
  trailingPE?: number;
  forwardPE?: number;
  pegRatio?: number;
  enterpriseValue?: number;
  operatingCashFlow?: number;
  freeCashFlow?: number;
  dividendYield?: number;
  revenue?: number;
  netIncome?: number;
  eps?: number;
  operatingMargin?: number;
  profitMargin?: number;
  revenueGrowth?: number;
  return1Y?: number;
  return3Y?: number;
  lastQuarterGrowth?: number;
  sharesOutstanding?: number;
}

export interface CompanyProfile {
  description?: string;
  sector?: string;
  industry?: string;
}

export interface FinancialStatement {
  date: string;
  // Income Statement
  totalRevenue?: number;
  costOfRevenue?: number;
  grossProfit?: number;
  sellingGeneralAndAdministration?: number;
  researchAndDevelopment?: number;
  operatingExpense?: number;
  operatingIncome?: number;
  interestExpense?: number;
  taxProvision?: number;
  netIncome?: number;
  ebitda?: number;
  basicEps?: number;
  eps?: number; // diluted
  dilutedShares?: number;
  // Cash Flow
  operatingCashFlow?: number;
  capitalExpenditure?: number;
  freeCashFlow?: number;
  investingCashFlow?: number;
  financingCashFlow?: number;
  issuanceOfDebt?: number;
  repurchaseOfCapitalStock?: number;
  cashDividendsPaid?: number;
  // Balance Sheet
  totalAssets?: number;
  currentAssets?: number;
  cashAndCashEquivalents?: number;
  totalLiabilities?: number;
  currentLiabilities?: number;
  longTermDebt?: number;
  totalDebt?: number;
  totalEquity?: number;
  retainedEarnings?: number;
}

export interface PricePoint {
  date: Date;
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume?: number;
}

export interface TickerFinancials {
  quote?: Quote;
  fundamentals?: Fundamentals;
  profile?: CompanyProfile;
  annualStatements: FinancialStatement[];
  quarterlyStatements: FinancialStatement[];
  priceHistory: PricePoint[];
}

export interface OptionContract {
  contractSymbol: string;
  strike: number;
  currency: string;
  lastPrice: number;
  change: number;
  percentChange: number;
  volume: number;
  openInterest: number;
  bid: number;
  ask: number;
  impliedVolatility: number;
  inTheMoney: boolean;
  expiration: number;
  lastTradeDate: number;
}

export interface OptionsChain {
  underlyingSymbol: string;
  expirationDates: number[];
  calls: OptionContract[];
  puts: OptionContract[];
}
