import type {
  ChartPanelSpec,
  PanelScale,
  ResolvedSeries,
  TimeSeriesPoint,
} from "../../../time-series/types";

export type CompositeAxisSide = "left" | "right";

export interface CompositeChartColors {
  background: string;
  grid: string;
  crosshair: string;
  text: string;
  textDim: string;
  negative: string;
}

export interface CompositeAxisDomain {
  side: CompositeAxisSide;
  min: number;
  max: number;
  scale: PanelScale;
  unit: string;
  unitGroup: string;
  seriesIds: string[];
}

export interface CompositeProjectedPoint {
  point: TimeSeriesPoint;
  timestamp: number;
  value: number;
  xRatio: number;
  yRatio: number;
  /** True when this point starts after a null, invalid, or log-hidden gap. */
  breakBefore: boolean;
}

export interface CompositeProjectedSeries {
  source: ResolvedSeries;
  points: CompositeProjectedPoint[];
}

export interface CompositePanelScene {
  id: string;
  label?: string;
  height: number;
  scale: PanelScale;
  axes: Partial<Record<CompositeAxisSide, CompositeAxisDomain>>;
  series: CompositeProjectedSeries[];
}

export interface CompositeCursorValue {
  seriesId: string;
  label: string;
  color: string;
  unit: string;
  value: number | null;
  point: TimeSeriesPoint | null;
}

export interface CompositeChartScene {
  width: number;
  height: number;
  startTime: number;
  endTime: number;
  dates: Date[];
  panels: CompositePanelScene[];
  cursorDate: Date | null;
  cursorXRatio: number | null;
  cursorValues: CompositeCursorValue[];
}

export interface BuildCompositeChartSceneOptions {
  width: number;
  height: number;
  cursorDate?: Date | null;
  viewport?: {
    start: Date;
    end: Date;
  };
}

export interface CompositeChartProps {
  series: ResolvedSeries[];
  panels: ChartPanelSpec[];
  width: number;
  height: number;
  focused?: boolean;
  interactive?: boolean;
  cursorDate?: Date | null;
  viewport?: {
    start: Date;
    end: Date;
  };
  colors?: Partial<CompositeChartColors>;
  axisWidth?: number;
  showLegend?: boolean;
  showTimeAxis?: boolean;
  emptyMessage?: string;
  formatValue?: (value: number, series: ResolvedSeries) => string;
  onCursorDateChange?: (date: Date | null) => void;
  onToggleSeries?: (seriesId: string) => void;
  isSeriesToggleable?: (series: ResolvedSeries) => boolean;
}
