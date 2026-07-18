import { dirname, resolve } from "path";
import { mkdir } from "fs/promises";
import type { PaneRuntimeState } from "../../core/state/app/state";
import type { OptionsChain, TickerFinancials } from "../../types/financials";
import type { TickerRecord } from "../../types/ticker";
import { slugifyName } from "../../utils/slugify";
import {
  renderDesktopPaneScreenshot,
  type DesktopPaneShotPayload,
  type DesktopPaneShotRenderResult,
} from "../desktop-pane-shot";
import { optionPaneState } from "./options";
import type { ResolvedPaneFunction } from "./resolver";
import type { MarketContext } from "../types";
import { capabilityPluginState } from "./capabilities";
import type { RemoteUiNodeSnapshot } from "../../remote/types";
import {
  graphRowsForFinancials,
  limitGraphRowsBySymbol,
  metricDef,
} from "../../plugins/builtin/ticker-detail/data-panes/fundamental-graph/model";
import {
  buildFinancialTableModel,
  formatFinancialHeader,
} from "../../plugins/builtin/ticker-detail/financials/model";
import type {
  FundamentalPeriod,
  GraphKind,
  GraphMetricKey,
} from "../../plugins/builtin/ticker-detail/data-panes/fundamental-graph/types";
import type { TimeRange } from "../../components/chart/core/types";
import {
  collectShotSymbols,
  clipPriceHistoryToRange,
  createFallbackTicker,
  fetchTickerFinancials,
  isFinancialAnalysisFunction,
  withShotPriceHistory,
} from "./data";

const DESKTOP_CELL_WIDTH_PX = 8;
const DESKTOP_CELL_HEIGHT_PX = 18;
const OPTIONS_PANE_ID = "options";

export interface PaneScreenshotExpectedSelection {
  control: "metric" | "statement" | "period";
  value?: string;
  label?: string;
}

export interface PaneScreenshotResult {
  kind: "pane-screenshot";
  target: string;
  capability: {
    id: string;
    botSafe: boolean;
    outputKind: string;
    reportReadiness: ResolvedPaneFunction["capability"]["reportReadiness"];
    screenshotReadiness: ResolvedPaneFunction["capability"]["screenshotReadiness"];
  };
  symbols: string[];
  options: Record<string, string | number | boolean>;
  rowCount: number;
  empty: boolean;
  complete: boolean;
  unavailableSymbols: string[];
  semanticMismatch: boolean;
  usable: boolean;
  outputPath: string;
  render: DesktopPaneShotRenderResult & {
    expectedText: string[];
    missingExpectedText: string[];
    expectedSelections: PaneScreenshotExpectedSelection[];
    missingExpectedSelections: PaneScreenshotExpectedSelection[];
  };
}

export function defaultScreenshotPath(resolved: ResolvedPaneFunction, rawArg: string): string {
  const suffix = slugifyName([resolved.token, rawArg].filter(Boolean).join("-"), "pane");
  return resolve(process.cwd(), `gloomberb-${suffix}.png`);
}

