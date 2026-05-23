import { usePaneTicker } from "../../state/app-context";
import { ResolvedStockChart } from "./stock-chart/resolved";
import type { StockChartProps } from "./stock-chart/types";

export type {
  StockChartProps,
} from "./stock-chart/types";

export { ResolvedStockChart } from "./stock-chart/resolved";

export {
  resolveAutoDisplayState,
  resolveAutoPlanningWindow,
  resolveAutoZoomWindow,
} from "./stock-chart/auto";
export {
  computeProjectedIndicatorOverlays,
  resolveIndicatorBufferRange,
} from "./stock-chart/indicators";
export {
  resolveAdjacentSelectionCursorX,
  resolveChartKeyboardKey,
} from "./stock-chart/keyboard";

export function StockChart(props: StockChartProps) {
  const { ticker, financials } = usePaneTicker();
  return <ResolvedStockChart {...props} ticker={ticker} financials={financials} />;
}
