import { Box, Text, useUiCapabilities } from "../../../ui";
import { TextAttributes, type ScrollBoxRenderable } from "../../../ui";
import { useShortcut } from "../../../react/input";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePaneTicker } from "../../../state/app-context";
import {
  DataTableView,
  Tabs,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
} from "../../../components";
import { colors, priceColor } from "../../../theme/colors";
import type { FinancialStatement } from "../../../types/financials";
import {
  formatGrowthShort,
  formatNumber,
  formatWithDivisor,
  padTo,
  pickUnit,
} from "../../../utils/format";

type FinancialMetricFormat = "compact" | "eps" | "percent";

type MetricDef = {
  label: string;
  key?: keyof FinancialStatement;
  id?: string;
  compute?: (statement: FinancialStatement) => number | undefined;
  format: FinancialMetricFormat;
  showGrowth?: boolean;
};

type FinancialRowDef = MetricDef | FinancialGroupDef;

type FinancialGroupDef = {
  kind: "group";
  id: string;
  label: string;
  summaryKey?: keyof FinancialStatement;
  format?: FinancialMetricFormat;
  defaultExpanded?: boolean;
  children: FinancialRowDef[];
};

type FinancialSubTab = {
  name: string;
  key: string;
  rows: FinancialRowDef[];
};

type FinancialPeriod = "annual" | "quarterly";

type FinancialTableColumn = DataTableColumn & (
  | { id: "metric"; kind: "metric" }
  | { id: string; kind: "statement"; statement: FinancialStatement }
);

type FinancialTableRow =
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

function statementMetricValue(
  def: Pick<MetricDef, "key" | "compute">,
  statement: FinancialStatement,
): number | undefined {
  if (def.key) return statement[def.key] as number | undefined;
  return def.compute?.(statement);
}

const FINANCIAL_SUB_TABS: FinancialSubTab[] = [
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

const FINANCIAL_SUB_TABS_WIDTH = FINANCIAL_SUB_TABS.reduce(
  (sum, tab) => sum + tab.name.length + 2,
  0,
);
const FINANCIAL_PERIOD_TABS_WIDTH = "Annual".length + "Quarterly".length + 4;

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

const FINANCIAL_COL_W = 18;
const FINANCIAL_LABEL_W = 28;
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
      .map((statement) => (statement as Record<string, unknown>)[key])
      .filter((value): value is number => typeof value === "number");
    if (values.length === 4) {
      (aggregate as Record<string, unknown>)[key] = values.reduce((left, right) => left + right, 0);
    }
  }

  const latest = statements[statements.length - 1]!;
  for (const key of BALANCE_KEYS) {
    const value = (latest as Record<string, unknown>)[key];
    if (typeof value === "number") {
      (aggregate as Record<string, unknown>)[key] = value;
    }
  }

  return aggregate;
}

function computeTTM(quarterlyStatements: FinancialStatement[]) {
  return aggregateQuarterlyStatements(quarterlyStatements.slice(-4), "TTM");
}

function computePreviousTtm(quarterlyStatements: FinancialStatement[]) {
  return aggregateQuarterlyStatements(quarterlyStatements.slice(-8, -4), "prevTTM");
}

function computeGrowth(current: number | undefined, previous: number | undefined): number | undefined {
  if (current == null || previous == null || previous === 0) return undefined;
  return (current - previous) / Math.abs(previous);
}

function formatFinancialCell(value: string, growth: number | undefined) {
  const growthText = growth != null ? formatGrowthShort(growth) : "";
  return {
    valueText: padTo(value, FINANCIAL_VALUE_W, "right"),
    growthText: padTo(growthText ? ` ${growthText}` : "", FINANCIAL_GROWTH_W, "right"),
  };
}

function formatFinancialValue(
  value: number | undefined,
  row: Pick<FinancialTableRow, "format" | "divisor">,
): string {
  if (value == null) return "—";
  if (row.format === "eps") return formatNumber(value, 2);
  if (row.format === "percent") return `${formatNumber(value * 100, 1)}%`;
  return formatWithDivisor(value, row.divisor);
}

function formatFinancialHeader(date: string): string {
  return date === "TTM" ? "TTM" : date.slice(0, 7);
}

