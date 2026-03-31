import { useTerminalDimensions } from "@opentui/react";
import type { ChartAxisMode } from "../../../components/chart/chart-types";
import { StockChart } from "../../../components/chart/stock-chart";

export function ChartTab({
  width,
  height,
  focused,
  interactive,
  axisMode,
  onActivate,
}: {
  width?: number;
  height?: number;
  focused: boolean;
  interactive: boolean;
  axisMode: ChartAxisMode;
  onActivate?: () => void;
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
      <StockChart
        width={chartWidth}
        height={chartHeight}
        focused={focused}
        interactive={interactive}
        axisMode={axisMode}
      />
    </box>
  );
}
