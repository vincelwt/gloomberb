import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "../../components";
import { filterByTimeRange, projectChartData } from "../../components/chart/chart-data";
import { renderChart, resolveChartPalette } from "../../components/chart/chart-renderer";
import type { ChartAxisMode } from "../../components/chart/chart-types";
import { getSharedDataProvider, getSharedRegistry } from "../../plugins/registry";
import { useAppState } from "../../state/app-context";
import { colors, priceColor } from "../../theme/colors";
import type { PricePoint, Quote } from "../../types/financials";
import type { GloomPlugin, PaneProps, PaneSettingsDef } from "../../types/plugin";
import { formatCurrency, formatPercentRaw } from "../../utils/format";
import { formatTickerListInput, MAX_TICKER_LIST_SIZE, parseTickerListInput } from "../../utils/ticker-list";

export const COMPARISON_CHART_PANE_ID = "comparison-chart";
export const COMPARISON_CHART_TEMPLATE_ID = "comparison-chart-pane";

interface ComparisonChartPaneSettings {
  axisMode: ChartAxisMode;
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
        description: "Show prices or percent change from the first visible point on each chart.",
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

function getDisplayQuote(quote: Quote | undefined, history: PricePoint[]): {
  price: number;
  change: number;
  changePercent: number;
  currency?: string;
} | null {
  if (quote) {
    return {
      price: quote.price,
      change: quote.change,
      changePercent: quote.changePercent,
      currency: quote.currency,
    };
  }

  if (history.length < 2) return null;
  const first = history[0]!.close;
  const last = history[history.length - 1]!.close;
  const change = last - first;
  return {
    price: last,
    change,
    changePercent: first !== 0 ? (change / first) * 100 : 0,
  };
}

function getComparisonColumnCount(width: number, count: number): number {
  if (count <= 1) return 1;
  if (width >= 150 && count >= 3) return 3;
  if (width >= 90) return 2;
  return 1;
}

function ComparisonChartCard({
  symbol,
  width,
  height,
  axisMode,
  selected,
  onHover,
  onOpen,
}: {
  symbol: string;
  width: number;
  height: number;
  axisMode: ChartAxisMode;
  selected: boolean;
  onHover: () => void;
  onOpen: () => void;
}) {
  const { state } = useAppState();
  const ticker = state.tickers.get(symbol) ?? null;
  const financials = state.financials.get(symbol) ?? null;
  const [remoteHistory, setRemoteHistory] = useState<PricePoint[] | null>(null);
  const fetchIdRef = useRef(0);

  useEffect(() => {
    const provider = getSharedDataProvider();
    setRemoteHistory(null);
    if (!provider) return;

    const id = ++fetchIdRef.current;
    const instrument = ticker?.metadata.broker_contracts?.[0] ?? null;
    provider.getPriceHistory(symbol, ticker?.metadata.exchange || "", "1Y", {
      brokerId: instrument?.brokerId,
      brokerInstanceId: instrument?.brokerInstanceId,
      instrument,
    }).then((points) => {
      if (fetchIdRef.current === id) {
        setRemoteHistory(points);
      }
    }).catch(() => {
      if (fetchIdRef.current === id) {
        setRemoteHistory(null);
      }
    });
  }, [symbol, ticker?.metadata.broker_contracts, ticker?.metadata.exchange]);

  const history = remoteHistory && remoteHistory.length > 0
    ? remoteHistory
    : (financials?.priceHistory ?? []);
  const windowedHistory = useMemo(() => filterByTimeRange(history, "1Y"), [history]);
  const displayQuote = getDisplayQuote(financials?.quote, windowedHistory);
  const axisWidth = axisMode === "percent" ? 11 : 10;
  const plotWidth = Math.max(width - axisWidth - 4, 18);
  const plotHeight = Math.max(height - 4, 4);

  const projection = useMemo(() => (
    projectChartData(windowedHistory, plotWidth, "line", false)
  ), [plotWidth, windowedHistory]);

  const chartColors = useMemo(() => {
    const rawChange = displayQuote?.change ?? 0;
    const trend = rawChange < 0 ? "negative" : rawChange > 0 ? "positive" : "neutral";
    return resolveChartPalette({
      bg: colors.bg,
      border: colors.border,
      borderFocused: colors.borderFocused,
      text: colors.text,
      textDim: colors.textDim,
      positive: colors.positive,
      negative: colors.negative,
    }, trend);
  }, [displayQuote?.change]);

  const result = useMemo(() => (
    renderChart(projection.points, {
      width: plotWidth,
      height: plotHeight,
      showVolume: false,
      volumeHeight: 0,
      cursorX: null,
      mode: projection.effectiveMode,
      axisMode,
      colors: chartColors,
    })
  ), [axisMode, chartColors, plotHeight, plotWidth, projection.effectiveMode, projection.points]);

  const axisLabels = new Map(result.axisLabels.map((entry) => [entry.row, entry.label]));
  const currency = financials?.quote?.currency ?? ticker?.metadata.currency ?? "USD";
  const headerColor = priceColor(displayQuote?.change ?? 0);

  return (
    <box
      width={width}
      height={height}
      flexDirection="column"
      border
      borderColor={selected ? colors.borderFocused : colors.border}
      backgroundColor={colors.panel}
      paddingX={1}
      onMouseMove={onHover}
      onMouseDown={onOpen}
    >
      <box flexDirection="row" justifyContent="space-between" height={1}>
        <text fg={colors.textBright} attributes={TextAttributes.BOLD}>{symbol}</text>
        <text fg={headerColor}>
          {displayQuote ? formatCurrency(displayQuote.price, currency) : "Loading"}
        </text>
      </box>
      <box height={1}>
        <text fg={headerColor}>
          {displayQuote
            ? `${displayQuote.change >= 0 ? "+" : ""}${displayQuote.change.toFixed(2)} (${formatPercentRaw(displayQuote.changePercent)})`
            : (ticker?.metadata.name ?? "Waiting for data...")}
        </text>
      </box>
      {windowedHistory.length >= 2 ? (
        <>
          <box flexDirection="row" height={plotHeight}>
            <box flexDirection="column" width={plotWidth}>
              {result.lines.map((line, index) => <text key={`${symbol}:plot:${index}`} content={line as any} />)}
            </box>
            <box width={axisWidth} height={plotHeight} flexDirection="column">
              {Array.from({ length: plotHeight }, (_, row) => (
                <text key={`${symbol}:axis:${row}`} fg={colors.textDim}>
                  {axisLabels.has(row) ? ` ${axisLabels.get(row)!.padStart(axisWidth - 1)}` : " ".repeat(axisWidth)}
                </text>
              ))}
            </box>
          </box>
          <box height={1}>
            <text fg={colors.textMuted}>{result.timeLabels}</text>
          </box>
        </>
      ) : (
        <box flexGrow={1} alignItems="center" justifyContent="center">
          <text fg={colors.textDim}>No chart data yet.</text>
        </box>
      )}
    </box>
  );
}

function ComparisonChartPane({ paneId, focused, width, height }: PaneProps) {
  const registry = getSharedRegistry();
  const { state } = useAppState();
  const pane = state.config.layout.instances.find((instance) => instance.instanceId === paneId);
  const settings = getComparisonChartPaneSettings(pane?.settings);
  const symbols = settings.symbols;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const columns = getComparisonColumnCount(width, symbols.length);
  const rowGap = 1;
  const contentWidth = Math.max(width - 2, 20);
  const cardWidth = Math.max(Math.floor((contentWidth - (columns - 1) * rowGap) / columns), 28);
  const cardHeight = Math.max(Math.min(height - 2, width >= 150 ? 12 : 10), 8);

  useEffect(() => {
    if (selectedIndex < symbols.length) return;
    setSelectedIndex(Math.max(0, symbols.length - 1));
  }, [selectedIndex, symbols.length]);

  const openTicker = (symbol: string) => {
    registry?.selectTickerFn(symbol);
    registry?.focusPaneFn("ticker-detail");
  };

  useKeyboard((event) => {
    if (!focused || symbols.length === 0) return;

    switch (event.name) {
      case "left":
      case "h":
        setSelectedIndex((index) => Math.max(0, index - 1));
        return;
      case "right":
      case "l":
        setSelectedIndex((index) => Math.min(symbols.length - 1, index + 1));
        return;
      case "up":
      case "k":
        setSelectedIndex((index) => Math.max(0, index - columns));
        return;
      case "down":
      case "j":
        setSelectedIndex((index) => Math.min(symbols.length - 1, index + columns));
        return;
      case "return":
      case "enter":
        openTicker(symbols[selectedIndex]!);
        return;
    }
  });

  if (symbols.length === 0) {
    return (
      <box flexDirection="column" flexGrow={1} padding={1}>
        <EmptyState title="No comparison tickers configured." message="Open pane settings to add up to 10 tickers." />
      </box>
    );
  }

  return (
    <box flexDirection="column" flexGrow={1} paddingX={1}>
      <scrollbox flexGrow={1} scrollY>
        <box flexDirection="column" gap={rowGap}>
          {Array.from({ length: Math.ceil(symbols.length / columns) }, (_, rowIndex) => (
            <box key={`comparison-row:${rowIndex}`} flexDirection="row" gap={rowGap}>
              {symbols.slice(rowIndex * columns, rowIndex * columns + columns).map((symbol, columnIndex) => {
                const index = rowIndex * columns + columnIndex;
                return (
                  <ComparisonChartCard
                    key={symbol}
                    symbol={symbol}
                    width={cardWidth}
                    height={cardHeight}
                    axisMode={settings.axisMode}
                    selected={focused && index === selectedIndex}
                    onHover={() => setSelectedIndex(index)}
                    onOpen={() => {
                      setSelectedIndex(index);
                      openTicker(symbol);
                    }}
                  />
                );
              })}
            </box>
          ))}
        </box>
      </scrollbox>
      <box height={1}>
        <text fg={colors.textMuted}>
          mouse click open detail  ←→↑↓ select  Enter open  PS settings
        </text>
      </box>
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
      defaultWidth: "50%",
      settings: buildComparisonChartSettingsDef(),
    },
  ],
  paneTemplates: [
    {
      id: COMPARISON_CHART_TEMPLATE_ID,
      paneId: COMPARISON_CHART_PANE_ID,
      label: "Comparison Chart",
      description: "Compare up to 10 ticker charts side by side.",
      keywords: ["compare", "comparison", "chart", "multi", "ticker"],
      shortcut: { prefix: "CMP", argPlaceholder: "tickers" },
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
          settings: {
            axisMode: "price",
            symbols,
            symbolsText: formatTickerListInput(symbols),
          },
        };
      },
    },
  ],
};
