import type { PricePoint } from "../../types/financials";

export type TimeRange = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "5Y" | "ALL";
export type ChartResolution = "auto" | "1m" | "5m" | "15m" | "30m" | "45m" | "1h" | "1d" | "1wk" | "1mo";
export type ChartRenderMode = "area" | "line" | "candles" | "ohlc";
export type ChartAxisMode = "price" | "percent";
export type ChartRendererPreference = "auto" | "kitty" | "braille";
export type ResolvedChartRenderer = "kitty" | "braille";
export type ComparisonChartRenderMode = "area" | "line";

export const TIME_RANGES: TimeRange[] = ["1D", "1W", "1M", "3M", "6M", "1Y", "5Y", "ALL"];
export const CHART_RENDER_MODES: ChartRenderMode[] = ["area", "line", "candles", "ohlc"];
export const CHART_AXIS_MODES: ChartAxisMode[] = ["price", "percent"];
export const CHART_RENDERER_PREFERENCES: ChartRendererPreference[] = ["auto", "kitty", "braille"];
export const COMPARISON_RENDER_MODES: ComparisonChartRenderMode[] = ["area", "line"];

/** Number of trading days for each time range */
export const RANGE_DAYS: Record<TimeRange, number> = {
  "1D": 1,
  "1W": 5,
  "1M": 21,
  "3M": 63,
  "6M": 126,
  "1Y": 252,
  "5Y": 1260,
  "ALL": Infinity,
};

export interface ChartViewState {
  presetRange: TimeRange;
  bufferRange: TimeRange;
  activePreset: TimeRange | null;
  resolution: ChartResolution;
  panOffset: number;   // data points shifted left from right edge (0 = most recent)
  zoomLevel: number;   // 1.0 = full selected range, 2.0 = zoomed in 2x
  cursorX: number | null; // local plot x in cell units; may be fractional with pixel mouse
  cursorY: number | null; // local plot y in cell units; may be fractional with pixel mouse
  renderMode?: ChartRenderMode;
}

export interface Pixel {
  color: string;
  layer: number;
}

export interface PixelBuffer {
  width: number;
  height: number; // virtual pixel rows (4x terminal rows for braille rendering)
  pixels: (Pixel | null)[][]; // [y][x] = pixel with color and layer, or null
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

export interface ComparisonChartSeries {
  symbol: string;
  color: string;
  fillColor: string;
  currency?: string;
  points: PricePoint[];
}

export interface ComparisonChartViewState {
  presetRange: TimeRange;
  bufferRange: TimeRange;
  activePreset: TimeRange | null;
  resolution: ChartResolution;
  panOffset: number;
  zoomLevel: number; // 1.0 = full selected range, 2.0 = zoomed in 2x
  cursorX: number | null;
  cursorY: number | null;
  renderMode?: ComparisonChartRenderMode;
  selectedSymbol: string | null;
}
