import type { FinancialStatement, TickerFinancials } from "../../../types/financials";
import {
  formatGrowthShort,
  formatNumber,
  formatWithDivisor,
  padTo,
  pickUnit,
} from "../../../utils/format";

type FinancialMetricFormat = "compact" | "eps" | "percent";

export type MetricDef = {
  label: string;
  key?: keyof FinancialStatement;
  id?: string;
  compute?: (statement: FinancialStatement) => number | undefined;
  format: FinancialMetricFormat;
  showGrowth?: boolean;
};

export type FinancialRowDef = MetricDef | FinancialGroupDef;

type FinancialGroupDef = {
  kind: "group";
  id: string;
  label: string;
  summaryKey?: keyof FinancialStatement;
  format?: FinancialMetricFormat;
  defaultExpanded?: boolean;
  children: FinancialRowDef[];
};

export type FinancialSubTab = {
  name: string;
  key: string;
  rows: FinancialRowDef[];
};

export type FinancialPeriod = "annual" | "quarterly";


export type FinancialTableRow =
  | {
    kind: "metric";
    id: string;
    key?: keyof FinancialStatement;
    compute?: (statement: FinancialStatement) => number | undefined;
    unitLabel: string;
    divisor: number;
    format: FinancialMetricFormat;
    showGrowth: boolean;
    depth: number;
  }
  | {
    kind: "group";
    id: string;
    label: string;
    unitLabel: string;
    summaryKey?: keyof FinancialStatement;
    divisor: number;
    format: FinancialMetricFormat;
    depth: number;
    expanded: boolean;
    toggleable: boolean;
  };

function financialRatio(
  numerator: number | undefined,
  denominator: number | undefined,
): number | undefined {
  if (numerator == null || denominator == null || denominator === 0) return undefined;
  return numerator / denominator;
}

export function statementMetricValue(
  def: Pick<MetricDef, "key" | "compute">,
  statement: FinancialStatement,
): number | undefined {
  if (def.key) return statement[def.key] as number | undefined;
  return def.compute?.(statement);
}

