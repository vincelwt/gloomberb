
export function parseEarningsDate(raw: any): Date | null {
  if (!raw?.raw) return null;
  return new Date(raw.raw * 1000);
}

function rawNumber(value: any): number | null {
  return typeof value?.raw === "number" ? value.raw : null;
}

function inferTiming(date: Date): "BMO" | "AMC" | "TNS" | "" {
  const hour = date.getUTCHours();
  if (hour >= 20) return "AMC";
  if (hour <= 13) return "BMO";
  return "";
}

export interface RawEarningsModules {
  calendarEvents?: {
    earnings?: {
      earningsDate?: Array<{ raw: number }>;
      earningsCallDate?: Array<{ raw: number }>;
      isEarningsDateEstimate?: boolean;
      earningsAverage?: { raw: number };
      earningsLow?: { raw: number };
      earningsHigh?: { raw: number };
      revenueAverage?: { raw: number };
      revenueLow?: { raw: number };
      revenueHigh?: { raw: number };
    };
  };
  earningsTrend?: {
    trend?: Array<{
      period: string;
      earningsEstimate?: {
        avg?: { raw: number };
        low?: { raw: number };
        high?: { raw: number };
        yearAgoEps?: { raw: number };
        numberOfAnalysts?: { raw: number };
        growth?: { raw: number };
      };
      revenueEstimate?: {
        avg?: { raw: number };
        low?: { raw: number };
        high?: { raw: number };
        yearAgoRevenue?: { raw: number };
        numberOfAnalysts?: { raw: number };
        growth?: { raw: number };
      };
      epsTrend?: {
        current?: { raw: number };
        "7daysAgo"?: { raw: number };
        "30daysAgo"?: { raw: number };
      };
      epsRevisions?: {
        upLast7days?: { raw: number };
        upLast30days?: { raw: number };
        downLast7Days?: { raw: number };
        downLast30days?: { raw: number };
      };
    }>;
  };
}

export function parseEarningsModules(
  symbol: string,
  name: string,
  modules: RawEarningsModules,
): import("../../../types/data-provider").EarningsEvent | null {
  const cal = modules?.calendarEvents;
  if (!cal?.earnings) return null;

  const dates = cal.earnings.earningsDate;
  if (!Array.isArray(dates) || dates.length === 0) return null;

  const earningsDate = parseEarningsDate(dates[0]);
  if (!earningsDate) return null;

  const currentQtr = modules?.earningsTrend?.trend?.find((t) => t.period === "0q");
  const earningsEstimate = currentQtr?.earningsEstimate;
  const revenueEstimate = currentQtr?.revenueEstimate;
  const epsTrend = currentQtr?.epsTrend;
  const epsRevisions = currentQtr?.epsRevisions;

  return {
    symbol,
    name,
    earningsDate,
    earningsCallDate: parseEarningsDate(cal.earnings.earningsCallDate?.[0]) ?? null,
    isDateEstimate: cal.earnings.isEarningsDateEstimate ?? null,
    epsEstimate: rawNumber(earningsEstimate?.avg) ?? rawNumber(cal.earnings.earningsAverage),
    epsLow: rawNumber(earningsEstimate?.low) ?? rawNumber(cal.earnings.earningsLow),
    epsHigh: rawNumber(earningsEstimate?.high) ?? rawNumber(cal.earnings.earningsHigh),
    epsYearAgo: rawNumber(earningsEstimate?.yearAgoEps),
    epsGrowth: rawNumber(earningsEstimate?.growth),
    epsAnalysts: rawNumber(earningsEstimate?.numberOfAnalysts),
    epsTrend7dAgo: rawNumber(epsTrend?.["7daysAgo"]),
    epsTrend30dAgo: rawNumber(epsTrend?.["30daysAgo"]),
    epsRevisionUp7d: rawNumber(epsRevisions?.upLast7days),
    epsRevisionUp30d: rawNumber(epsRevisions?.upLast30days),
    epsRevisionDown7d: rawNumber(epsRevisions?.downLast7Days),
    epsRevisionDown30d: rawNumber(epsRevisions?.downLast30days),
    epsActual: null,
    revenueEstimate: rawNumber(revenueEstimate?.avg) ?? rawNumber(cal.earnings.revenueAverage),
    revenueLow: rawNumber(revenueEstimate?.low) ?? rawNumber(cal.earnings.revenueLow),
    revenueHigh: rawNumber(revenueEstimate?.high) ?? rawNumber(cal.earnings.revenueHigh),
    revenueYearAgo: rawNumber(revenueEstimate?.yearAgoRevenue),
    revenueGrowth: rawNumber(revenueEstimate?.growth),
    revenueAnalysts: rawNumber(revenueEstimate?.numberOfAnalysts),
    revenueActual: null,
    surprise: null,
    timing: inferTiming(earningsDate),
  };
}
