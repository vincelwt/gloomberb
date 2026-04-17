import { Box, ScrollBox, Text } from "../../../ui";
import { TextAttributes, type ScrollBoxRenderable } from "../../../ui";
import { useShortcut } from "../../../react/input";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePaneTicker } from "../../../state/app-context";
import { colors, priceColor } from "../../../theme/colors";
import type { FinancialStatement } from "../../../types/financials";
import {
  formatGrowthShort,
  formatNumber,
  formatWithDivisor,
  padTo,
  pickUnit,
} from "../../../utils/format";

type MetricDef = {
  label: string;
  key: keyof FinancialStatement;
  format: "compact" | "eps";
};

type FinancialSubTab = {
  name: string;
  key: string;
  metrics: MetricDef[];
};

type FinancialPeriod = "annual" | "quarterly";

const FINANCIAL_SUB_TABS: FinancialSubTab[] = [
  {
    name: "Income",
    key: "income",
    metrics: [
      { label: "Revenue", key: "totalRevenue", format: "compact" },
      { label: "Cost of Revenue", key: "costOfRevenue", format: "compact" },
      { label: "Gross Profit", key: "grossProfit", format: "compact" },
      { label: "R&D", key: "researchAndDevelopment", format: "compact" },
      { label: "SG&A", key: "sellingGeneralAndAdministration", format: "compact" },
      { label: "Operating Exp", key: "operatingExpense", format: "compact" },
      { label: "Operating Inc", key: "operatingIncome", format: "compact" },
      { label: "Interest Exp", key: "interestExpense", format: "compact" },
      { label: "Tax Provision", key: "taxProvision", format: "compact" },
      { label: "Net Income", key: "netIncome", format: "compact" },
      { label: "EBITDA", key: "ebitda", format: "compact" },
      { label: "Basic EPS", key: "basicEps", format: "eps" },
      { label: "Diluted EPS", key: "eps", format: "eps" },
      { label: "Shares Out", key: "dilutedShares", format: "compact" },
    ],
  },
  {
    name: "Cash Flow",
    key: "cashflow",
    metrics: [
      { label: "Operating CF", key: "operatingCashFlow", format: "compact" },
      { label: "CapEx", key: "capitalExpenditure", format: "compact" },
      { label: "Free Cash Flow", key: "freeCashFlow", format: "compact" },
      { label: "Investing CF", key: "investingCashFlow", format: "compact" },
      { label: "Financing CF", key: "financingCashFlow", format: "compact" },
      { label: "Debt Issuance", key: "issuanceOfDebt", format: "compact" },
      { label: "Buybacks", key: "repurchaseOfCapitalStock", format: "compact" },
      { label: "Dividends Paid", key: "cashDividendsPaid", format: "compact" },
    ],
  },
  {
    name: "Balance Sheet",
    key: "balance",
    metrics: [
      { label: "Total Assets", key: "totalAssets", format: "compact" },
      { label: "Current Assets", key: "currentAssets", format: "compact" },
      { label: "Cash & Equiv", key: "cashAndCashEquivalents", format: "compact" },
      { label: "Total Liab", key: "totalLiabilities", format: "compact" },
      { label: "Current Liab", key: "currentLiabilities", format: "compact" },
      { label: "Long-Term Debt", key: "longTermDebt", format: "compact" },
      { label: "Total Debt", key: "totalDebt", format: "compact" },
      { label: "Equity", key: "totalEquity", format: "compact" },
      { label: "Retained Earn", key: "retainedEarnings", format: "compact" },
    ],
  },
];

const FLOW_KEYS = new Set<string>([
  "totalRevenue",
  "costOfRevenue",
  "grossProfit",
  "sellingGeneralAndAdministration",
  "researchAndDevelopment",
  "operatingExpense",
  "operatingIncome",
  "interestExpense",
  "taxProvision",
  "netIncome",
  "ebitda",
  "basicEps",
  "eps",
  "operatingCashFlow",
  "capitalExpenditure",
  "freeCashFlow",
  "investingCashFlow",
  "financingCashFlow",
  "issuanceOfDebt",
  "repurchaseOfCapitalStock",
  "cashDividendsPaid",
]);

const BALANCE_KEYS = new Set<string>([
  "totalAssets",
  "currentAssets",
  "cashAndCashEquivalents",
  "totalLiabilities",
  "currentLiabilities",
  "longTermDebt",
  "totalDebt",
  "totalEquity",
  "retainedEarnings",
  "dilutedShares",
]);

const FINANCIAL_COL_W = 18;
const FINANCIAL_LABEL_W = 20;
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

