import type { ChartAxisMode, ChartColors } from "../chart-types";

export interface ComparisonStockChartProps {
  paneId: string;
  width: number;
  height: number;
  focused: boolean;
  symbols: string[];
  axisMode: ChartAxisMode;
  onOpenSymbol: (symbol: string) => void;
  onEditTickers?: () => void;
}

export type ComparisonChartColors = Pick<
  ChartColors,
  "bgColor" | "gridColor" | "crosshairColor" | "preMarketBgColor" | "postMarketBgColor"
>;

export type PendingExpansionAction =
  | { kind: "zoom-out"; targetVisibleCount: number; anchorRatio: number }
  | { kind: "pan-left"; targetPanOffset: number }
  | null;
