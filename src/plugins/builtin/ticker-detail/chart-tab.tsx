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
import { useAppDispatch, useAppSelector } from "../../../state/app-context";
import { scheduleConfigSave } from "../../../state/config-save-scheduler";
import type { TickerFinancials } from "../../../types/financials";
import type { TickerRecord } from "../../../types/ticker";
import { getSharedRegistry } from "../../registry";

const TICKER_DETAIL_PLUGIN_ID = "ticker-detail";

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
  const dispatch = useAppDispatch();
  const config = useAppSelector((state) => state.config);

  const chartWidth = Math.max((width || Math.floor(termWidth * 0.55)) - 2, 30);
  const chartHeight = Math.max(height ?? termHeight - 8, 10);
  const rawIndicatorSelection = config.pluginConfig[TICKER_DETAIL_PLUGIN_ID]?.[CHART_INDICATORS_PLUGIN_CONFIG_KEY];
  const indicatorSelectionVersion = config.pluginConfig[TICKER_DETAIL_PLUGIN_ID]?.[CHART_INDICATORS_PLUGIN_CONFIG_VERSION_KEY];
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
    const nextConfig = {
      ...config,
      pluginConfig: {
        ...config.pluginConfig,
        [TICKER_DETAIL_PLUGIN_ID]: {
          ...(config.pluginConfig[TICKER_DETAIL_PLUGIN_ID] ?? {}),
          [CHART_INDICATORS_PLUGIN_CONFIG_KEY]: normalized,
          [CHART_INDICATORS_PLUGIN_CONFIG_VERSION_KEY]: CURRENT_CHART_INDICATORS_CONFIG_VERSION,
        },
      },
    };
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    scheduleConfigSave(nextConfig);
    getSharedRegistry()?.events.emit("config:changed", { config: nextConfig });
  }, [config, dispatch]);

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
