import type { PaneHint } from "../../layout/pane-footer";
import type { PricePoint, TickerFinancials } from "../../../types/financials";
import type { TickerRecord } from "../../../types/ticker";
import type { ChartAxisMode } from "../chart-types";
import type { IndicatorConfig } from "../indicators/types";

export interface StockChartProps {
  width: number;
  height: number;
  focused: boolean;
  interactive?: boolean;
  onActivate?: () => void;
  compact?: boolean;
  axisMode?: ChartAxisMode;
  historyOverride?: PricePoint[] | null;
  currencyOverride?: string | null;
  indicatorConfig?: IndicatorConfig;
  showVolume?: boolean;
  footerHints?: PaneHint[];
}

export interface ResolvedStockChartProps extends StockChartProps {
  ticker: TickerRecord | null;
  financials: TickerFinancials | null;
}
