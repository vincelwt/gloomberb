import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text } from "../../../../ui";
import { usePaneFooter } from "../../../../components";
import { useShortcut } from "../../../../react/input";
import { StaticMultiLineChartSurface } from "../../../../components/chart/static/multi-line-chart-surface";
import { StaticScatterChartSurface } from "../../../../components/chart/static/scatter-chart-surface";
import { resolveChartPalette } from "../../../../components/chart/core/renderer";
import type { PaneProps, PaneTemplateDef } from "../../../../types/plugin";
import { usePaneInstance } from "../../../../state/app/context";
import { colors } from "../../../../theme/colors";
import { formatNumber } from "../../../../utils/format";
import { formatTickerListInput } from "../../../../tickers/list";
import { usePluginPaneState } from "../../../runtime";
import { formatDateTime, useBoundTicker } from "../../shared/ticker-request";
import { RelationshipMetricsTable, RelationshipToggle } from "./controls";
import { useRelationshipHistories } from "./history";
import {
  DEFAULT_RELATIONSHIP_CORRELATION_WINDOW,
  DEFAULT_RELATIONSHIP_SECOND_SYMBOL,
  buildRelationshipAnalysis,
  nextRelationshipRange,
  nextRelationshipWindow,
  relationshipSymbolsFromPaneSettings,
  relationshipTemplateSymbols,
  type RelationshipRange,
} from "./model";
import {
  buildIndexedPriceSeries,
  buildRelationshipCorrelationSeries,
  buildRelationshipMetricsRows,
  buildRelationshipRatioSeries,
  buildRelationshipScatterPointsForDate,
  findRelationshipAlignedPoint,
  findRelationshipCorrelationAtDate,
  formatNullableNumber,
} from "./view-model";

export { buildRelationshipAnalysis } from "./model";

