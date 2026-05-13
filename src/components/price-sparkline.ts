import type { PricePoint } from "../types/financials";
import { colors } from "../theme/colors";
import { renderChart, resolveChartPalette, type StyledContent } from "./chart/chart-renderer";
import type { ProjectedChartPoint } from "./chart/chart-data";

function coercePointDate(value: PricePoint["date"]): Date {
  return value instanceof Date ? value : new Date(value as Date | string | number);
}

export function renderPriceSparkline(
  priceHistory: PricePoint[],
  options: { width?: number; height?: number; maxPoints?: number } = {},
): StyledContent | null {
  if (priceHistory.length < 2) return null;

  const width = Math.max(4, Math.floor(options.width ?? 10));
  const height = Math.max(1, Math.floor(options.height ?? 1));
  const maxPoints = Math.max(1, Math.floor(options.maxPoints ?? Math.max(20, width * 2)));
  const pointsWindow = priceHistory.slice(-maxPoints);
  const points: ProjectedChartPoint[] = pointsWindow.map((pt) => ({
    date: coercePointDate(pt.date),
    open: pt.open ?? pt.close,
    high: pt.high ?? pt.close,
    low: pt.low ?? pt.close,
    close: pt.close,
    volume: pt.volume ?? 0,
  }));

  const first = pointsWindow[0]?.close ?? 0;
  const last = pointsWindow[pointsWindow.length - 1]?.close ?? 0;
  const trend = last > first ? "positive" : last < first ? "negative" : "neutral";
  const palette = resolveChartPalette(colors, trend);

  const result = renderChart(points, {
    width,
    height,
    showVolume: false,
    volumeHeight: 0,
    cursorX: null,
    cursorY: null,
    mode: "line",
    colors: palette,
  });

  return result.lines[0] ?? null;
}
