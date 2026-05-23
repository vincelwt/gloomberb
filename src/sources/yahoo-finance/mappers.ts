import type { EarningsEvent } from "../../types/data-provider";
import type {
  AnalystEstimateRecord,
  AnalystResearchData,
  CorporateActionsData,
  DividendAction,
  EarningsAction,
  MarketState,
  SplitAction,
} from "../../types/financials";
import type { ChartResult, YahooEarningsTrend, YahooQuoteSummaryResult } from "./types";

const SUB_UNIT_CURRENCIES: Record<string, { main: string; divisor: number }> = {
  GBp: { main: "GBP", divisor: 100 },
  GBX: { main: "GBP", divisor: 100 },
  ILA: { main: "ILS", divisor: 100 },
  ZAc: { main: "ZAR", divisor: 100 },
};

export type ExtendedHoursData = {
  preMarketPrice?: number;
  preMarketChange?: number;
  preMarketChangePercent?: number;
  postMarketPrice?: number;
  postMarketChange?: number;
  postMarketChangePercent?: number;
};

export function normalizeSubUnitCurrency(currency: string): { currency: string; divisor: number } {
  const sub = SUB_UNIT_CURRENCIES[currency];
  if (sub) return { currency: sub.main, divisor: sub.divisor };
  return { currency, divisor: 1 };
}

export function financeRawNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") {
    const raw = (value as { raw?: unknown }).raw;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  }
  return undefined;
}

function financeRawNumberOrNull(value: unknown): number | null {
  return financeRawNumber(value) ?? null;
}

export function hasAnalystResearchValue(data: AnalystResearchData): boolean {
  return !!data.priceTarget
    || data.recommendations.length > 0
    || data.ratings.length > 0
    || data.earningsEstimates.length > 0
    || data.revenueEstimates.length > 0;
}

export function hasCorporateActionsValue(data: CorporateActionsData): boolean {
  return data.dividends.length > 0
    || data.splits.length > 0
    || data.earnings.length > 0;
}

export function normalizePositiveMarketValue(value: number | undefined, divisor = 1): number | undefined {
  if (value == null || !Number.isFinite(value) || value <= 0) return undefined;
  return value / divisor;
}

export function normalizeMarketValue(value: number | undefined, divisor = 1): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  return value / divisor;
}

