import { useMemo } from "react";
import { useThemeColors } from "../../../theme/theme-context";
import type { TickerRecord } from "../../../types/ticker";
import {
  resolveChartPalette,
  type ResolvedChartPalette,
} from "../core/renderer";
import type {
  ChartMarketSession,
} from "../core/types";
import {
  getChartMarketSessionKey,
  resolveChartMarketSession,
} from "../market-session";
import type { ProjectedChartPoint } from "../core/data";

export function useStockChartPresentation({
  chartWindowPoints,
  ticker,
}: {
  chartWindowPoints: ProjectedChartPoint[];
  ticker: TickerRecord | null;
}): {
  chartColors: ResolvedChartPalette;
  marketSession: ChartMarketSession | null;
  marketSessionKey: string;
} {
  const themeColors = useThemeColors();
  const chartColors = useMemo(() => {
    const rawChange = chartWindowPoints.length >= 2
      ? chartWindowPoints[chartWindowPoints.length - 1]!.close - chartWindowPoints[0]!.close
      : 0;
    const trend = rawChange < 0 ? "negative" : rawChange > 0 ? "positive" : "neutral";
    return resolveChartPalette({
      bg: themeColors.bg,
      border: themeColors.border,
      borderFocused: themeColors.borderFocused,
      text: themeColors.text,
      textDim: themeColors.textDim,
      positive: themeColors.positive,
      negative: themeColors.negative,
    }, trend);
  }, [
    chartWindowPoints,
    themeColors.bg,
    themeColors.border,
    themeColors.borderFocused,
    themeColors.negative,
    themeColors.positive,
    themeColors.text,
    themeColors.textDim,
  ]);
  const marketSession = useMemo(() => resolveChartMarketSession(ticker
    ? [{
      exchange: ticker.metadata.exchange,
      currency: ticker.metadata.currency,
      assetCategory: ticker.metadata.assetCategory,
    }]
    : []), [ticker]);
  const marketSessionKey = useMemo(() => getChartMarketSessionKey(marketSession), [marketSession]);

  return {
    chartColors,
    marketSession,
    marketSessionKey,
  };
}