export function RelationshipGraphPane({ focused, width, height }: PaneProps) {
  const pane = usePaneInstance();
  const { symbol, exchange } = useBoundTicker();
  const pair = useMemo(() => relationshipSymbolsFromPaneSettings(pane?.settings, symbol), [pane?.settings, symbol]);
  const [range, setRange] = usePluginPaneState<RelationshipRange>("range", "1Y");
  const [correlationWindow, setCorrelationWindow] = usePluginPaneState<number>(
    "correlationWindow",
    DEFAULT_RELATIONSHIP_CORRELATION_WINDOW,
  );
  const [showCorrelation, setShowCorrelation] = usePluginPaneState<boolean>("showCorrelation", true);
  const [showRegression, setShowRegression] = usePluginPaneState<boolean>("showRegression", true);
  const [cursorDateMs, setCursorDateMs] = useState<number | null>(null);
  const { data, loading, error } = useRelationshipHistories(pair, range, exchange);
  const left = data?.[0] ?? null;
  const right = data?.[1] ?? null;
  const analysis = useMemo(() => (
    left && right ? buildRelationshipAnalysis(left.points, right.points, correlationWindow) : null
  ), [correlationWindow, left, right]);
  const cycleRange = useCallback(() => setRange((current) => nextRelationshipRange(current)), [setRange]);
  const cycleWindow = useCallback(() => setCorrelationWindow((current) => nextRelationshipWindow(current)), [setCorrelationWindow]);
  const toggleCorrelation = useCallback(() => setShowCorrelation((current) => !current), [setShowCorrelation]);
  const toggleRegression = useCallback(() => setShowRegression((current) => !current), [setShowRegression]);
  const leftSymbol = pair?.[0] ?? left?.symbol ?? "";
  const rightSymbol = pair?.[1] ?? right?.symbol ?? "";
  const ratioTrend = (analysis?.ratioPoints.at(-1)?.close ?? 0) >= (analysis?.ratioPoints[0]?.close ?? 0)
    ? "positive"
    : "negative";
  const ratioPalette = useMemo(() => resolveChartPalette(colors, ratioTrend), [ratioTrend]);
  const chartWidth = Math.max(20, width - 2);
  const headerRows = 1;
  const availableChartRows = Math.max(8, height - headerRows);
  const showScatter = showRegression && availableChartRows >= 17;
  const priceHeight = Math.max(5, Math.floor(availableChartRows * (showScatter ? 0.26 : 0.34)));
  const ratioHeight = Math.max(4, Math.floor(availableChartRows * (showScatter ? 0.22 : 0.33)));
  const correlationHeight = showCorrelation
    ? Math.max(4, Math.floor(availableChartRows * (showScatter ? 0.22 : 0.33)))
    : 0;
  const statsRailWidth = showScatter && chartWidth >= 68 ? Math.min(34, Math.floor(chartWidth * 0.3)) : 0;
  const statsBelowRows = showScatter && statsRailWidth === 0 ? 1 : 0;
  const scatterHeight = showScatter
    ? Math.max(5, availableChartRows - priceHeight - ratioHeight - correlationHeight - statsBelowRows)
    : 0;
  const scatterWidth = statsRailWidth > 0 ? Math.max(20, chartWidth - statsRailWidth - 1) : chartWidth;
  const stats = analysis?.stats ?? null;
  const alignedDates = useMemo(() => analysis?.aligned.map((entry) => entry.date) ?? [], [analysis]);
  const cursorDate = useMemo(() => {
    if (alignedDates.length === 0) return null;
    if (cursorDateMs !== null && alignedDates.some((date) => date.getTime() === cursorDateMs)) {
      return new Date(cursorDateMs);
    }
    return alignedDates.at(-1) ?? null;
  }, [alignedDates, cursorDateMs]);
  const selectedAligned = useMemo(
    () => analysis ? findRelationshipAlignedPoint(analysis.aligned, cursorDate) : null,
    [analysis, cursorDate],
  );
  const selectedCorrelation = useMemo(
    () => analysis ? findRelationshipCorrelationAtDate(analysis.correlationPoints, cursorDate) : null,
    [analysis, cursorDate],
  );
  const priceSeries = useMemo(
    () => analysis ? buildIndexedPriceSeries(analysis.aligned, leftSymbol, rightSymbol) : [],
    [analysis, leftSymbol, rightSymbol],
  );
  const ratioSeries = useMemo(
    () => analysis ? buildRelationshipRatioSeries(analysis.aligned, leftSymbol, rightSymbol, ratioPalette.lineColor) : [],
    [analysis, leftSymbol, ratioPalette.lineColor, rightSymbol],
  );
  const correlationSeries = useMemo(
    () => analysis ? buildRelationshipCorrelationSeries(analysis.aligned, analysis.correlationPoints) : [],
    [analysis],
  );
  const scatterPoints = useMemo(
    () => analysis ? buildRelationshipScatterPointsForDate(analysis.returns, cursorDate) : [],
    [analysis, cursorDate],
  );
  const selectedPriceBase = analysis?.aligned[0] ?? null;
  const selectedLeftIndex = selectedAligned && selectedPriceBase
    ? (selectedAligned.leftClose / selectedPriceBase.leftClose) * 100
    : null;
  const selectedRightIndex = selectedAligned && selectedPriceBase
    ? (selectedAligned.rightClose / selectedPriceBase.rightClose) * 100
    : null;
  const selectedRatio = selectedAligned?.ratio ?? analysis?.latestRatio ?? null;
  const selectCursorDate = useCallback((date: Date) => setCursorDateMs(date.getTime()), []);
  const metricsRows = useMemo(
    () => analysis ? buildRelationshipMetricsRows(stats, analysis) : [],
    [analysis, stats],
  );
  const footerSummary = useMemo(() => {
    const parts = [
      cursorDate ? formatDateTime(cursorDate).slice(0, 10) : "latest",
      `ratio ${formatNullableNumber(selectedRatio, 3)}`,
      `corr ${formatNullableNumber(selectedCorrelation, 3)}`,
      ...(leftSymbol ? [`${leftSymbol} ${formatNullableNumber(selectedLeftIndex, 1)}`] : []),
      ...(rightSymbol ? [`${rightSymbol} ${formatNullableNumber(selectedRightIndex, 1)}`] : []),
    ];
    return parts.join("  ");
  }, [
    cursorDate,
    leftSymbol,
    rightSymbol,
    selectedCorrelation,
    selectedLeftIndex,
    selectedRatio,
    selectedRightIndex,
  ]);

  useEffect(() => {
    if (!analysis?.aligned.length) return;
    setCursorDateMs((current) => {
      if (current !== null && analysis.aligned.some((entry) => entry.date.getTime() === current)) return current;
      return analysis.aligned.at(-1)?.date.getTime() ?? null;
    });
  }, [analysis]);

  useShortcut((event) => {
    if (!focused) return;
    switch (event.name) {
      case "t":
        event.preventDefault();
        event.stopPropagation();
        cycleRange();
        return;
      case "w":
        event.preventDefault();
        event.stopPropagation();
        cycleWindow();
        return;
      case "c":
        event.preventDefault();
        event.stopPropagation();
        toggleCorrelation();
        return;
      case "g":
        event.preventDefault();
        event.stopPropagation();
        toggleRegression();
        return;
    }
  });

  usePaneFooter("relationship-graph", () => ({
    info: [
      { id: "summary", parts: [{ text: footerSummary, tone: "muted" as const }] },
      ...(loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : []),
    ],
    hints: [
      { id: "range", key: "t", label: "range", onPress: cycleRange },
      { id: "window", key: "w", label: "win", onPress: cycleWindow },
      { id: "correlation", key: "c", label: "corr", onPress: toggleCorrelation },
      { id: "regression", key: "g", label: "reg", onPress: toggleRegression },
    ],
  }), [
    cycleRange,
    cycleWindow,
    error,
    footerSummary,
    loading,
    toggleCorrelation,
    toggleRegression,
  ]);

  if (!pair) {
    return (
      <Box padding={1}>
        <Text fg={colors.textDim}>No relationship tickers configured.</Text>
      </Box>
    );
  }

  if (!analysis || analysis.aligned.length < 2) {
    return (
      <Box padding={1} flexDirection="column" gap={1}>
        <Text fg={error ? colors.warning : colors.textDim}>
          {loading ? "Loading relationship history..." : error ?? "No overlapping price history."}
        </Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      overflow="hidden"
      paddingX={1}
    >
      <Box height={1} flexDirection="row" gap={2}>
        <RelationshipToggle checked={showCorrelation} label="Correlation" onPress={toggleCorrelation} />
        <RelationshipToggle checked={showRegression} label="Regression" onPress={toggleRegression} />
        <Text fg={colors.textDim}>Range {range}  Window {correlationWindow}d</Text>
      </Box>
      <StaticMultiLineChartSurface
        series={priceSeries}
        width={chartWidth}
        height={priceHeight}
        dates={alignedDates}
        cursorDate={cursorDate}
        showTimeAxis
        timeAxisColor={colors.textDim}
        yAxisLabel={`Indexed price (${leftSymbol}, ${rightSymbol})`}
        yAxisColor={colors.textDim}
        formatYAxisValue={(value) => formatNumber(value, 0)}
        onCursorDateChange={selectCursorDate}
      />
      <StaticMultiLineChartSurface
        series={ratioSeries}
        width={chartWidth}
        height={ratioHeight}
        dates={alignedDates}
        cursorDate={cursorDate}
        showTimeAxis
        timeAxisColor={colors.textDim}
        yAxisLabel={`${leftSymbol}/${rightSymbol} ratio`}
        yAxisColor={colors.textDim}
        formatYAxisValue={(value) => formatNumber(value, Math.abs(value) >= 10 ? 1 : 3)}
        onCursorDateChange={selectCursorDate}
      />
      {showCorrelation ? (
        <StaticMultiLineChartSurface
          series={correlationSeries}
          width={chartWidth}
          height={correlationHeight}
          dates={alignedDates}
          cursorDate={cursorDate}
          showTimeAxis
          timeAxisColor={colors.textDim}
          yAxisLabel={`Rolling corr (${correlationWindow}d)`}
          yAxisColor={colors.textDim}
          formatYAxisValue={(value) => formatNumber(value, 2)}
          onCursorDateChange={selectCursorDate}
        />
      ) : null}
      {showScatter ? (
        <Box flexDirection="row" width={chartWidth} height={scatterHeight}>
          <StaticScatterChartSurface
            points={scatterPoints}
            width={scatterWidth}
            height={scatterHeight}
            regression={showRegression && stats ? { slope: stats.beta, intercept: stats.alpha, color: "#ffd43b" } : null}
            xLabel={`${rightSymbol} returns (%)`}
            yLabel={`${leftSymbol} returns (%)`}
          />
          {statsRailWidth > 0 ? (
            <>
              <Box width={1} />
              <Box width={statsRailWidth} height={scatterHeight} flexDirection="column">
                <RelationshipMetricsTable rows={metricsRows} width={statsRailWidth} height={scatterHeight} />
              </Box>
            </>
          ) : null}
        </Box>
      ) : null}
      {showRegression && (!showScatter || statsRailWidth === 0) ? (
        <Text fg={colors.textDim}>
          {metricsRows.map((row) => `${row.label} ${row.value}`).join("  ")}
        </Text>
      ) : null}
    </Box>
  );
}

export function createRelationshipPaneTemplate(): PaneTemplateDef {
  return {
    id: "relationship-graph-pane",
    paneId: "relationship-graph",
    label: "Relationship Graph",
    description: "Graph ratio, rolling correlation, and regression between two tickers.",
    keywords: ["relationship", "ratio", "graph", "correlation", "regression", "gr"],
    shortcut: { prefix: "GR", argPlaceholder: "tickers", argKind: "ticker-list" },
    wizard: [
      {
        key: "tickers",
        label: "Relationship Tickers",
        placeholder: "AMD, NVDA",
        body: [`Enter one or two tickers. One ticker compares against ${DEFAULT_RELATIONSHIP_SECOND_SYMBOL}.`],
        type: "text",
      },
    ],
    canCreate: (context, options) => !!relationshipTemplateSymbols(context.activeTicker, options),
    createInstance: (context, options) => {
      const pair = relationshipTemplateSymbols(context.activeTicker, options);
      return pair
        ? {
          title: `GR ${pair[0]}/${pair[1]}`,
          binding: { kind: "fixed" as const, symbol: pair[0] },
          placement: "floating" as const,
          settings: {
            symbols: pair,
            symbolsText: formatTickerListInput(pair),
          },
        }
        : null;
    },
  };
}
