import type { FinancialStatement } from "../../../../types/financials";

export type FinancialPeriod = "annual" | "quarterly";

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
