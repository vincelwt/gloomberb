export function parseEarningsDate(raw: any): Date | null {
  if (!raw?.raw) return null;
  return new Date(raw.raw * 1000);
}

export interface RawEarningsModules {
  calendarEvents?: {
    earnings?: {
      earningsDate?: Array<{ raw: number }>;
      earningsAverage?: { raw: number };
      revenueAverage?: { raw: number };
    };
  };
  earningsTrend?: {
    trend?: Array<{
      period: string;
      earningsEstimate?: { avg?: { raw: number } };
      revenueEstimate?: { avg?: { raw: number } };
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

  return {
    symbol,
    name,
    earningsDate,
    epsEstimate: currentQtr?.earningsEstimate?.avg?.raw ?? cal.earnings.earningsAverage?.raw ?? null,
    epsActual: null,
    revenueEstimate: currentQtr?.revenueEstimate?.avg?.raw ?? cal.earnings.revenueAverage?.raw ?? null,
    revenueActual: null,
    surprise: null,
    timing: "",
  };
}