export const FINANCIAL_SUB_TABS: FinancialSubTab[] = [
  {
    name: "Income",
    key: "income",
    rows: [
      {
        kind: "group",
        id: "income:revenue",
        label: "Revenue",
        summaryKey: "totalRevenue",
        defaultExpanded: true,
        children: [
          { label: "Operating Revenue", key: "operatingRevenue", format: "compact" },
          { label: "Cost of Revenue", key: "costOfRevenue", format: "compact" },
          { label: "Gross Profit", key: "grossProfit", format: "compact" },
        ],
      },
      {
        kind: "group",
        id: "income:operating",
        label: "Operating Inc",
        summaryKey: "operatingIncome",
        defaultExpanded: true,
        children: [
          { label: "R&D", key: "researchAndDevelopment", format: "compact" },
          { label: "SG&A", key: "sellingGeneralAndAdministration", format: "compact" },
          { label: "D&A", key: "depreciationAndAmortizationInIncomeStatement", format: "compact" },
          { label: "Operating Exp", key: "operatingExpense", format: "compact" },
          { label: "Total Expenses", key: "totalExpenses", format: "compact" },
          { label: "EBITDA", key: "ebitda", format: "compact" },
        ],
      },
      {
        kind: "group",
        id: "income:net",
        label: "Net Income",
        summaryKey: "netIncome",
        defaultExpanded: true,
        children: [
          { label: "Other Income/Exp", key: "otherIncomeExpense", format: "compact" },
          { label: "Other Non-Op", key: "otherNonOperatingIncomeExpenses", format: "compact" },
          { label: "Interest Exp", key: "interestExpense", format: "compact" },
          { label: "Pretax Income", key: "pretaxIncome", format: "compact" },
          { label: "Tax Provision", key: "taxProvision", format: "compact" },
          { label: "Income Common", key: "netIncomeCommonStockholders", format: "compact" },
          { label: "Continuing Ops", key: "netIncomeContinuousOperations", format: "compact" },
          { label: "Normalized Inc", key: "normalizedIncome", format: "compact" },
        ],
      },
      {
        kind: "group",
        id: "income:margins",
        label: "Margins",
        defaultExpanded: true,
        children: [
          {
            label: "Gross Margin",
            id: "gross-margin",
            compute: (statement) => financialRatio(statement.grossProfit, statement.totalRevenue),
            format: "percent",
          },
          {
            label: "Operating Margin",
            id: "operating-margin",
            compute: (statement) => financialRatio(statement.operatingIncome, statement.totalRevenue),
            format: "percent",
          },
          {
            label: "Net Margin",
            id: "net-margin",
            compute: (statement) => financialRatio(statement.netIncome, statement.totalRevenue),
            format: "percent",
          },
          {
            label: "R&D / Revenue",
            id: "rd-revenue",
            compute: (statement) => financialRatio(statement.researchAndDevelopment, statement.totalRevenue),
            format: "percent",
          },
          {
            label: "SG&A / Revenue",
            id: "sga-revenue",
            compute: (statement) => financialRatio(statement.sellingGeneralAndAdministration, statement.totalRevenue),
            format: "percent",
          },
        ],
      },
      {
        kind: "group",
        id: "income:per-share",
        label: "Per Share",
        summaryKey: "eps",
        format: "eps",
        children: [
          { label: "Basic EPS", key: "basicEps", format: "eps" },
          { label: "Diluted EPS", key: "eps", format: "eps" },
          { label: "Basic Shares", key: "basicShares", format: "compact" },
          { label: "Shares Out", key: "dilutedShares", format: "compact" },
        ],
      },
    ],
  },
  {
    name: "Cash Flow",
    key: "cashflow",
    rows: [
      {
        kind: "group",
        id: "cashflow:free-cash-flow",
        label: "Free Cash Flow",
        summaryKey: "freeCashFlow",
        defaultExpanded: true,
        children: [
          { label: "Operating CF", key: "operatingCashFlow", format: "compact" },
          { label: "CapEx", key: "capitalExpenditure", format: "compact" },
        ],
      },
      {
        kind: "group",
        id: "cashflow:operating",
        label: "Operating",
        summaryKey: "operatingCashFlow",
        defaultExpanded: true,
        children: [
          { label: "Net Income", key: "netIncome", format: "compact" },
          { label: "D&A", key: "depreciationAndAmortization", format: "compact" },
          { label: "Depreciation", key: "depreciation", format: "compact" },
          { label: "D&A Depletion", key: "depreciationAmortizationDepletion", format: "compact" },
          {
            label: "Deferred Tax",
            id: "cashflow:deferred-tax",
            compute: (statement) => statement.deferredIncomeTax ?? statement.deferredTax,
            format: "compact",
          },
          { label: "Stock-Based Comp", key: "stockBasedCompensation", format: "compact" },
          { label: "Other Noncash", key: "otherNonCashItems", format: "compact" },
          {
            kind: "group",
            id: "cashflow:working-capital",
            label: "Working Capital",
            summaryKey: "changeInWorkingCapital",
            children: [
              { label: "Receivables", key: "changeInReceivables", format: "compact" },
              { label: "Inventory", key: "changeInInventory", format: "compact" },
              { label: "Payables", key: "changeInPayable", format: "compact" },
              { label: "Acct Payable", key: "changeInAccountPayable", format: "compact" },
              { label: "Other Working Cap", key: "changeInOtherWorkingCapital", format: "compact" },
            ],
          },
          { label: "Continuing Op CF", key: "cashFlowFromContinuingOperatingActivities", format: "compact" },
          { label: "Interest Paid", key: "interestPaidSupplementalData", format: "compact" },
          { label: "Tax Paid", key: "incomeTaxPaidSupplementalData", format: "compact" },
        ],
      },
      {
        kind: "group",
        id: "cashflow:investing",
        label: "Investing",
        summaryKey: "investingCashFlow",
        defaultExpanded: true,
        children: [
          { label: "Purchase PPE", key: "purchaseOfPPE", format: "compact" },
          { label: "Sale PPE", key: "saleOfPPE", format: "compact" },
          { label: "Net PPE", key: "netPPEPurchaseAndSale", format: "compact" },
          { label: "Acquisitions", key: "purchaseOfBusiness", format: "compact" },
          { label: "Business Sales", key: "saleOfBusiness", format: "compact" },
          { label: "Net Business", key: "netBusinessPurchaseAndSale", format: "compact" },
          { label: "Buy Investments", key: "purchaseOfInvestment", format: "compact" },
          { label: "Sell Investments", key: "saleOfInvestment", format: "compact" },
          { label: "Net Investments", key: "netInvestmentPurchaseAndSale", format: "compact" },
          { label: "Other Investing", key: "netOtherInvestingChanges", format: "compact" },
          { label: "Continuing Inv CF", key: "cashFlowFromContinuingInvestingActivities", format: "compact" },
        ],
      },
      {
        kind: "group",
        id: "cashflow:financing",
        label: "Financing",
        summaryKey: "financingCashFlow",
        defaultExpanded: true,
        children: [
          { label: "Debt Issuance", key: "issuanceOfDebt", format: "compact" },
          { label: "Debt Repayment", key: "repaymentOfDebt", format: "compact" },
          { label: "Net Debt", key: "netIssuancePaymentsOfDebt", format: "compact" },
          { label: "LT Debt Issuance", key: "longTermDebtIssuance", format: "compact" },
          { label: "LT Debt Payments", key: "longTermDebtPayments", format: "compact" },
          { label: "Net LT Debt", key: "netLongTermDebtIssuance", format: "compact" },
          { label: "ST Debt Issuance", key: "shortTermDebtIssuance", format: "compact" },
          { label: "ST Debt Payments", key: "shortTermDebtPayments", format: "compact" },
          { label: "Net ST Debt", key: "netShortTermDebtIssuance", format: "compact" },
          { label: "Buybacks", key: "repurchaseOfCapitalStock", format: "compact" },
          { label: "Stock Issuance", key: "commonStockIssuance", format: "compact" },
          { label: "Stock Payments", key: "commonStockPayments", format: "compact" },
          { label: "Net Stock", key: "netCommonStockIssuance", format: "compact" },
          { label: "Dividends Paid", key: "cashDividendsPaid", format: "compact" },
          { label: "Common Dividends", key: "commonStockDividendPaid", format: "compact" },
          { label: "Other Financing", key: "netOtherFinancingCharges", format: "compact" },
          { label: "Continuing Fin CF", key: "cashFlowFromContinuingFinancingActivities", format: "compact" },
        ],
      },
      {
        kind: "group",
        id: "cashflow:cash-position",
        label: "Cash Position",
        summaryKey: "endCashPosition",
        defaultExpanded: true,
        children: [
          { label: "Beginning Cash", key: "beginningCashPosition", format: "compact" },
          { label: "Change in Cash", key: "changesInCash", format: "compact" },
          { label: "FX Effect", key: "effectOfExchangeRateChanges", format: "compact" },
        ],
      },
    ],
  },
  {
    name: "Balance Sheet",
    key: "balance",
    rows: [
      {
        kind: "group",
        id: "balance:assets",
        label: "Total Assets",
        summaryKey: "totalAssets",
        defaultExpanded: true,
        children: [
          {
            kind: "group",
            id: "balance:current-assets",
            label: "Current Assets",
            summaryKey: "currentAssets",
            defaultExpanded: true,
            children: [
              { label: "Cash & Equiv", key: "cashAndCashEquivalents", format: "compact" },
              { label: "Cash + ST Inv", key: "cashCashEquivalentsAndShortTermInvestments", format: "compact" },
              { label: "ST Investments", key: "otherShortTermInvestments", format: "compact" },
              { label: "Receivables", key: "receivables", format: "compact" },
              { label: "Accounts Rec", key: "accountsReceivable", format: "compact" },
              { label: "Inventory", key: "inventory", format: "compact" },
              { label: "Prepaids", key: "prepaidAssets", format: "compact" },
              { label: "Other Current", key: "otherCurrentAssets", format: "compact" },
            ],
          },
          {
            kind: "group",
            id: "balance:non-current-assets",
            label: "Non-Current Assets",
            summaryKey: "totalNonCurrentAssets",
            children: [
              { label: "Net PPE", key: "netPPE", format: "compact" },
              { label: "Gross PPE", key: "grossPPE", format: "compact" },
              { label: "Accum Deprec", key: "accumulatedDepreciation", format: "compact" },
              { label: "Goodwill + Intang", key: "goodwillAndOtherIntangibleAssets", format: "compact" },
              { label: "Goodwill", key: "goodwill", format: "compact" },
              { label: "Other Intang", key: "otherIntangibleAssets", format: "compact" },
              { label: "Investments", key: "investmentsAndAdvances", format: "compact" },
              { label: "LT Investments", key: "longTermEquityInvestment", format: "compact" },
              { label: "Other Non-Current", key: "otherNonCurrentAssets", format: "compact" },
            ],
          },
        ],
      },
      {
        kind: "group",
        id: "balance:liabilities",
        label: "Total Liab",
        summaryKey: "totalLiabilities",
        defaultExpanded: true,
        children: [
          {
            kind: "group",
            id: "balance:current-liabilities",
            label: "Current Liab",
            summaryKey: "currentLiabilities",
            defaultExpanded: true,
            children: [
              { label: "Accounts Pay", key: "accountsPayable", format: "compact" },
              { label: "Payables", key: "payables", format: "compact" },
              { label: "Payables + Accr", key: "payablesAndAccruedExpenses", format: "compact" },
              { label: "Accrued Exp", key: "currentAccruedExpenses", format: "compact" },
              { label: "Deferred Rev", key: "currentDeferredRevenue", format: "compact" },
              { label: "Deferred Liab", key: "currentDeferredLiabilities", format: "compact" },
              { label: "Current Debt", key: "currentDebt", format: "compact" },
              { label: "Curr Debt+Lease", key: "currentDebtAndCapitalLeaseObligation", format: "compact" },
              { label: "Other Current", key: "otherCurrentLiabilities", format: "compact" },
            ],
          },
          {
            kind: "group",
            id: "balance:non-current-liabilities",
            label: "Non-Current Liab",
            summaryKey: "totalNonCurrentLiabilities",
            children: [
              { label: "Long-Term Debt", key: "longTermDebt", format: "compact" },
              { label: "LT Debt+Lease", key: "longTermDebtAndCapitalLeaseObligation", format: "compact" },
              { label: "LT Lease", key: "longTermCapitalLeaseObligation", format: "compact" },
              { label: "Deferred Liab", key: "nonCurrentDeferredLiabilities", format: "compact" },
              { label: "Deferred Tax Liab", key: "nonCurrentDeferredTaxesLiabilities", format: "compact" },
              { label: "Other Non-Current", key: "otherNonCurrentLiabilities", format: "compact" },
            ],
          },
          { label: "Total Debt", key: "totalDebt", format: "compact" },
          { label: "Lease Obligations", key: "capitalLeaseObligations", format: "compact" },
          { label: "Total Capitalization", key: "totalCapitalization", format: "compact" },
        ],
      },
      {
        kind: "group",
        id: "balance:equity-capital",
        label: "Equity",
        summaryKey: "totalEquity",
        defaultExpanded: true,
        children: [
          { label: "Retained Earn", key: "retainedEarnings", format: "compact" },
          { label: "Common Equity", key: "commonStockEquity", format: "compact" },
          { label: "Common Stock", key: "commonStock", format: "compact" },
          { label: "Capital Stock", key: "capitalStock", format: "compact" },
          { label: "APIC", key: "additionalPaidInCapital", format: "compact" },
          { label: "Treasury Stock", key: "treasuryStock", format: "compact" },
          { label: "AOCI", key: "gainsLossesNotAffectingRetainedEarnings", format: "compact" },
          { label: "Other Equity Adj", key: "otherEquityAdjustments", format: "compact" },
          { label: "Equity + Minority", key: "totalEquityGrossMinorityInterest", format: "compact" },
          { label: "Working Capital", key: "workingCapital", format: "compact" },
          { label: "Invested Capital", key: "investedCapital", format: "compact" },
          { label: "Net Tangible", key: "netTangibleAssets", format: "compact" },
          { label: "Tangible Book", key: "tangibleBookValue", format: "compact" },
          { label: "Shares Issued", key: "shareIssued", format: "compact" },
          { label: "Ordinary Shares", key: "ordinarySharesNumber", format: "compact" },
          { label: "Treasury Shares", key: "treasurySharesNumber", format: "compact" },
        ],
      },
      {
        label: "Liab + Equity",
        id: "balance:liabilities-equity",
        compute: (statement) => {
          if (statement.totalAssets != null) return statement.totalAssets;
          if (statement.totalLiabilities == null || statement.totalEquityGrossMinorityInterest == null) return undefined;
          return statement.totalLiabilities + statement.totalEquityGrossMinorityInterest;
        },
        format: "compact",
      },
    ],
  },
];

