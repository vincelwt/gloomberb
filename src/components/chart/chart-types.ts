import type { PricePoint } from "../../types/financials";

export type TimeRange = "1W" | "1M" | "3M" | "6M" | "1Y" | "5Y" | "ALL";
export type ChartRenderMode = "area" | "line" | "candles" | "ohlc";

export const TIME_RANGES: TimeRange[] = ["1W", "1M", "3M", "6M", "1Y", "5Y", "ALL"];
export const CHART_RENDER_MODES: ChartRenderMode[] = ["area", "line", "candles", "ohlc"];

/** Number of trading days for each time range */
export const RANGE_DAYS: Record<TimeRange, number> = {
  "1W": 5,
  "1M": 21,
  "3M": 63,
  "6M": 126,
  "1Y": 252,
  "5Y": 1260,
  "ALL": Infinity,
};

export interface ChartViewState {
  timeRange: TimeRange;
  panOffset: number;   // data points shifted left from right edge (0 = most recent)
  zoomLevel: number;   // 1.0 = default, 2.0 = zoomed in 2x
  cursorX: number | null; // column position of crosshair (null = hidden)
  renderMode?: ChartRenderMode;
}

export interface PixelBuffer {
  width: number;
  height: number; // virtual pixel rows (2x terminal rows)
  pixels: (string | null)[][]; // [y][x] = hex color or null for transparent
}

export interface ChartColors {
  lineColor: string;
  fillColor: string;
  volumeUp: string;
  volumeDown: string;
  gridColor: string;
  crosshairColor: string;
  bgColor: string;
  axisColor: string;
  activeRangeColor: string;
  inactiveRangeColor: string;
}

export interface VisibleWindow {
  points: PricePoint[];
  startIdx: number;
  endIdx: number;
}
