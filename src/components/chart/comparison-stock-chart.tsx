import { MemoizedComparisonStockChartView } from "./comparison-stock-chart/view";
import { useComparisonChartSymbolSources } from "./comparison-stock-chart/sources";
import type { ComparisonStockChartProps } from "./comparison-stock-chart/types";

export type { ComparisonStockChartProps } from "./comparison-stock-chart/types";

export function ComparisonStockChart(props: ComparisonStockChartProps) {
  const {
    defaultRenderMode,
    preferredRenderer,
    stableSymbols,
    symbolSources,
  } = useComparisonChartSymbolSources(props.symbols);

  return (
    <MemoizedComparisonStockChartView
      {...props}
      symbols={stableSymbols}
      defaultRenderMode={defaultRenderMode}
      preferredRenderer={preferredRenderer}
      symbolSources={symbolSources}
    />
  );
}