export const FINANCIAL_SUB_TABS_WIDTH = FINANCIAL_SUB_TABS.reduce(
  (sum, tab) => sum + tab.name.length + 2,
  0,
);
export const FINANCIAL_PERIOD_TABS_WIDTH = "Annual".length + "Quarterly".length + 4;

const FLOW_KEYS = new Set<string>([
  "totalRevenue",
  "costOfRevenue",
  "grossProfit",
  "sellingGeneralAndAdministration",
  "researchAndDevelopment",
  "operatingExpense",
  "operatingIncome",
  "operatingRevenue",
  "totalExpenses",
  "pretaxIncome",
  "normalizedIncome",
  "netIncomeCommonStockholders",
  "netIncomeContinuousOperations",
  "otherIncomeExpense",
  "otherNonOperatingIncomeExpenses",
  "depreciationAmortizationDepletionIncomeStatement",
  "depreciationAndAmortizationInIncomeStatement",
  "interestExpense",
  "taxProvision",
  "netIncome",
  "ebitda",
  "basicEps",
  "eps",
  "operatingCashFlow",
  "depreciationAndAmortization",
  "depreciationAmortizationDepletion",
  "depreciation",
  "deferredIncomeTax",
  "deferredTax",
  "stockBasedCompensation",
  "otherNonCashItems",
  "changeInWorkingCapital",
  "changeInReceivables",
  "changeInInventory",
  "changeInPayable",
  "changeInAccountPayable",
  "changeInOtherWorkingCapital",
  "capitalExpenditure",
  "cashFlowFromContinuingOperatingActivities",
  "interestPaidSupplementalData",
  "incomeTaxPaidSupplementalData",
  "freeCashFlow",
  "purchaseOfPPE",
  "saleOfPPE",
  "netPPEPurchaseAndSale",
  "investingCashFlow",
  "cashFlowFromContinuingInvestingActivities",
  "purchaseOfBusiness",
  "saleOfBusiness",
  "netBusinessPurchaseAndSale",
  "purchaseOfInvestment",
  "saleOfInvestment",
  "netInvestmentPurchaseAndSale",
  "netOtherInvestingChanges",
  "financingCashFlow",
  "cashFlowFromContinuingFinancingActivities",
  "issuanceOfDebt",
  "repaymentOfDebt",
  "netIssuancePaymentsOfDebt",
  "longTermDebtIssuance",
  "longTermDebtPayments",
  "netLongTermDebtIssuance",
  "shortTermDebtIssuance",
  "shortTermDebtPayments",
  "netShortTermDebtIssuance",
  "repurchaseOfCapitalStock",
  "commonStockIssuance",
  "commonStockPayments",
  "netCommonStockIssuance",
  "cashDividendsPaid",
  "commonStockDividendPaid",
  "netOtherFinancingCharges",
  "beginningCashPosition",
  "endCashPosition",
  "changesInCash",
  "effectOfExchangeRateChanges",
]);

