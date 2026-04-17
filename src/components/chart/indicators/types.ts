
/** A single data point for an overlay line drawn on the main chart */
export interface OverlayPoint {
  index: number;
  value: number;
}

/** A single data point for an oscillator drawn in a sub-panel */
export interface OscillatorPoint {
  index: number;
  value: number;
}

/** MACD has three series: macd line, signal line, histogram */
export interface MacdResult {
  macd: OscillatorPoint[];
  signal: OscillatorPoint[];
  histogram: OscillatorPoint[];
}

/** Bollinger Bands: upper, middle (SMA), lower */
export interface BollingerResult {
  upper: OverlayPoint[];
  middle: OverlayPoint[];
  lower: OverlayPoint[];
}

/** Active indicator configuration for a chart pane */
export interface IndicatorConfig {
  sma?: number[];        // e.g. [20, 50, 200]
  ema?: number[];        // e.g. [12, 26]
  rsi?: number | null;   // e.g. 14
  macd?: { fast: number; slow: number; signal: number } | null;
  bollinger?: { period: number; stdDev: number } | null;
}

export const DEFAULT_INDICATOR_CONFIG: IndicatorConfig = {};
