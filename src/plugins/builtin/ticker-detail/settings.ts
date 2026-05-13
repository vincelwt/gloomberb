import type { PaneSettingsDef, DetailTabDef } from "../../../types/plugin";
import type { TickerFinancials } from "../../../types/financials";
import type { TickerRecord } from "../../../types/ticker";
import type { AppConfig } from "../../../types/config";
import type { ChartAxisMode, TimeRange } from "../../../components/chart/chart-types";
import {
  DEFAULT_TICKER_CHART_RANGE_PRESET,
  DEFAULT_TICKER_CHART_RESOLUTION,
  normalizeChartResolution,
} from "../../../components/chart/chart-resolution";
import type { PriceSparklinePeriod } from "../../../components/price-sparkline-view";
import { getSharedRegistry } from "../../registry";
import { formatTickerListInput, MAX_TICKER_LIST_SIZE, parseTickerListInput } from "../../../utils/ticker-list";

type DetailTabSummary = { id: string; name: string; order: number };

const CORE_OVERVIEW_TAB: DetailTabSummary = { id: "overview", name: "Overview", order: 10 };
const CORE_FINANCIALS_TAB: DetailTabSummary = { id: "financials", name: "Financials", order: 20 };
const CORE_CHART_TAB: DetailTabSummary = { id: "chart", name: "Chart", order: 30 };

export interface TickerDetailPaneSettings {
  hideTabs: boolean;
  lockedTabId: string;
  chartAxisMode: ChartAxisMode;
  chartRangePreset: TimeRange;
  chartResolution: ReturnType<typeof normalizeChartResolution>;
}

export interface QuoteMonitorPaneSettings {
  symbols: string[];
  symbolsText: string;
  chartPeriod: PriceSparklinePeriod;
}

const DEFAULT_QUOTE_MONITOR_CHART_PERIOD: PriceSparklinePeriod = "1M";

export function getTickerDetailPaneSettings(
  settings: Record<string, unknown> | undefined,
): TickerDetailPaneSettings {
  return {
    hideTabs: settings?.hideTabs === true,
    lockedTabId: typeof settings?.lockedTabId === "string" ? settings.lockedTabId : "overview",
    chartAxisMode: settings?.chartAxisMode === "percent" ? "percent" : "price",
    chartRangePreset: settings?.chartRangePreset === "1D"
      || settings?.chartRangePreset === "1W"
      || settings?.chartRangePreset === "1M"
      || settings?.chartRangePreset === "3M"
      || settings?.chartRangePreset === "6M"
      || settings?.chartRangePreset === "1Y"
      || settings?.chartRangePreset === "5Y"
      || settings?.chartRangePreset === "ALL"
      ? settings.chartRangePreset
      : DEFAULT_TICKER_CHART_RANGE_PRESET,
    chartResolution: normalizeChartResolution(settings?.chartResolution, DEFAULT_TICKER_CHART_RESOLUTION),
  };
}

export function resolveLockedTabId(
  settings: TickerDetailPaneSettings,
  tabs: DetailTabSummary[],
): string {
  if (tabs.some((tab) => tab.id === settings.lockedTabId)) {
    return settings.lockedTabId;
  }
  return tabs[0]?.id ?? "overview";
}

function getAvailableSettingsTabs(): DetailTabSummary[] {
  const registry = getSharedRegistry();
  const pluginTabs = registry
    ? [...registry.detailTabs.values()].map((tab) => ({ id: tab.id, name: tab.name, order: tab.order }))
    : [];

  return [CORE_OVERVIEW_TAB, CORE_FINANCIALS_TAB, CORE_CHART_TAB, ...pluginTabs]
    .sort((left, right) => left.order - right.order)
    .filter((tab, index, allTabs) => allTabs.findIndex((candidate) => candidate.id === tab.id) === index);
}

export function buildTickerDetailSettingsDef(settings: TickerDetailPaneSettings): PaneSettingsDef {
  const tabs = getAvailableSettingsTabs();

  return {
    title: "Detail Pane Settings",
    fields: [
      {
        key: "hideTabs",
        label: "Hide Tabs",
        description: "Hide the detail tabs and lock this pane to one view.",
        type: "toggle" as const,
      },
      ...(settings.hideTabs
        ? [{
          key: "lockedTabId",
          label: "Locked Tab",
          type: "select" as const,
          options: tabs.map((tab) => ({ value: tab.id, label: tab.name })),
        }]
        : []),
      {
        key: "chartAxisMode",
        label: "Chart Y-Axis",
        description: "Show chart values as raw prices or percent change from the first visible point.",
        type: "select" as const,
        options: [
          { value: "price", label: "Price" },
          { value: "percent", label: "Percent" },
        ],
      },
    ],
  };
}