const BALANCE_KEYS = new Set<string>([
  "totalAssets",
  "currentAssets",
  "cashAndCashEquivalents",
  "cashCashEquivalentsAndShortTermInvestments",
  "otherShortTermInvestments",
  "receivables",
  "accountsReceivable",
  "inventory",
  "prepaidAssets",
  "otherCurrentAssets",
  "totalNonCurrentAssets",
  "netPPE",
  "grossPPE",
  "accumulatedDepreciation",
  "goodwill",
  "otherIntangibleAssets",
  "goodwillAndOtherIntangibleAssets",
  "investmentsAndAdvances",
  "otherNonCurrentAssets",
  "totalLiabilities",
  "currentLiabilities",
  "currentDebt",
  "currentDebtAndCapitalLeaseObligation",
  "payablesAndAccruedExpenses",
  "currentAccruedExpenses",
  "payables",
  "accountsPayable",
  "currentDeferredRevenue",
  "currentDeferredLiabilities",
  "otherCurrentLiabilities",
  "totalNonCurrentLiabilities",
  "longTermDebt",
  "longTermDebtAndCapitalLeaseObligation",
  "longTermCapitalLeaseObligation",
  "nonCurrentDeferredLiabilities",
  "nonCurrentDeferredTaxesLiabilities",
  "otherNonCurrentLiabilities",
  "totalDebt",
  "capitalLeaseObligations",
  "totalCapitalization",
  "totalEquity",
  "totalEquityGrossMinorityInterest",
  "commonStockEquity",
  "commonStock",
  "capitalStock",
  "additionalPaidInCapital",
  "treasuryStock",
  "gainsLossesNotAffectingRetainedEarnings",
  "otherEquityAdjustments",
  "retainedEarnings",
  "longTermEquityInvestment",
  "workingCapital",
  "netTangibleAssets",
  "investedCapital",
  "tangibleBookValue",
  "shareIssued",
  "ordinarySharesNumber",
  "treasurySharesNumber",
  "basicShares",
  "dilutedShares",
]);