async function buildDesktopShotPayload(
  resolved: ResolvedPaneFunction,
  context: MarketContext,
  rawArg: string,
  options: Record<string, string | true>,
  widthPx: number,
  heightPx: number,
): Promise<DesktopPaneShotPayload> {
  const widthCells = Math.max(1, Math.round(widthPx / DESKTOP_CELL_WIDTH_PX));
  const heightCells = Math.max(1, Math.round(heightPx / DESKTOP_CELL_HEIGHT_PX));
  const initialPaneState = optionPaneState(resolved.options);
  const pluginState = capabilityPluginState(resolved.capability, resolved.options);
  if (Object.keys(pluginState).length > 0) {
    initialPaneState.pluginState = {
      ...(initialPaneState.pluginState ?? {}),
      ...pluginState,
    };
  }
  if (isFinancialAnalysisFunction(resolved) && !initialPaneState.activeTabId) {
    initialPaneState.activeTabId = "financials";
  }
  const paneState: Record<string, PaneRuntimeState> = {
    [resolved.instance.instanceId]: initialPaneState,
  };
  const layout = {
    dockRoot: null,
    instances: [resolved.instance],
    floating: [{
      instanceId: resolved.instance.instanceId,
      x: 0,
      y: 0,
      width: widthCells,
      height: heightCells,
      zIndex: 1,
    }],
    detached: [],
  };
  const config = {
    ...context.config,
    layout,
    layouts: [{
      name: "CLI Shot",
      layout,
      paneState,
      focusedPaneId: resolved.instance.instanceId,
      activePanel: "right" as const,
    }],
    activeLayoutIndex: 0,
    onboardingComplete: true,
  };

  const tickers: TickerRecord[] = [];
  const financials: Array<[string, TickerFinancials]> = [];
  const optionsChains: Array<[string, OptionsChain]> = [];
  const includeOptionsChains = resolved.pane.id === OPTIONS_PANE_ID || resolved.template?.paneId === OPTIONS_PANE_ID;
  for (const symbol of collectShotSymbols(resolved, rawArg)) {
    const entry = await fetchTickerFinancials(context, symbol);
    const requestedRange = shotPriceHistoryRange(resolved);
    let data = entry.financials;
    if (requestedRange) {
      const exchange = entry.tickerFile?.metadata.exchange
        ?? data.quote?.listingExchangeName
        ?? data.quote?.exchangeName
        ?? "";
      try {
        const priceHistory = await context.dataProvider.getPriceHistory(symbol, exchange, requestedRange);
        data = { ...data, priceHistory: clipPriceHistoryToRange(priceHistory, requestedRange) };
      } catch {
        data = await withShotPriceHistory(context, symbol, entry.tickerFile, data);
      }
    }
    tickers.push(entry.tickerFile ?? createFallbackTicker(symbol, data, context));
    financials.push([symbol, data]);
    if (includeOptionsChains && context.dataProvider.getOptionsChain) {
      const exchange = entry.tickerFile?.metadata.exchange
        ?? data.quote?.listingExchangeName
        ?? data.quote?.exchangeName
        ?? "";
      const chain = await context.dataProvider.getOptionsChain(symbol, exchange);
      optionsChains.push([symbol, chain]);
    }
  }

  return {
    config,
    paneId: resolved.instance.instanceId,
    widthCells,
    heightCells,
    widthPx,
    heightPx,
    tickers,
    financials,
    optionsChains,
    paneState,
  };
}

function shotPriceHistoryRange(resolved: ResolvedPaneFunction): TimeRange | null {
  switch (resolved.capability.id) {
    case "valuation-series":
      return "ALL";
    case "price-chart":
    case "price-comparison":
    case "return-correlation":
      return resolved.capability.id === "price-comparison"
        ? "5Y"
        : (resolved.options.rangePreset ?? "1Y") as TimeRange;
    case "intraday-price-chart":
      return "1D";
    case "historical-prices":
    case "security-relationship":
      return (resolved.options.range ?? "1Y") as TimeRange;
    default:
      return null;
  }
}

