import { useCallback, useMemo } from "react";
import { EmptyState } from "../../components";
import { ComparisonStockChart } from "../../components/chart/comparison-stock-chart";
import type { ChartAxisMode, TimeRange } from "../../components/chart/chart-types";
import {
  DEFAULT_COMPARISON_CHART_RANGE_PRESET,
  DEFAULT_COMPARISON_CHART_RESOLUTION,
  normalizeChartResolution,
} from "../../components/chart/chart-resolution";
import { getSharedRegistry } from "../../plugins/registry";
import { useAppState } from "../../state/app-context";
import { colors } from "../../theme/colors";
import type { GloomPlugin, PaneProps, PaneSettingsDef } from "../../types/plugin";
import { formatTickerListInput, MAX_TICKER_LIST_SIZE, parseTickerListInput } from "../../utils/ticker-list";

export const COMPARISON_CHART_PANE_ID = "comparison-chart";
export const COMPARISON_CHART_TEMPLATE_ID = "comparison-chart-pane";

interface ComparisonChartPaneSettings {
  axisMode: ChartAxisMode;
  rangePreset: TimeRange;
  chartResolution: ReturnType<typeof normalizeChartResolution>;
  symbols: string[];
  symbolsText: string;
}

function isChartAxisMode(value: unknown): value is ChartAxisMode {
  return value === "price" || value === "percent";
}

function coerceSymbolList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const parsed = value.filter((entry): entry is string => typeof entry === "string");
  try {
    return parseTickerListInput(parsed.join(", "), MAX_TICKER_LIST_SIZE);
  } catch {
    return parsed.slice(0, MAX_TICKER_LIST_SIZE);
  }
}

export function getComparisonChartPaneSettings(settings: Record<string, unknown> | undefined): ComparisonChartPaneSettings {
  const storedSymbols = coerceSymbolList(settings?.symbols);
  const storedText = typeof settings?.symbolsText === "string" ? settings.symbolsText : "";
  let symbols = storedSymbols;

  if (symbols.length === 0 && storedText.trim().length > 0) {
    try {
      symbols = parseTickerListInput(storedText, MAX_TICKER_LIST_SIZE);
    } catch {
      symbols = [];
    }
  }

  return {
    axisMode: isChartAxisMode(settings?.axisMode) ? settings.axisMode : "price",
    rangePreset: settings?.rangePreset === "1D"
      || settings?.rangePreset === "1W"
      || settings?.rangePreset === "1M"
      || settings?.rangePreset === "3M"
      || settings?.rangePreset === "6M"
      || settings?.rangePreset === "1Y"
      || settings?.rangePreset === "5Y"
      || settings?.rangePreset === "ALL"
      ? settings.rangePreset
      : DEFAULT_COMPARISON_CHART_RANGE_PRESET,
    chartResolution: normalizeChartResolution(settings?.chartResolution, DEFAULT_COMPARISON_CHART_RESOLUTION),
    symbols,
    symbolsText: storedText.trim().length > 0 ? storedText : formatTickerListInput(symbols),
  };
}

function buildComparisonChartSettingsDef(): PaneSettingsDef {
  return {
    title: "Comparison Chart Settings",
    fields: [
      {
        key: "symbolsText",
        label: "Tickers",
        description: `Enter 1-${MAX_TICKER_LIST_SIZE} tickers separated by commas.`,
        type: "text",
        placeholder: "AAPL, MSFT, NVDA",
      },
      {
        key: "axisMode",
        label: "Chart Y-Axis",
        description: "Show prices or percent change from the first visible point on the shared chart.",
        type: "select",
        options: [
          { value: "price", label: "Price" },
          { value: "percent", label: "Percent" },
        ],
      },
    ],
  };
}

export function buildComparisonChartPaneTitle(symbols: string[]): string {
  if (symbols.length === 0) return "Compare";
  if (symbols.length <= 3) return symbols.join(" · ");
  return `${symbols.slice(0, 2).join(" · ")} +${symbols.length - 2}`;
}
function ComparisonChartPane({ paneId, focused, width, height }: PaneProps) {
  const registry = getSharedRegistry();
  const { state } = useAppState();
  const pane = state.config.layout.instances.find((instance) => instance.instanceId === paneId);
  const settings = useMemo(() => getComparisonChartPaneSettings(pane?.settings), [pane?.settings]);

  const openTicker = useCallback((symbol: string) => {
    registry?.selectTickerFn(symbol);
    registry?.focusPaneFn("ticker-detail");
  }, [registry]);

  if (settings.symbols.length === 0) {
    return (
      <box flexDirection="column" flexGrow={1} padding={1}>
        <EmptyState title="No comparison tickers configured." message="Open pane settings to add up to 10 tickers." />
      </box>
    );
  }

  return (
    <box flexDirection="column" flexGrow={1} paddingX={1} backgroundColor={colors.panel}>
      <ComparisonStockChart
        paneId={paneId}
        width={Math.max(width - 2, 20)}
        height={Math.max(height, 8)}
        focused={focused}
        symbols={settings.symbols}
        axisMode={settings.axisMode}
        onOpenSymbol={openTicker}
      />
    </box>
  );
}

export const comparisonChartPlugin: GloomPlugin = {
  id: "comparison-chart",
  name: "Comparison Chart",
  version: "1.0.0",
  panes: [
    {
      id: COMPARISON_CHART_PANE_ID,
      name: "Compare",
      icon: "C",
      component: ComparisonChartPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultWidth: "50%",
      settings: buildComparisonChartSettingsDef(),
    },
  ],
  paneTemplates: [
    {
      id: COMPARISON_CHART_TEMPLATE_ID,
      paneId: COMPARISON_CHART_PANE_ID,
      label: "Comparison Chart",
      description: "Compare up to 10 ticker charts overlaid on one chart.",
      keywords: ["compare", "comparison", "chart", "multi", "ticker"],
      shortcut: { prefix: "CMP", argPlaceholder: "tickers", argKind: "ticker-list" },
      wizard: [
        {
          key: "tickers",
          label: "Comparison Tickers",
          placeholder: "AAPL, MSFT, NVDA",
          body: [
            `Enter 1-${MAX_TICKER_LIST_SIZE} ticker symbols separated by commas.`,
          ],
          type: "text",
        },
      ],
      canCreate: (_context, options) => !options?.symbols || options.symbols.length > 0,
      createInstance: (_context, options) => {
        const symbols = options?.symbols ?? [];
        if (symbols.length === 0) return null;
        return {
          title: buildComparisonChartPaneTitle(symbols),
          placement: "floating",
          settings: {
            axisMode: "percent",
            rangePreset: DEFAULT_COMPARISON_CHART_RANGE_PRESET,
            chartResolution: DEFAULT_COMPARISON_CHART_RESOLUTION,
            symbols,
            symbolsText: formatTickerListInput(symbols),
          },
        };
      },
    },
  ],
};
