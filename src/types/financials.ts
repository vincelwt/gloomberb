export interface Quote {
  symbol: string;
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
  annualStatements: FinancialStatement[];
  quarterlyStatements: FinancialStatement[];
  priceHistory: PricePoint[];
}
