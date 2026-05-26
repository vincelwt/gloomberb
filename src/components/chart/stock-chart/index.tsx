import { usePaneTicker } from "../../../state/app/context";
import { ResolvedStockChart } from "./resolved";
import type { StockChartProps } from "./types";

export type {
  StockChartProps,
} from "./types";

export { ResolvedStockChart } from "./resolved";

export {
  isAutoWindowOverridePending,
  resolveAutoDisplayState,
  resolveAutoPlanningWindow,
  resolveAutoZoomWindow,
} from "./auto";
export {
  computeProjectedIndicatorOverlays,
  resolveIndicatorBufferRange,
} from "./indicators";
export {
  resolveAdjacentSelectionCursorX,
  resolveChartKeyboardKey,
} from "./keyboard";

export function StockChart(props: StockChartProps) {
  const { ticker, financials } = usePaneTicker();
  return <ResolvedStockChart {...props} ticker={ticker} financials={financials} />;
}