export const FINANCIAL_COL_W = 18;
export const FINANCIAL_LABEL_W = 28;
const FINANCIAL_GROWTH_W = 7;
const FINANCIAL_VALUE_W = FINANCIAL_COL_W - FINANCIAL_GROWTH_W;

function aggregateQuarterlyStatements(
  statements: FinancialStatement[],
  date: string,
): FinancialStatement | null {
  if (statements.length < 4) return null;

  const aggregate: FinancialStatement = { date };
  for (const key of FLOW_KEYS) {
    const values = statements
      .map((statement) => (statement as unknown as Record<string, unknown>)[key])
      .filter((value): value is number => typeof value === "number");
    if (values.length === 4) {
      (aggregate as unknown as Record<string, unknown>)[key] = values.reduce((left, right) => left + right, 0);
    }
  }

  const latest = statements[statements.length - 1]!;
  for (const key of BALANCE_KEYS) {
    const value = (latest as unknown as Record<string, unknown>)[key];
    if (typeof value === "number") {
      (aggregate as unknown as Record<string, unknown>)[key] = value;
    }
  }

  return aggregate;
}

export function computeTTM(quarterlyStatements: FinancialStatement[]) {
  return aggregateQuarterlyStatements(quarterlyStatements.slice(-4), "TTM");
}