export async function renderDesktopShot({
  resolved,
  context,
  rawArg,
  outputPath,
  width,
  height,
  options,
}: {
  resolved: ResolvedPaneFunction;
  context: MarketContext;
  rawArg: string;
  outputPath: string;
  width: number;
  height: number;
  options: Record<string, string | true>;
}): Promise<PaneScreenshotResult> {
  await mkdir(dirname(outputPath), { recursive: true });
  const payload = await buildDesktopShotPayload(resolved, context, rawArg, options, width, height);
  const render = await renderDesktopPaneScreenshot(payload, outputPath);
  const symbols = payload.financials.map(([symbol]) => symbol);
  const rowCount = shotSemanticRowCount(resolved, payload);
  const unavailableSymbols = shotUnavailableSymbols(resolved, payload);
  const complete = unavailableSymbols.length === 0;
  const expectedText = shotExpectedText(resolved, symbols, payload);
  const normalizedVisibleText = render.visibleText.toLowerCase();
  const missingExpectedText = expectedText.filter((value) => !normalizedVisibleText.includes(value.toLowerCase()));
  const expectedSelections = shotExpectedSelections(resolved);
  const missingExpectedSelections = missingActiveTabSelections(
    render.semanticUi,
    expectedSelections,
  );
  const semanticMismatch = missingExpectedText.length > 0 || missingExpectedSelections.length > 0;
  const empty = render.emptyStateDetected || rowCount === 0 || semanticMismatch;
  const usable = resolved.capability.botSafe
    && resolved.capability.screenshotReadiness === "ready"
    && !empty
    && complete;
  return {
    kind: "pane-screenshot",
    target: resolved.token,
    capability: {
      id: resolved.capability.id,
      botSafe: resolved.capability.botSafe,
      outputKind: resolved.capability.outputKind,
      reportReadiness: resolved.capability.reportReadiness,
      screenshotReadiness: resolved.capability.screenshotReadiness,
    },
    symbols,
    options: resolved.options,
    rowCount,
    empty,
    complete,
    unavailableSymbols,
    semanticMismatch,
    usable,
    outputPath,
    render: {
      ...render,
      expectedText,
      missingExpectedText,
      expectedSelections,
      missingExpectedSelections,
    },
  };
}

function shotUnavailableSymbols(
  resolved: ResolvedPaneFunction,
  payload: DesktopPaneShotPayload,
): string[] {
  const graphKind = shotGraphKind(resolved);
  if (graphKind) {
    const metric = resolved.options.metric as GraphMetricKey;
    const period = resolved.options.period as FundamentalPeriod;
    const periodCount = resolved.options.periods == null ? null : Number(resolved.options.periods);
    return payload.financials.flatMap(([symbol, financials]) => (
      limitGraphRowsBySymbol(
        graphRowsForFinancials(financials, graphKind, metric, period, symbol),
        periodCount,
      ).length === 0 ? [symbol] : []
    ));
  }
  if (["price-chart", "intraday-price-chart", "historical-prices"].includes(resolved.capability.id)) {
    return payload.financials.flatMap(([symbol, financials]) => financials.priceHistory.length > 0 ? [] : [symbol]);
  }
  if (["price-comparison", "return-correlation", "security-relationship"].includes(resolved.capability.id)) {
    return payload.financials.flatMap(([symbol, financials]) => financials.priceHistory.length > 1 ? [] : [symbol]);
  }
  if (resolved.capability.id === "financial-statements") {
    return payload.financials.flatMap(([symbol, financials]) => {
      const count = resolved.options.period === "quarterly"
        ? financials.quarterlyStatements.length
        : financials.annualStatements.length;
      return count > 0 ? [] : [symbol];
    });
  }
  return payload.financials.flatMap(([symbol, financials]) => financials.quote ? [] : [symbol]);
}

function shotGraphKind(resolved: ResolvedPaneFunction): GraphKind | null {
  if (resolved.capability.id === "fundamental-series") return "fundamental";
  if (resolved.capability.id === "valuation-series") return "valuation";
  return null;
}

function shotSemanticRowCount(resolved: ResolvedPaneFunction, payload: DesktopPaneShotPayload): number {
  const graphKind = shotGraphKind(resolved);
  if (graphKind) {
    const metric = resolved.options.metric as GraphMetricKey;
    const period = resolved.options.period as FundamentalPeriod;
    const periodCount = resolved.options.periods == null ? null : Number(resolved.options.periods);
    return payload.financials.reduce((count, [symbol, financials]) => (
      count + limitGraphRowsBySymbol(
        graphRowsForFinancials(financials, graphKind, metric, period, symbol),
        periodCount,
      ).length
    ), 0);
  }
  if (["price-chart", "intraday-price-chart", "historical-prices"].includes(resolved.capability.id)) {
    return payload.financials[0]?.[1].priceHistory.length ?? 0;
  }
  if (["price-comparison", "return-correlation", "security-relationship"].includes(resolved.capability.id)) {
    return payload.financials.filter(([, financials]) => financials.priceHistory.length > 1).length;
  }
  if (resolved.capability.id === "financial-statements") {
    const financials = payload.financials[0]?.[1];
    const period = resolved.options.period;
    return period === "quarterly"
      ? financials?.quarterlyStatements.length ?? 0
      : financials?.annualStatements.length ?? 0;
  }
  return payload.financials.filter(([, financials]) => !!financials.quote).length;
}