function coerceQuoteMonitorSymbols(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const parsed = value.filter((entry): entry is string => typeof entry === "string");
  try {
    return parseTickerListInput(parsed.join(", "), MAX_TICKER_LIST_SIZE);
  } catch {
    return parsed.slice(0, MAX_TICKER_LIST_SIZE);
  }
}

export function buildQuoteMonitorPaneTitle(symbols: string[]): string {
  if (symbols.length === 0) return "Quote Monitor";
  if (symbols.length <= 3) return symbols.join(" · ");
  return `${symbols.slice(0, 2).join(" · ")} +${symbols.length - 2}`;
}

export function getQuoteMonitorPaneSettings(
  settings: Record<string, unknown> | undefined,
  fallbackSymbol?: string | null,
): QuoteMonitorPaneSettings {
  const storedSymbols = coerceQuoteMonitorSymbols(settings?.symbols);
  const legacySymbol = typeof settings?.symbol === "string" ? settings.symbol.trim() : "";
  const storedText = typeof settings?.symbolsText === "string" ? settings.symbolsText : "";
  let symbols = storedSymbols;

  if (symbols.length === 0 && storedText.trim().length > 0) {
    try {
      symbols = parseTickerListInput(storedText, MAX_TICKER_LIST_SIZE);
    } catch {
      symbols = [];
    }
  }
  if (symbols.length === 0 && legacySymbol) {
    try {
      symbols = parseTickerListInput(legacySymbol, MAX_TICKER_LIST_SIZE);
    } catch {
      symbols = [legacySymbol.toUpperCase()];
    }
  }
  if (symbols.length === 0 && fallbackSymbol) {
    symbols = [fallbackSymbol.toUpperCase()];
  }

  return {
    symbols,
    symbolsText: storedText.trim().length > 0 ? storedText : formatTickerListInput(symbols),
    chartPeriod: settings?.chartPeriod === "1D"
      || settings?.chartPeriod === "1W"
      || settings?.chartPeriod === "1M"
      || settings?.chartPeriod === "1Y"
      ? settings.chartPeriod
      : DEFAULT_QUOTE_MONITOR_CHART_PERIOD,
  };
}

export function buildQuoteMonitorSettingsDef(): PaneSettingsDef {
  return {
    title: "Quote Monitor Settings",
    values: {
      chartPeriod: DEFAULT_QUOTE_MONITOR_CHART_PERIOD,
    },
    fields: [
      {
        key: "symbolsText",
        label: "Tickers",
        description: `Enter up to ${MAX_TICKER_LIST_SIZE} tickers separated by commas.`,
        type: "text",
        placeholder: "AAPL, MSFT, NVDA",
      },
      {
        key: "chartPeriod",
        label: "Chart Period",
        description: "Set the period used for quote sparklines and range labels.",
        type: "select",
        options: [
          { value: "1D", label: "1D" },
          { value: "1W", label: "1W" },
          { value: "1M", label: "1M" },
          { value: "1Y", label: "1Y" },
        ],
      },
    ],
  };
}

function hasStatementFinancials(financials: TickerFinancials | null | undefined): boolean {
  return (financials?.annualStatements.length ?? 0) > 0 || (financials?.quarterlyStatements.length ?? 0) > 0;
}

export function buildVisibleDetailTabs(
  pluginTabs: DetailTabDef[],
  ticker: TickerRecord | null,
  financials: TickerFinancials | null | undefined,
  options: {
    config: AppConfig;
    hasOptionsChain: boolean;
  },
): DetailTabSummary[] {
  const tabs: DetailTabSummary[] = [CORE_OVERVIEW_TAB];
  if (hasStatementFinancials(financials)) {
    tabs.push(CORE_FINANCIALS_TAB);
  }
  tabs.push(CORE_CHART_TAB);

  for (const tab of pluginTabs) {
    if (tab.isVisible && !tab.isVisible({
      config: options.config,
      ticker,
      financials,
      hasOptionsChain: options.hasOptionsChain,
    })) continue;
    tabs.push({ id: tab.id, name: tab.name, order: tab.order });
  }

  return tabs.sort((left, right) => left.order - right.order);
}