function computePreviousTtm(quarterlyStatements: FinancialStatement[]) {
  return aggregateQuarterlyStatements(quarterlyStatements.slice(-8, -4), "prevTTM");
}

export function computeGrowth(current: number | undefined, previous: number | undefined): number | undefined {
  if (current == null || previous == null || previous === 0) return undefined;
  return (current - previous) / Math.abs(previous);
}

export function formatFinancialCell(value: string, growth: number | undefined) {
  const growthText = growth != null ? formatGrowthShort(growth) : "";
  return {
    valueText: padTo(value, FINANCIAL_VALUE_W, "right"),
    growthText: padTo(growthText ? ` ${growthText}` : "", FINANCIAL_GROWTH_W, "right"),
  };
}

export function formatFinancialValue(
  value: number | undefined,
  row: Pick<FinancialTableRow, "format" | "divisor">,
): string {
  if (value == null) return "—";
  if (row.format === "eps") return formatNumber(value, 2);
  if (row.format === "percent") return `${formatNumber(value * 100, 1)}%`;
  return formatWithDivisor(value, row.divisor);
}

export function formatFinancialHeader(date: string): string {
  return date === "TTM" ? "TTM" : date.slice(0, 7);
}

export function resolveFinancialPeriod(
  requestedPeriod: FinancialPeriod,
  hasAnnualStatements: boolean,
  hasQuarterlyStatements: boolean,
): FinancialPeriod {
  if (requestedPeriod === "annual") {
    return hasAnnualStatements || !hasQuarterlyStatements ? "annual" : "quarterly";
  }
  return hasQuarterlyStatements || !hasAnnualStatements ? "quarterly" : "annual";
}