function shotExpectedText(
  resolved: ResolvedPaneFunction,
  symbols: string[],
  payload: DesktopPaneShotPayload,
): string[] {
  const expected = [...symbols];
  const graphKind = shotGraphKind(resolved);
  if (graphKind) {
    const metric = resolved.options.metric as GraphMetricKey;
    const definition = metricDef(graphKind, metric);
    const period = resolved.options.period as FundamentalPeriod;
    const periodCount = resolved.options.periods == null ? null : Number(resolved.options.periods);
    expected.push(definition.label);
    for (const [symbol, financials] of payload.financials) {
      const latestRow = limitGraphRowsBySymbol(
        graphRowsForFinancials(financials, graphKind, metric, period, symbol),
        periodCount,
      ).sort((left, right) => left.date.localeCompare(right.date)).at(-1);
      if (latestRow) {
        expected.push(latestRow.date);
        expected.push(definition.format(latestRow.value));
      }
    }
  } else if (resolved.capability.id === "financial-statements") {
    const statementLabels: Record<string, string> = {
      income: "Income",
      balance: "Balance",
      cashflow: "Cash Flow",
    };
    expected.push(statementLabels[String(resolved.options.statement)] ?? "");
    expected.push(resolved.options.period === "annual" ? "Annual" : "Quarterly");
    const financials = payload.financials[0]?.[1];
    if (financials) {
      const table = buildFinancialTableModel(financials, {
        period: resolved.options.period as FundamentalPeriod,
        statement: String(resolved.options.statement),
      });
      const latestStatement = table?.statements[0];
      const firstMetric = table?.rows[0];
      if (latestStatement) expected.push(formatFinancialHeader(latestStatement.date).trim());
      if (firstMetric) expected.push(firstMetric.unitLabel);
    }
  }
  return expected.filter(Boolean);
}

function shotExpectedSelections(
  resolved: ResolvedPaneFunction,
): PaneScreenshotExpectedSelection[] {
  if (shotGraphKind(resolved)) {
    return [{
      control: "metric",
      value: String(resolved.options.metric),
    }];
  }
  if (resolved.capability.id !== "financial-statements") return [];
  const labels: Record<string, string> = {
    income: "Income",
    cashflow: "Cash Flow",
    balance: "Balance Sheet",
  };
  return [
    {
      control: "statement",
      label: labels[String(resolved.options.statement)] ?? String(resolved.options.statement),
    },
    {
      control: "period",
      value: String(resolved.options.period),
    },
  ];
}

export function missingActiveTabSelections(
  semanticUi: RemoteUiNodeSnapshot[],
  expected: PaneScreenshotExpectedSelection[],
): PaneScreenshotExpectedSelection[] {
  const activeTabs = semanticUi.flatMap((node) => {
    if (node.role !== "tabs" || !node.metadata) return [];
    const activeValue = typeof node.metadata.activeValue === "string"
      ? node.metadata.activeValue
      : null;
    const tabs = Array.isArray(node.metadata.tabs)
      ? node.metadata.tabs.filter((tab): tab is Record<string, unknown> => (
        !!tab && typeof tab === "object" && !Array.isArray(tab)
      ))
      : [];
    const activeTab = tabs.find((tab) => String(tab.value) === activeValue);
    return [{
      value: activeValue,
      label: typeof activeTab?.label === "string" ? activeTab.label : null,
    }];
  });

  return expected.filter((selection) => !activeTabs.some((active) => (
    (selection.value == null || active.value === selection.value)
    && (selection.label == null || active.label?.toLowerCase() === selection.label.toLowerCase())
  )));
}
