import { useTerminalDimensions } from "@opentui/react";
import type { ChartAxisMode } from "../../../components/chart/chart-types";
import { ResolvedStockChart } from "../../../components/chart/stock-chart";
import type { TickerFinancials } from "../../../types/financials";
import type { TickerRecord } from "../../../types/ticker";

export function ChartTab({
  width,
  height,
  focused,
  interactive,
  axisMode,
  onActivate,
  symbol,
  ticker,
  financials,
}: {
  width?: number;
  height?: number;
  focused: boolean;
  interactive: boolean;
  axisMode: ChartAxisMode;
  onActivate?: () => void;
  symbol: string | null;
  ticker: TickerRecord | null;
  financials: TickerFinancials | null;
}) {
  const { width: termWidth, height: termHeight } = useTerminalDimensions();

  const chartWidth = Math.max((width || Math.floor(termWidth * 0.55)) - 2, 30);
  const chartHeight = Math.max((height || termHeight - 8) - 2, 10);

  return (
    <box
      flexDirection="column"
      paddingX={1}
      flexGrow={1}
      onMouseDown={() => {
        if (!interactive) onActivate?.();
      }}
    >
      <ResolvedStockChart
        width={chartWidth}
        height={chartHeight}
        focused={focused}
        interactive={interactive}
        axisMode={axisMode}
        symbol={symbol}
        ticker={ticker}
        financials={financials}
      />
    </box>
  );
}