export function buildPreviousStatementMap(
  period: FinancialPeriod,
  annualStatements: FinancialStatement[],
  quarterlyStatements: FinancialStatement[],
  ttm: FinancialStatement | null,
) {
  const sourceStatements = period === "annual" ? annualStatements : quarterlyStatements;
  const previousMap = new Map<string, FinancialStatement>();

  for (let index = 1; index < sourceStatements.length; index += 1) {
    previousMap.set(sourceStatements[index]!.date, sourceStatements[index - 1]!);
  }

  if (ttm) {
    const previousTtm = computePreviousTtm(quarterlyStatements);
    if (previousTtm) {
      previousMap.set("TTM", previousTtm);
    }
  }

  return previousMap;
}

function isFinancialGroup(row: FinancialRowDef): row is FinancialGroupDef {
  return "kind" in row && row.kind === "group";
}

export function collectGroupIds(rows: FinancialRowDef[]): string[] {
  return rows.flatMap((row) => {
    if (!isFinancialGroup(row)) return [];
    return [row.id, ...collectGroupIds(row.children)];
  });
}

export function collectDefaultCollapsedGroupIds(rows: FinancialRowDef[]): string[] {
  return rows.flatMap((row) => {
    if (!isFinancialGroup(row)) return [];
    return [
      ...(row.defaultExpanded === true ? [] : [row.id]),
      ...collectDefaultCollapsedGroupIds(row.children),
    ];
  });
}

function hasStatementValue(
  statements: FinancialStatement[],
  key: keyof FinancialStatement,
): boolean {
  return statements.some((statement) => typeof statement[key] === "number");
}

function hasFinancialRowValue(
  row: FinancialRowDef,
  statements: FinancialStatement[],
): boolean {
  if (!isFinancialGroup(row)) {
    return statements.some((statement) => typeof statementMetricValue(row, statement) === "number");
  }
  return (
    (row.summaryKey ? hasStatementValue(statements, row.summaryKey) : false)
    || row.children.some((child) => hasFinancialRowValue(child, statements))
  );
}

function resolveMetricUnit(
  statements: FinancialStatement[],
  def: Pick<MetricDef, "key" | "compute" | "format">,
  label: string,
) {
  const format = def.format ?? "compact";
  const isEps = format === "eps";
  const isPercent = format === "percent";
  const allValues = statements.map((statement) => statementMetricValue(def, statement));
  const { suffix, divisor } = isEps || isPercent ? { suffix: "", divisor: 1 } : pickUnit(allValues);
  return {
    unitLabel: suffix ? `${label} (${suffix})` : label,
    divisor,
    format,
  };
}

export function buildFinancialRows(
  defs: FinancialRowDef[],
  statements: FinancialStatement[],
  collapsedGroups: Set<string>,
  depth = 0,
): FinancialTableRow[] {
  const rows: FinancialTableRow[] = [];

  for (const def of defs) {
    if (!hasFinancialRowValue(def, statements)) continue;

    if (!isFinancialGroup(def)) {
      const { unitLabel, divisor, format } = resolveMetricUnit(statements, def, def.label);
      rows.push({
        kind: "metric",
        id: `${def.id ?? String(def.key)}:${depth}`,
        key: def.key,
        compute: def.compute,
        unitLabel,
        divisor,
        format,
        showGrowth: def.showGrowth ?? format !== "percent",
        depth,
      });
      continue;
    }

    const toggleable = def.children.some((child) => hasFinancialRowValue(child, statements));
    const expanded = toggleable && !collapsedGroups.has(def.id);
    const metricUnit = def.summaryKey
      ? resolveMetricUnit(statements, { key: def.summaryKey, format: def.format ?? "compact" }, def.label)
      : { unitLabel: def.label, divisor: 1, format: def.format ?? "compact" };

    rows.push({
      kind: "group",
      id: def.id,
      label: def.label,
      unitLabel: metricUnit.unitLabel,
      summaryKey: def.summaryKey,
      divisor: metricUnit.divisor,
      format: metricUnit.format,
      depth,
      expanded,
      toggleable,
    });

    if (expanded) {
      rows.push(...buildFinancialRows(def.children, statements, collapsedGroups, depth + 1));
    }
  }

  return rows;
}

export function resolveFinancialSubTabKey(value: string | undefined): string {
  const normalized = (value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!normalized) return FINANCIAL_SUB_TABS[0]!.key;
  if (normalized === "cf" || normalized === "cashflows") return "cashflow";
  if (normalized === "bs" || normalized === "balancesheet") return "balance";
  return FINANCIAL_SUB_TABS.find((tab) => (
    tab.key.toLowerCase() === normalized
    || tab.name.toLowerCase().replace(/[\s_-]+/g, "") === normalized
  ))?.key ?? FINANCIAL_SUB_TABS[0]!.key;
}

