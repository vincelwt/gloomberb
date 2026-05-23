import type { DataTableColumn } from "../../../../../components";
import type { TickerFinancials } from "../../../../../types/financials";

export type FundamentalMetricKey =
  | "totalRevenue"
  | "grossProfit"
  | "operatingIncome"
  | "netIncome"
  | "operatingCashFlow"
  | "freeCashFlow"
  | "totalAssets"
  | "totalDebt"
  | "totalEquity"
  | "eps";

export type ValuationMetricKey =
  | "trailingPE"
  | "forwardPE"
  | "pegRatio"
  | "priceSales"
  | "evSales"
  | "evEbitda"
  | "priceFcf";

export type GraphKind = "fundamental" | "valuation";
export type GraphMetricKey = FundamentalMetricKey | ValuationMetricKey;
export type FundamentalPeriod = "annual" | "quarterly";
type FundamentalColumnId = "symbol" | "date" | "value" | "growth";
export type FundamentalColumn = DataTableColumn & { id: FundamentalColumnId };

export type FundamentalGraphRow = {
  key: string;
  symbol: string;
  date: string;
  category: string;
  value: number;
  growth: number | null;
  barWidth: number;
};

export type MetricDefinition<Key extends GraphMetricKey = GraphMetricKey> = {
  key: Key;
  label: string;
  format: (value: number) => string;
};

export type SymbolFinancials = {
  symbol: string;
  financials: TickerFinancials | null;
  error: string | null;
};
