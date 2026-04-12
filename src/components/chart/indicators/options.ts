import type { IndicatorConfig } from "./types";

export const CHART_INDICATORS_PLUGIN_CONFIG_KEY = "chartIndicators";
export const CHART_INDICATORS_PLUGIN_CONFIG_VERSION_KEY = "chartIndicatorsVersion";
export const CURRENT_CHART_INDICATORS_CONFIG_VERSION = 2;

export type ChartIndicatorId =
  | "volume"
  | "sma20"
  | "sma50"
  | "sma200"
  | "ema20"
  | "bollinger20";

export interface ChartIndicatorOption {
  id: ChartIndicatorId;
  label: string;
  compactLabel: string;
  description: string;
}

export const CHART_INDICATOR_OPTIONS: ChartIndicatorOption[] = [
  {
    id: "volume",
    label: "Volume",
    compactLabel: "VOL",
    description: "Volume bars below the price chart.",
  },
  {
    id: "sma20",
    label: "SMA 20",
    compactLabel: "S20",
    description: "20-period simple moving average.",
  },
  {
    id: "sma50",
    label: "SMA 50",
    compactLabel: "S50",
    description: "50-period simple moving average.",
  },
  {
    id: "sma200",
    label: "SMA 200",
    compactLabel: "S200",
    description: "200-period simple moving average.",
  },
  {
    id: "ema20",
    label: "EMA 20",
    compactLabel: "E20",
    description: "20-period exponential moving average.",
  },
  {
    id: "bollinger20",
    label: "Bollinger 20",
    compactLabel: "BB20",
    description: "20-period Bollinger Bands at two standard deviations.",
  },
];

const CHART_INDICATOR_IDS = new Set<string>(CHART_INDICATOR_OPTIONS.map((option) => option.id));
export const DEFAULT_CHART_INDICATOR_SELECTION: ChartIndicatorId[] = ["volume"];

export function isChartIndicatorId(value: unknown): value is ChartIndicatorId {
  return typeof value === "string" && CHART_INDICATOR_IDS.has(value);
}

export function normalizeChartIndicatorSelection(value: unknown): ChartIndicatorId[] {
  if (!Array.isArray(value)) return [];

  const selected = new Set(value.filter(isChartIndicatorId));
  return CHART_INDICATOR_OPTIONS
    .map((option) => option.id)
    .filter((id) => selected.has(id));
}

export function resolveChartIndicatorSelection(value: unknown, version: unknown): ChartIndicatorId[] {
  if (!Array.isArray(value)) return [...DEFAULT_CHART_INDICATOR_SELECTION];

  const normalized = normalizeChartIndicatorSelection(value);
  if (version === CURRENT_CHART_INDICATORS_CONFIG_VERSION) return normalized;

  return normalizeChartIndicatorSelection([
    ...DEFAULT_CHART_INDICATOR_SELECTION,
    ...normalized,
  ]);
}

export function buildIndicatorConfigFromSelection(selection: readonly ChartIndicatorId[]): IndicatorConfig {
  const selected = new Set(selection);
  const sma: number[] = [];
  const ema: number[] = [];
  const config: IndicatorConfig = {};

  if (selected.has("sma20")) sma.push(20);
  if (selected.has("sma50")) sma.push(50);
  if (selected.has("sma200")) sma.push(200);
  if (selected.has("ema20")) ema.push(20);

  if (sma.length > 0) config.sma = sma;
  if (ema.length > 0) config.ema = ema;
  if (selected.has("bollinger20")) {
    config.bollinger = { period: 20, stdDev: 2 };
  }

  return config;
}
