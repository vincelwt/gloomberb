import type { PaneSettingsDef, DetailTabDef } from "../../../types/plugin";
import type { TickerFinancials } from "../../../types/financials";
import type { TickerRecord } from "../../../types/ticker";
import type { ChartAxisMode } from "../../../components/chart/chart-types";
import { getSharedRegistry } from "../../registry";

type DetailTabSummary = { id: string; name: string; order: number };

const CORE_OVERVIEW_TAB: DetailTabSummary = { id: "overview", name: "Overview", order: 10 };
const CORE_FINANCIALS_TAB: DetailTabSummary = { id: "financials", name: "Financials", order: 20 };
const CORE_CHART_TAB: DetailTabSummary = { id: "chart", name: "Chart", order: 30 };

export interface TickerDetailPaneSettings {
  hideTabs: boolean;
  lockedTabId: string;
  chartAxisMode: ChartAxisMode;
}

export function getTickerDetailPaneSettings(
  settings: Record<string, unknown> | undefined,
): TickerDetailPaneSettings {
  return {
    hideTabs: settings?.hideTabs === true,
    lockedTabId: typeof settings?.lockedTabId === "string" ? settings.lockedTabId : "overview",
    chartAxisMode: settings?.chartAxisMode === "percent" ? "percent" : "price",
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
          description: "Choose which tab this pane should stay pinned to when tabs are hidden.",
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

export function buildQuoteMonitorSettingsDef(): PaneSettingsDef {
  return {
    title: "Quote Monitor Settings",
    fields: [
      {
        key: "symbol",
        label: "Ticker",
        description: "Set the fixed ticker symbol for this quote monitor.",
        type: "text",
        placeholder: "AAPL",
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
    hasIbkrGatewayTrading: boolean;
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
      ticker,
      financials,
      hasIbkrGatewayTrading: options.hasIbkrGatewayTrading,
      hasOptionsChain: options.hasOptionsChain,
    })) continue;
    if (tab.id === "ibkr-trade" && !options.hasIbkrGatewayTrading) continue;
    if (tab.id === "options" && !options.hasOptionsChain) continue;
    tabs.push({ id: tab.id, name: tab.name, order: tab.order });
  }

  return tabs.sort((left, right) => left.order - right.order);
}