export function resolveFinancialPeriodOption(value: string | undefined): FinancialPeriod | undefined {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return undefined;
  if (["a", "ann", "annual", "year", "yearly", "fy"].includes(normalized)) return "annual";
  if (["q", "qtr", "quarter", "quarterly"].includes(normalized)) return "quarterly";
  return undefined;
}

interface FinancialTableCellModel {
  valueText: string;
  growthText: string;
  value: number | undefined;
  growth: number | undefined;
}

interface FinancialTableModelRow {
  kind: FinancialTableRow["kind"];
  id: string;
  key?: keyof FinancialStatement;
  summaryKey?: keyof FinancialStatement;
  unitLabel: string;
  depth: number;
  cells: FinancialTableCellModel[];
}

export interface FinancialTableModel {
  period: FinancialPeriod;
  subTab: FinancialSubTab;
  statements: FinancialStatement[];
  rows: FinancialTableModelRow[];
}

export function buildFinancialTableModel(
  financials: Pick<TickerFinancials, "annualStatements" | "quarterlyStatements"> | null | undefined,
  options: {
    period?: FinancialPeriod;
    statement?: string;
    annualLimit?: number;
    quarterlyLimit?: number;
    collapsedGroupIds?: Iterable<string>;
    expandAll?: boolean;
  } = {},
): FinancialTableModel | null {
  const annualStatements = financials?.annualStatements ?? [];
  const quarterlyStatements = financials?.quarterlyStatements ?? [];
  const hasAnnualStatements = annualStatements.length > 0;
  const hasQuarterlyStatements = quarterlyStatements.length > 0;
  if (!hasAnnualStatements && !hasQuarterlyStatements) return null;

  const requestedPeriod = options.period ?? (hasAnnualStatements ? "annual" : "quarterly");
  const period = resolveFinancialPeriod(requestedPeriod, hasAnnualStatements, hasQuarterlyStatements);
  const isAnnual = period === "annual";
  const rawStatements = isAnnual
    ? annualStatements.slice(-(options.annualLimit ?? 5)).reverse()
    : quarterlyStatements.slice(-(options.quarterlyLimit ?? 6)).reverse();
  const ttm = isAnnual ? computeTTM(quarterlyStatements) : null;
  const statements = ttm ? [ttm, ...rawStatements] : rawStatements;
  const previousStatementMap = buildPreviousStatementMap(period, annualStatements, quarterlyStatements, ttm);
  const subTabKey = resolveFinancialSubTabKey(options.statement);
  const subTab = FINANCIAL_SUB_TABS.find((tab) => tab.key === subTabKey) ?? FINANCIAL_SUB_TABS[0]!;
  const collapsedGroups = options.expandAll
    ? new Set<string>()
    : new Set(options.collapsedGroupIds ?? collectDefaultCollapsedGroupIds(subTab.rows));
  const rows = buildFinancialRows(subTab.rows, statements, collapsedGroups).map((row): FinancialTableModelRow => {
    const cells = statements.map((statement) => {
      const previous = previousStatementMap.get(statement.date);
      const value = row.kind === "group"
        ? row.summaryKey ? statement[row.summaryKey] as number | undefined : undefined
        : statementMetricValue(row, statement);
      const previousValue = previous
        ? row.kind === "group"
          ? row.summaryKey ? previous[row.summaryKey] as number | undefined : undefined
          : statementMetricValue(row, previous)
        : undefined;
      const growth = row.kind === "metric" && !row.showGrowth ? undefined : computeGrowth(value, previousValue);
      return {
        ...formatFinancialCell(formatFinancialValue(value, row), growth),
        value,
        growth,
      };
    });
    return {
      kind: row.kind,
      id: row.id,
      key: row.kind === "metric" ? row.key : undefined,
      summaryKey: row.kind === "group" ? row.summaryKey : undefined,
      unitLabel: row.unitLabel,
      depth: row.depth,
      cells,
    };
  });

  return { period, subTab, statements, rows };
}