function formatFinancialHeader(date: string): string {
  const label = date === "TTM" ? "TTM" : date.slice(0, 7);
  return padTo(label, FINANCIAL_COL_W, "center");
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
  const bodyScrollRef = useRef<ScrollBoxRenderable>(null);
  const headerScrollRef = useRef<ScrollBoxRenderable>(null);

  const syncHeaderScroll = useCallback(() => {
    const body = bodyScrollRef.current;
    const header = headerScrollRef.current;
    if (body && header && header.scrollLeft !== body.scrollLeft) {
      header.scrollLeft = body.scrollLeft;
    }
  }, []);

  useShortcut((event) => {
    if (!focused) return;
    if (event.name === "a" && hasAnnualStatements) setPeriod("annual");
    else if (event.name === "q" && hasQuarterlyStatements) setPeriod("quarterly");
    else if (event.name === "1") setSubTabIdx(0);
    else if (event.name === "2") setSubTabIdx(1);
    else if (event.name === "3") setSubTabIdx(2);
  });

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

  const subTab = FINANCIAL_SUB_TABS[subTabIdx]!;
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
  const tableWidth = FINANCIAL_LABEL_W + (displayStatements.length * FINANCIAL_COL_W);

  useEffect(() => {
    if (headerScrollRef.current) {
      headerScrollRef.current.horizontalScrollBar.visible = false;
    }
    syncHeaderScroll();
  }, [displayStatements.length, isAnnual, subTabIdx, syncHeaderScroll]);

  useEffect(() => {
    const body = bodyScrollRef.current;
    if (!body) return;
    const hasVerticalOverflow = body.scrollHeight > body.viewport.height;
    body.verticalScrollBar.visible = hasVerticalOverflow;
    if (!hasVerticalOverflow && body.scrollTop !== 0) {
      body.scrollTo({ x: body.scrollLeft, y: 0 });
    }
  }, [displayStatements.length, isAnnual, subTabIdx, subTab.metrics.length]);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2} paddingBottom={1}>
      <Box flexDirection="row" height={1}>
        {FINANCIAL_SUB_TABS.map((tab, index) => (
          <Box key={tab.key} flexDirection="row" onMouseDown={() => setSubTabIdx(index)}>
            <Text
              fg={index === subTabIdx ? colors.textBright : colors.textDim}
              attributes={index === subTabIdx ? TextAttributes.BOLD : 0}
            >
              {`${index + 1}:${tab.name}`}
            </Text>
            {index < FINANCIAL_SUB_TABS.length - 1 && <Text fg={colors.textMuted}>{" │ "}</Text>}
          </Box>
        ))}
        <Box flexGrow={1} />
        <Box onMouseDown={() => setPeriod("annual")}>
          <Text fg={isAnnual ? colors.textBright : colors.textDim} attributes={isAnnual ? TextAttributes.BOLD : 0}>a</Text>
        </Box>
        <Text fg={colors.textMuted}>/</Text>
        <Box onMouseDown={() => setPeriod("quarterly")}>
          <Text fg={!isAnnual ? colors.textBright : colors.textDim} attributes={!isAnnual ? TextAttributes.BOLD : 0}>q</Text>
        </Box>
      </Box>
      <Box height={1} />

      <ScrollBox id={headerScrollId} ref={headerScrollRef} height={1} scrollX focusable={false}>
        <Box flexDirection="row" width={tableWidth} height={1}>
          <Box width={FINANCIAL_LABEL_W}>
            <Text attributes={TextAttributes.BOLD} fg={colors.textDim}>
              {isAnnual ? "Annual" : "Quarterly"}
            </Text>
          </Box>
          {displayStatements.map((statement) => (
            <Box key={statement.date} width={FINANCIAL_COL_W}>
              <Text
                attributes={TextAttributes.BOLD}
                fg={statement.date === "TTM" ? colors.textBright : colors.textDim}
              >
                {formatFinancialHeader(statement.date)}
              </Text>
            </Box>
          ))}
        </Box>
      </ScrollBox>
      <Box height={1} />

      <ScrollBox
        id={bodyScrollId}
        ref={bodyScrollRef}
        flexGrow={1}
        scrollX
        scrollY
        focusable={false}
        onMouseDown={() => queueMicrotask(syncHeaderScroll)}
        onMouseUp={() => queueMicrotask(syncHeaderScroll)}
        onMouseDrag={() => queueMicrotask(syncHeaderScroll)}
        onMouseScroll={() => queueMicrotask(syncHeaderScroll)}
      >
        <Box flexDirection="column" width={tableWidth} paddingBottom={1}>
          {subTab.metrics.map(({ label, key, format }, index) => {
            const isEps = format === "eps";
            const allValues = displayStatements.map((statement) => statement[key] as number | undefined);
            const { suffix, divisor } = isEps ? { suffix: "", divisor: 1 } : pickUnit(allValues);
            const unitLabel = suffix ? `${label} (${suffix})` : label;

            return (
              <Box key={key} flexDirection="column" width={tableWidth}>
                {index > 0 && index % 4 === 0 && <Box height={1} width={tableWidth} />}
                <Box flexDirection="row" width={tableWidth} height={1}>
                  <Box width={FINANCIAL_LABEL_W}>
                    <Text fg={colors.textDim}>{unitLabel}</Text>
                  </Box>
                  {displayStatements.map((statement) => {
                    const value = statement[key] as number | undefined;
                    const previous = previousStatementMap.get(statement.date);
                    const previousValue = previous ? (previous[key] as number | undefined) : undefined;
                    const growth = computeGrowth(value, previousValue);
                    const formattedValue = value != null
                      ? isEps
                        ? formatNumber(value, 2)
                        : formatWithDivisor(value, divisor)
                      : "—";
                    const cell = formatFinancialCell(formattedValue, growth);

                    return (
                      <Box key={statement.date} width={FINANCIAL_COL_W} flexDirection="row">
                        <Text fg={colors.text}>{cell.valueText}</Text>
                        <Text fg={growth != null ? priceColor(growth) : colors.text}>{cell.growthText}</Text>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            );
          })}
        </Box>
      </ScrollBox>
    </Box>
  );
}