function yahooRawDateTime(value: unknown): Date | null {
  const raw = financeRawNumber(value);
  if (raw == null) return null;
  const date = new Date(raw * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function yahooRawDate(value: unknown): string | undefined {
  if (value && typeof value === "object") {
    const fmt = (value as { fmt?: unknown }).fmt;
    if (typeof fmt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fmt)) return fmt;
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const raw = financeRawNumber(value);
  if (raw == null) return undefined;
  const date = new Date(raw * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

function inferEarningsTiming(date: Date): EarningsEvent["timing"] {
  const hour = date.getUTCHours();
  if (hour >= 20) return "AMC";
  if (hour <= 13) return "BMO";
  return "";
}

export function deriveShareChange(position: number | undefined, changePercent: number | undefined): number | undefined {
  if (position == null || changePercent == null || !Number.isFinite(position) || !Number.isFinite(changePercent)) return undefined;
  const denominator = 1 + changePercent;
  if (denominator <= 0) return undefined;
  return Math.round(position - position / denominator);
}

export function mapYahooAnalystResearchResponse(
  result: YahooQuoteSummaryResult,
  fallbackSymbol: string,
): AnalystResearchData {
  const financialData = result.financialData;
  const targetHigh = financeRawNumber(financialData?.targetHighPrice);
  const targetLow = financeRawNumber(financialData?.targetLowPrice);
  const targetMean = financeRawNumber(financialData?.targetMeanPrice);
  const targetMedian = financeRawNumber(financialData?.targetMedianPrice);
  const currentPrice = financeRawNumber(financialData?.currentPrice);
  const trend = result.earningsTrend?.trend ?? [];

  return {
    providerId: "yahoo",
    symbol: result.price?.symbol ?? fallbackSymbol,
    name: result.price?.shortName ?? result.price?.longName,
    currency: result.price?.currency,
    exchange: result.price?.exchangeName,
    priceTarget: targetHigh != null || targetLow != null || targetMean != null || targetMedian != null
      ? {
          high: targetHigh,
          median: targetMedian,
          low: targetLow,
          average: targetMean,
          current: currentPrice,
          currency: result.price?.currency,
        }
      : undefined,
    recommendationRating: yahooRecommendationMeanToRating(financeRawNumber(financialData?.recommendationMean)),
    recommendations: (result.recommendationTrend?.trend ?? [])
      .filter((row) => row.period)
      .map((row) => ({
        period: normalizeYahooRecommendationPeriod(row.period),
        strongBuy: row.strongBuy,
        buy: row.buy,
        hold: row.hold,
        sell: row.sell,
        strongSell: row.strongSell,
      })),
    ratings: (result.upgradeDowngradeHistory?.history ?? [])
      .map((rating): AnalystResearchData["ratings"][number] | null => {
        const firm = rating.firm?.trim();
        const date = rating.epochGradeDate
          ? new Date(rating.epochGradeDate * 1000).toISOString().slice(0, 10)
          : "";
        if (!firm || !date) return null;
        const action = normalizeYahooRatingAction(rating.action, rating.priceTargetAction);
        const current = rating.toGrade?.trim();
        const prior = rating.fromGrade?.trim();
        const currentPriceTarget = financeRawNumber(rating.currentPriceTarget);
        const priorPriceTarget = financeRawNumber(rating.priorPriceTarget);
        return {
          date,
          firm,
          ...(action ? { action } : {}),
          ...(current ? { current } : {}),
          ...(prior ? { prior } : {}),
          ...(currentPriceTarget != null ? { currentPriceTarget } : {}),
          ...(priorPriceTarget != null ? { priorPriceTarget } : {}),
        };
      })
      .filter((rating): rating is AnalystResearchData["ratings"][number] => rating !== null)
      .sort((left, right) => right.date.localeCompare(left.date))
      .slice(0, 100),
    earningsEstimates: trend
      .map((row) => mapYahooEstimate(row, row.earningsEstimate, "yearAgoEps"))
      .filter((estimate): estimate is AnalystEstimateRecord => estimate !== null),
    revenueEstimates: trend
      .map((row) => mapYahooEstimate(row, row.revenueEstimate, "yearAgoRevenue"))
      .filter((estimate): estimate is AnalystEstimateRecord => estimate !== null),
  };
}

export function mapYahooDividends(events: ChartResult["events"]): DividendAction[] {
  return Object.values(events?.dividends ?? {})
    .map((dividend): DividendAction | null => {
      const date = yahooTimestampDate(dividend.date);
      if (!date || dividend.amount == null || !Number.isFinite(dividend.amount)) return null;
      return { exDate: date, amount: dividend.amount };
    })
    .filter((dividend): dividend is DividendAction => dividend !== null);
}

export function mapYahooSplits(events: ChartResult["events"]): SplitAction[] {
  return Object.values(events?.splits ?? {})
    .map((split): SplitAction | null => {
      const date = yahooTimestampDate(split.date);
      if (!date) return null;
      const numerator = split.numerator;
      const denominator = split.denominator;
      return {
        date,
        description: split.splitRatio ? `${split.splitRatio} split` : "Split",
        ratio: numerator != null && denominator ? numerator / denominator : undefined,
        fromFactor: denominator,
        toFactor: numerator,
      };
    })
    .filter((split): split is SplitAction => split !== null);
}

export function mapYahooCalendarEarnings(result: YahooQuoteSummaryResult): EarningsAction[] {
  const rawDate = result.calendarEvents?.earnings?.earningsDate?.[0];
  const date = yahooRawDate(rawDate);
  if (!date) return [];
  const timestamp = yahooRawDateTime(rawDate);
  return [{
    date,
    time: timestamp ? inferEarningsTiming(timestamp) : undefined,
    epsEstimate: financeRawNumber(result.calendarEvents?.earnings?.earningsAverage),
  }];
}

export function mapYahooEarningsHistory(result: YahooQuoteSummaryResult): EarningsAction[] {
  return (result.earningsHistory?.history ?? [])
    .map((earning): EarningsAction | null => {
      const date = yahooRawDate(earning.quarter);
      if (!date) return null;
      const surprisePercent = financeRawNumber(earning.surprisePercent);
      return {
        date,
        epsEstimate: financeRawNumber(earning.epsEstimate),
        epsActual: financeRawNumber(earning.epsActual),
        difference: financeRawNumber(earning.epsDifference),
        surprisePercent: surprisePercent == null ? undefined : surprisePercent * 100,
      };
    })
    .filter((earning): earning is EarningsAction => earning !== null);
}

export function mapYahooEarningsCalendarEvent(
  result: YahooQuoteSummaryResult,
  symbol: string,
): EarningsEvent | null {
  const cal = result.calendarEvents?.earnings;
  if (!cal?.earningsDate?.length) return null;

  const earningsDate = new Date((cal.earningsDate[0]!.raw ?? 0) * 1000);
  if (Number.isNaN(earningsDate.getTime())) return null;

  const currentQtr = result.earningsTrend?.trend?.find((trend) => trend.period === "0q");
  const earningsEstimate = currentQtr?.earningsEstimate;
  const revenueEstimate = currentQtr?.revenueEstimate;
  const epsTrend = currentQtr?.epsTrend;
  const epsRevisions = currentQtr?.epsRevisions;

  return {
    symbol,
    name: result.quoteType?.shortName || result.quoteType?.longName || symbol,
    earningsDate,
    earningsCallDate: yahooRawDateTime(cal.earningsCallDate?.[0]),
    isDateEstimate: cal.isEarningsDateEstimate ?? null,
    epsEstimate: financeRawNumberOrNull(earningsEstimate?.avg ?? cal.earningsAverage),
    epsLow: financeRawNumberOrNull(earningsEstimate?.low ?? cal.earningsLow),
    epsHigh: financeRawNumberOrNull(earningsEstimate?.high ?? cal.earningsHigh),
    epsYearAgo: financeRawNumberOrNull(earningsEstimate?.yearAgoEps),
    epsGrowth: financeRawNumberOrNull(earningsEstimate?.growth),
    epsAnalysts: financeRawNumberOrNull(earningsEstimate?.numberOfAnalysts),
    epsTrend7dAgo: financeRawNumberOrNull(epsTrend?.["7daysAgo"]),
    epsTrend30dAgo: financeRawNumberOrNull(epsTrend?.["30daysAgo"]),
    epsRevisionUp7d: financeRawNumberOrNull(epsRevisions?.upLast7days),
    epsRevisionUp30d: financeRawNumberOrNull(epsRevisions?.upLast30days),
    epsRevisionDown7d: financeRawNumberOrNull(epsRevisions?.downLast7Days),
    epsRevisionDown30d: financeRawNumberOrNull(epsRevisions?.downLast30days),
    epsActual: null,
    revenueEstimate: financeRawNumberOrNull(revenueEstimate?.avg ?? cal.revenueAverage),
    revenueLow: financeRawNumberOrNull(revenueEstimate?.low ?? cal.revenueLow),
    revenueHigh: financeRawNumberOrNull(revenueEstimate?.high ?? cal.revenueHigh),
    revenueYearAgo: financeRawNumberOrNull(revenueEstimate?.yearAgoRevenue),
    revenueGrowth: financeRawNumberOrNull(revenueEstimate?.growth),
    revenueAnalysts: financeRawNumberOrNull(revenueEstimate?.numberOfAnalysts),
    revenueActual: null,
    surprise: null,
    timing: inferEarningsTiming(earningsDate),
  };
}

export function deriveMarketState(meta: NonNullable<ChartResult["meta"]>): MarketState {
  const ctp = meta.currentTradingPeriod;
  if (!ctp) return "CLOSED";
  const now = Math.floor(Date.now() / 1000);
  if (ctp.regular?.start && ctp.regular?.end && now >= ctp.regular.start && now < ctp.regular.end) return "REGULAR";
  if (ctp.pre?.start && ctp.pre?.end && now >= ctp.pre.start && now < ctp.pre.end) return "PRE";
  if (ctp.post?.start && ctp.post?.end && now >= ctp.post.start && now < ctp.post.end) return "POST";
  return "CLOSED";
}

export function extractExtendedHoursPrices(
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
    for (let i = timestamps.length - 1; i >= 0; i--) {
      if (timestamps[i]! < regStart && closes[i] != null) {
        const ext = computeExtendedHoursChange(closes[i]!, regularClose);
        return { preMarketPrice: closes[i]!, preMarketChange: ext.change, preMarketChangePercent: ext.changePct };
      }
    }
  } else if (marketState === "POST") {
    for (let i = timestamps.length - 1; i >= 0; i--) {
      if (timestamps[i]! >= regEnd && closes[i] != null) {
        const ext = computeExtendedHoursChange(closes[i]!, regularClose);
        return { postMarketPrice: closes[i]!, postMarketChange: ext.change, postMarketChangePercent: ext.changePct };
      }
    }
  }
  return {};
}

function normalizeYahooRecommendationPeriod(period?: string): string {
  switch (period) {
    case "0m":
      return "current month";
    case "-1m":
      return "previous month";
    case "-2m":
      return "previous 2 months";
    case "-3m":
      return "previous 3 months";
    case "0q":
      return "current quarter";
    case "+1q":
      return "next quarter";
    case "0y":
      return "current year";
    case "+1y":
      return "next year";
    default:
      return period ?? "";
  }
}

function normalizeYahooRatingAction(action?: string, priceTargetAction?: string): string | undefined {
  const targetAction = priceTargetAction?.trim();
  switch ((action ?? "").toLowerCase()) {
    case "up":
      return "Upgrade";
    case "down":
      return "Downgrade";
    case "init":
      return "Initiated";
    case "reit":
      return targetAction || "Reiterated";
    case "main":
      return targetAction || "Maintained";
    default:
      return action?.trim() || undefined;
  }
}

function yahooRecommendationMeanToRating(value: number | undefined): number | undefined {
  if (value == null) return undefined;
  return Math.max(0, Math.min(10, ((5 - value) / 4) * 10));
}

function mapYahooEstimate(
  trend: YahooEarningsTrend,
  estimate: unknown,
  yearAgoKey: "yearAgoEps" | "yearAgoRevenue",
): AnalystEstimateRecord | null {
  if (!estimate || typeof estimate !== "object") return null;
  const record = estimate as Record<string, unknown>;
  const average = financeRawNumber(record.avg);
  const low = financeRawNumber(record.low);
  const high = financeRawNumber(record.high);
  const analysts = financeRawNumber(record.numberOfAnalysts);
  const yearAgo = financeRawNumber(record[yearAgoKey]);
  const growth = financeRawNumber(record.growth);
  if (
    average == null
    && low == null
    && high == null
    && analysts == null
    && yearAgo == null
    && growth == null
  ) {
    return null;
  }
  return {
    date: trend.endDate ?? "",
    period: normalizeYahooRecommendationPeriod(trend.period),
    analysts,
    average,
    low,
    high,
    yearAgo,
    growth,
  };
}

function yahooTimestampDate(value: number | undefined): string | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

function computeExtendedHoursChange(
  extPrice: number | undefined,
  regularPrice: number | undefined,
): { change?: number; changePct?: number } {
  if (extPrice == null || regularPrice == null || regularPrice === 0) return {};
  const change = extPrice - regularPrice;
  return { change, changePct: (change / regularPrice) * 100 };
}
