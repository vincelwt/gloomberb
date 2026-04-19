import { Box } from "../../../ui";
import { useViewport } from "../../../react/input";
import { useCallback, useMemo } from "react";
import { ChartIndicatorSelector } from "../../../components/chart/chart-indicator-selector";
import {
  buildIndicatorConfigFromSelection,
  CHART_INDICATORS_PLUGIN_CONFIG_VERSION_KEY,
  CURRENT_CHART_INDICATORS_CONFIG_VERSION,
  CHART_INDICATORS_PLUGIN_CONFIG_KEY,
  resolveChartIndicatorSelection,
  normalizeChartIndicatorSelection,
  type ChartIndicatorId,
} from "../../../components/chart/indicators/options";
import type { ChartAxisMode } from "../../../components/chart/chart-types";
import { ResolvedStockChart } from "../../../components/chart/stock-chart";
import type { TickerFinancials } from "../../../types/financials";
import type { TickerRecord } from "../../../types/ticker";
import { usePluginConfigState, useSetPluginConfigStates } from "../../plugin-runtime";

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
  const { width: termWidth, height: termHeight } = useViewport();
  const [rawIndicatorSelection] = usePluginConfigState<unknown>(CHART_INDICATORS_PLUGIN_CONFIG_KEY, null);
  const [indicatorSelectionVersion] = usePluginConfigState<unknown>(CHART_INDICATORS_PLUGIN_CONFIG_VERSION_KEY, null);
  const setPluginConfigStates = useSetPluginConfigStates();

  const chartWidth = Math.max((width || Math.floor(termWidth * 0.55)) - 2, 30);
  const chartHeight = Math.max(height ?? termHeight - 8, 10);
  const hasStoredIndicatorSelection = Array.isArray(rawIndicatorSelection);
  const selectedIndicatorIds = useMemo(
    () => resolveChartIndicatorSelection(rawIndicatorSelection, indicatorSelectionVersion),
    [indicatorSelectionVersion, rawIndicatorSelection],
  );
  const selectedIndicatorConfig = useMemo(
    () => buildIndicatorConfigFromSelection(selectedIndicatorIds),
    [selectedIndicatorIds],
  );
  const showVolume = selectedIndicatorIds.includes("volume");
  const persistIndicatorSelection = useCallback((nextSelection: ChartIndicatorId[]) => {
    const normalized = normalizeChartIndicatorSelection(nextSelection);
    setPluginConfigStates({
      [CHART_INDICATORS_PLUGIN_CONFIG_KEY]: normalized,
      [CHART_INDICATORS_PLUGIN_CONFIG_VERSION_KEY]: CURRENT_CHART_INDICATORS_CONFIG_VERSION,
    });
  }, [setPluginConfigStates]);

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      flexGrow={1}
    >
      <Box
        flexDirection="column"
        flexGrow={1}
        onMouseDown={() => {
          if (!interactive) onActivate?.();
        }}
      >
        <ChartIndicatorSelector
          width={chartWidth}
          selectedIds={selectedIndicatorIds}
          onChange={persistIndicatorSelection}
          variant="pane-hint"
          shortcutActive={focused}
        />
        <ResolvedStockChart
          width={chartWidth}
          height={chartHeight}
          focused={focused}
          interactive={interactive}
          onActivate={onActivate}
          axisMode={axisMode}
          symbol={symbol}
          ticker={ticker}
          financials={financials}
          indicatorConfig={hasStoredIndicatorSelection ? selectedIndicatorConfig : undefined}
          showVolume={showVolume}
        />
      </Box>
    </Box>
  );
}