function resolveFinancialPeriod(
  requestedPeriod: FinancialPeriod,
  hasAnnualStatements: boolean,
  hasQuarterlyStatements: boolean,
): FinancialPeriod {
  if (requestedPeriod === "annual") {
    return hasAnnualStatements || !hasQuarterlyStatements ? "annual" : "quarterly";
  }
  return hasQuarterlyStatements || !hasAnnualStatements ? "quarterly" : "annual";
}

function buildPreviousStatementMap(
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

function collectGroupIds(rows: FinancialRowDef[]): string[] {
  return rows.flatMap((row) => {
    if (!isFinancialGroup(row)) return [];
    return [row.id, ...collectGroupIds(row.children)];
  });
}

function collectDefaultCollapsedGroupIds(rows: FinancialRowDef[]): string[] {
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

function buildFinancialRows(
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

export function FinancialsTab({
  focused,
  headerScrollId,
  bodyScrollId,
}: {
  focused: boolean;
  headerScrollId?: string;
  bodyScrollId?: string;
}) {
  const { financials } = usePaneTicker();
  return (
    <ResolvedFinancialsTab
      focused={focused}
      financials={financials}
      headerScrollId={headerScrollId}
      bodyScrollId={bodyScrollId}
    />
  );
}

export function ResolvedFinancialsTab({
  focused,
  financials,
  headerScrollId,
  bodyScrollId,
}: {
  focused: boolean;
  financials: ReturnType<typeof usePaneTicker>["financials"];
  headerScrollId?: string;
  bodyScrollId?: string;
}) {
  const annualStatements = financials?.annualStatements ?? [];
  const quarterlyStatements = financials?.quarterlyStatements ?? [];
  const hasAnnualStatements = annualStatements.length > 0;
  const hasQuarterlyStatements = quarterlyStatements.length > 0;
  const [period, setPeriod] = useState<FinancialPeriod>(hasAnnualStatements ? "annual" : "quarterly");
  const [subTabIdx, setSubTabIdx] = useState(0);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(collectDefaultCollapsedGroupIds(FINANCIAL_SUB_TABS.flatMap((tab) => tab.rows))),
  );
  const bodyScrollRef = useRef<ScrollBoxRenderable>(null);
  const headerScrollRef = useRef<ScrollBoxRenderable>(null);
  const resolvedPeriodForFooter = resolveFinancialPeriod(period, hasAnnualStatements, hasQuarterlyStatements);
  const { nativePaneChrome } = useUiCapabilities();
  const subTab = FINANCIAL_SUB_TABS[subTabIdx]!;
  const currentGroupIds = useMemo(() => collectGroupIds(subTab.rows), [subTab]);
  const hasCollapsedCurrentGroup = currentGroupIds.some((id) => collapsedGroups.has(id));
  const hasExpandedCurrentGroup = currentGroupIds.some((id) => !collapsedGroups.has(id));
  const togglePeriod = useCallback(() => {
    if (!hasAnnualStatements && !hasQuarterlyStatements) return;
    setPeriod((current) => {
      const resolved = resolveFinancialPeriod(current, hasAnnualStatements, hasQuarterlyStatements);
      if (resolved === "annual" && hasQuarterlyStatements) return "quarterly";
      if (hasAnnualStatements) return "annual";
      return "quarterly";
    });
  }, [hasAnnualStatements, hasQuarterlyStatements]);
  const toggleGroup = useCallback((groupId: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);
  const expandCurrentGroups = useCallback(() => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      for (const groupId of currentGroupIds) next.delete(groupId);
      return next;
    });
  }, [currentGroupIds]);
  const collapseCurrentGroups = useCallback(() => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      for (const groupId of currentGroupIds) next.add(groupId);
      return next;
    });
  }, [currentGroupIds]);

  usePaneFooter("financials", () => ({
    info: financials ? [
      { id: "section", parts: [{ text: FINANCIAL_SUB_TABS[subTabIdx]?.name ?? "Financials", tone: "value", bold: true }] },
      { id: "period", parts: [{ text: resolvedPeriodForFooter === "annual" ? "Annual" : "Quarterly", tone: "muted" }] },
    ] : [],
    hints: [
      {
        id: "section",
        key: "1-3",
        label: "section",
        disabled: !financials,
        onPress: () => setSubTabIdx((current) => (current + 1) % FINANCIAL_SUB_TABS.length),
      },
      {
        id: "period",
        key: "p",
        label: "eriod",
        disabled: !hasAnnualStatements && !hasQuarterlyStatements,
        onPress: togglePeriod,
      },
      {
        id: "expand-groups",
        key: "e",
        label: "xpand",
        disabled: !hasCollapsedCurrentGroup,
        onPress: expandCurrentGroups,
      },
      {
        id: "collapse-groups",
        key: "c",
        label: "ollapse",
        disabled: !hasExpandedCurrentGroup,
        onPress: collapseCurrentGroups,
      },
    ],
  }), [
    collapseCurrentGroups,
    expandCurrentGroups,
    financials,
    hasAnnualStatements,
    hasCollapsedCurrentGroup,
    hasExpandedCurrentGroup,
    hasQuarterlyStatements,
    resolvedPeriodForFooter,
    subTabIdx,
    togglePeriod,
  ]);

  const syncHeaderScroll = useCallback(() => {
    const body = bodyScrollRef.current;
    const header = headerScrollRef.current;
    if (body && header && header.scrollLeft !== body.scrollLeft) {
      header.scrollLeft = body.scrollLeft;
    }
  }, []);

  useShortcut((event) => {
    if (!focused) return;
    const keyName = event.name || event.key || event.sequence;
    if (keyName === "p") {
      event.preventDefault();
      event.stopPropagation();
      togglePeriod();
    } else if (keyName === "e" && hasCollapsedCurrentGroup) {
      event.preventDefault();
      event.stopPropagation();
      expandCurrentGroups();
    } else if (keyName === "c" && hasExpandedCurrentGroup) {
      event.preventDefault();
      event.stopPropagation();
      collapseCurrentGroups();
    } else if (keyName === "1" || keyName === "2" || keyName === "3") {
      event.preventDefault();
      event.stopPropagation();
      setSubTabIdx(Number(keyName) - 1);
    }
  }, { phase: "before" });

  useEffect(() => {
    if (period === "annual" && !hasAnnualStatements && hasQuarterlyStatements) {
      setPeriod("quarterly");
    } else if (period === "quarterly" && !hasQuarterlyStatements && hasAnnualStatements) {
      setPeriod("annual");
    }
  }, [hasAnnualStatements, hasQuarterlyStatements, period]);

  if (!financials || (!hasAnnualStatements && !hasQuarterlyStatements)) {
    return <Text fg={colors.textDim}>No financial data available.</Text>;
  }

  const resolvedPeriod = resolveFinancialPeriod(period, hasAnnualStatements, hasQuarterlyStatements);
  const isAnnual = resolvedPeriod === "annual";
  const rawStatements = isAnnual
    ? annualStatements.slice(-5).reverse()
    : quarterlyStatements.slice(-6).reverse();
  const ttm = isAnnual ? computeTTM(quarterlyStatements) : null;
  const displayStatements = ttm ? [ttm, ...rawStatements] : rawStatements;
  const previousStatementMap = buildPreviousStatementMap(
    resolvedPeriod,
    annualStatements,
    quarterlyStatements,
    ttm,
  );
  const columns: FinancialTableColumn[] = [
    {
      id: "metric",
      kind: "metric",
      label: isAnnual ? "Annual" : "Quarterly",
      width: FINANCIAL_LABEL_W,
      align: "left",
    },
    ...displayStatements.map((statement, index): FinancialTableColumn => ({
      id: `statement:${statement.date}:${index}`,
      kind: "statement",
      statement,
      label: padTo(formatFinancialHeader(statement.date), FINANCIAL_COL_W, "center"),
      width: FINANCIAL_COL_W,
      align: "right",
      headerColor: statement.date === "TTM" ? colors.textBright : colors.textDim,
    })),
  ];
  const rows = buildFinancialRows(subTab.rows, displayStatements, collapsedGroups);

  const renderCell = (
    row: FinancialTableRow,
    column: FinancialTableColumn,
  ): DataTableCell => {
    if (column.kind === "metric") {
      if (row.kind === "group") {
        const indent = " ".repeat(row.depth * 2);
        const marker = row.toggleable ? (row.expanded ? "▾" : "▸") : " ";
        return {
          text: `${indent}${marker} ${row.unitLabel}`,
          color: row.depth === 0 ? colors.textBright : colors.textDim,
          attributes: row.depth === 0 ? TextAttributes.BOLD : TextAttributes.NONE,
          backgroundColor: row.depth === 0 ? colors.panel : undefined,
          onMouseDown: row.toggleable
            ? (event) => {
              event.preventDefault?.();
              event.stopPropagation?.();
              toggleGroup(row.id);
            }
            : undefined,
        };
      }

      return {
        text: `${" ".repeat(row.depth * 2 + 2)}${row.unitLabel}`,
        color: colors.textDim,
      };
    }

    const key = row.kind === "group" ? row.summaryKey : undefined;
    if (row.kind === "group" && !key) return {
      text: "",
      backgroundColor: row.depth === 0 ? colors.panel : undefined,
    };

    const previous = previousStatementMap.get(column.statement.date);
    const value = row.kind === "group"
      ? column.statement[key!] as number | undefined
      : statementMetricValue(row, column.statement);
    const previousValue = previous
      ? row.kind === "group"
        ? previous[key!] as number | undefined
        : statementMetricValue(row, previous)
      : undefined;
    const growth = row.kind === "metric" && !row.showGrowth ? undefined : computeGrowth(value, previousValue);
    const formattedValue = formatFinancialValue(value, row);
    const cell = formatFinancialCell(formattedValue, growth);

    return {
      text: `${cell.valueText}${cell.growthText}`,
      backgroundColor: row.kind === "group" && row.depth === 0 ? colors.panel : undefined,
      content: (
        <Box flexDirection="row" width={FINANCIAL_COL_W}>
          <Text
            attributes={row.kind === "group" ? TextAttributes.BOLD : TextAttributes.NONE}
            fg={colors.text}
          >
            {cell.valueText}
          </Text>
          <Text
            attributes={row.kind === "group" ? TextAttributes.BOLD : TextAttributes.NONE}
            fg={growth != null ? priceColor(growth) : colors.text}
          >
            {cell.growthText}
          </Text>
        </Box>
      ),
    };
  };

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      flexBasis={0}
      paddingX={1}
      paddingBottom={nativePaneChrome ? 0 : 1}
      overflow="hidden"
    >
      <DataTableView<FinancialTableRow, FinancialTableColumn>
        focused={focused}
        headerScrollRef={headerScrollRef}
        scrollRef={bodyScrollRef}
        syncHeaderScroll={syncHeaderScroll}
        headerScrollId={headerScrollId}
        bodyScrollId={bodyScrollId}
        columns={columns}
        items={rows}
        sortColumnId={null}
        sortDirection="desc"
        onHeaderClick={() => {}}
        getItemKey={(row) => row.id}
        isSelected={() => false}
        onSelect={(row) => {
          if (row.kind === "group" && row.toggleable) toggleGroup(row.id);
        }}
        onActivate={(row) => {
          if (row.kind === "group" && row.toggleable) toggleGroup(row.id);
        }}
        isNavigable={(row) => row.kind === "group" && row.toggleable}
        getRowBackgroundColor={(row) => row.kind === "group" && row.depth === 0 ? colors.panel : undefined}
        renderCell={renderCell}
        emptyStateTitle="No financial data"
        showHorizontalScrollbar
        resetScrollKey={`${resolvedPeriod}:${subTab.key}:${displayStatements.length}`}
        rootBefore={(
          <>
            <Box flexDirection="row" height={1}>
              <Box width={FINANCIAL_SUB_TABS_WIDTH} height={1}>
                <Tabs
                  tabs={FINANCIAL_SUB_TABS.map((tab, index) => ({
                    label: tab.name,
                    value: String(index),
                  }))}
                  activeValue={String(subTabIdx)}
                  onSelect={(value) => setSubTabIdx(Number(value))}
                  compact
                  variant="bare"
                />
              </Box>
              <Box flexGrow={1} />
              <Box width={FINANCIAL_PERIOD_TABS_WIDTH} height={1}>
                <Tabs
                  tabs={[
                    { label: "Annual", value: "annual", disabled: !hasAnnualStatements },
                    { label: "Quarterly", value: "quarterly", disabled: !hasQuarterlyStatements },
                  ]}
                  activeValue={isAnnual ? "annual" : "quarterly"}
                  onSelect={(value) => setPeriod(value as FinancialPeriod)}
                  compact
                  variant="bare"
                />
              </Box>
            </Box>
          </>
        )}
      />
    </Box>
  );
}
