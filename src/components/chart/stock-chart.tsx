import { useEffect, useMemo, useRef, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { usePaneTicker } from "../../state/app-context";
import { colors, priceColor } from "../../theme/colors";
import { formatCompact, formatCurrency } from "../../utils/format";
import { getSharedDataProvider } from "../../plugins/registry";
import { getVisibleWindow, projectChartData } from "./chart-data";
import { formatDateShort, renderChart, resolveChartPalette } from "./chart-renderer";
import { CHART_RENDER_MODES, TIME_RANGES, type ChartRenderMode, type ChartViewState } from "./chart-types";
import type { PricePoint } from "../../types/financials";

const MODE_CHIPS: Record<ChartRenderMode, string> = {
  area: "A",
  line: "L",
  candles: "C",
  ohlc: "O",
};

const MODE_LABELS: Record<ChartRenderMode, string> = {
  area: "AREA",
  line: "LINE",
  candles: "CANDLES",
  ohlc: "OHLC",
};

interface StockChartProps {
  width: number;
  height: number;
  focused: boolean;
  interactive?: boolean;
  compact?: boolean;
}

export function StockChart({ width, height, focused, interactive, compact }: StockChartProps) {
  const { ticker, financials } = usePaneTicker();
  const [viewState, setViewState] = useState<ChartViewState>({
    timeRange: compact ? "1Y" : "5Y",
    panOffset: 0,
    zoomLevel: 1,
    cursorX: null,
    renderMode: "area",
  });
  const [showVolume, setShowVolume] = useState(!compact);
  const [rangeHistory, setRangeHistory] = useState<PricePoint[] | null>(null);
  const fetchIdRef = useRef(0);

  useEffect(() => {
    const provider = getSharedDataProvider();
    if (!provider || !ticker || compact) return;
    const id = ++fetchIdRef.current;
    setRangeHistory(null);
    const instrument = ticker.frontmatter.broker_contracts?.[0] ?? null;
    provider
      .getPriceHistory(ticker.frontmatter.ticker, ticker.frontmatter.exchange || "", viewState.timeRange, {
        brokerId: instrument?.brokerId,
        brokerInstanceId: instrument?.brokerInstanceId,
        instrument,
      })
      .then((points) => {
        if (id === fetchIdRef.current) setRangeHistory(points);
      })
      .catch(() => {
        if (id === fetchIdRef.current) setRangeHistory(null);
      });
  }, [ticker?.frontmatter.ticker, viewState.timeRange, compact]);

  const history = rangeHistory ?? financials?.priceHistory ?? [];
  const axisWidth = compact ? 0 : 10;
  const chartWidth = Math.max(width - axisWidth - 2, 20);

  useEffect(() => {
    if (interactive) {
      setViewState((state) => (state.cursorX === null ? { ...state, cursorX: chartWidth - 1 } : state));
    } else {
      setViewState((state) => (state.cursorX !== null ? { ...state, cursorX: null } : state));
    }
  }, [interactive, chartWidth]);

  useKeyboard((event) => {
    if (!focused || compact) return;

    const maxCursorX = chartWidth - 1;
    const panStep = Math.max(Math.floor(chartWidth / 10), 1);

    switch (event.name) {
      case "=":
        setViewState((state) => ({ ...state, zoomLevel: Math.min(state.zoomLevel * 1.5, 10) }));
        return;
      case "-":
        setViewState((state) => ({ ...state, zoomLevel: Math.max(state.zoomLevel / 1.5, 0.5) }));
        return;
      case "0":
        setViewState((state) => ({ ...state, panOffset: 0, zoomLevel: 1, cursorX: null }));
        return;
      case "v":
        setShowVolume((value) => !value);
        return;
      case "a":
        setViewState((state) => ({ ...state, panOffset: state.panOffset + panStep }));
        return;
      case "d":
        setViewState((state) => ({ ...state, panOffset: Math.max(state.panOffset - panStep, 0) }));
        return;
      case "m":
        setViewState((state) => {
          const current = state.renderMode ?? "area";
          const idx = CHART_RENDER_MODES.indexOf(current);
          const next = CHART_RENDER_MODES[(idx + 1) % CHART_RENDER_MODES.length]!;
          return { ...state, renderMode: next };
        });
        return;
    }

    if (event.name >= "1" && event.name <= "7") {
      const idx = parseInt(event.name) - 1;
      if (idx < TIME_RANGES.length) {
        setViewState((state) => ({
          ...state,
          timeRange: TIME_RANGES[idx]!,
          panOffset: 0,
          zoomLevel: 1,
          cursorX: null,
        }));
      }
      return;
    }

    if (!interactive) return;

    switch (event.name) {
      case "left":
        if (event.shift) {
          setViewState((state) => ({ ...state, panOffset: state.panOffset + panStep }));
        } else {
          setViewState((state) => {
            const nextCursor = state.cursorX === null ? maxCursorX : state.cursorX - 1;
            if (nextCursor < 0) {
              return { ...state, cursorX: 0, panOffset: state.panOffset + 1 };
            }
            return { ...state, cursorX: nextCursor };
          });
        }
        return;
      case "right":
        if (event.shift) {
          setViewState((state) => ({ ...state, panOffset: Math.max(state.panOffset - panStep, 0) }));
        } else {
          setViewState((state) => {
            const nextCursor = state.cursorX === null ? 0 : state.cursorX + 1;
            if (nextCursor > maxCursorX) {
              return { ...state, cursorX: maxCursorX, panOffset: Math.max(state.panOffset - 1, 0) };
            }
            return { ...state, cursorX: nextCursor };
          });
        }
        return;
    }
  });

  const headerRows = compact ? 0 : 3;
  const helpRow = compact ? 0 : 1;
  const timeAxisRow = 1;
  const volumeHeight = showVolume && !compact ? 3 : 0;
  const chartHeight = Math.max(height - headerRows - helpRow - timeAxisRow, 4);

  const { window: visibleWindow, projection, chartColors, result } = useMemo(() => {
    const window = getVisibleWindow(history, viewState, chartWidth);
    const projection = projectChartData(window.points, chartWidth, viewState.renderMode, !!compact);
    const rawChange = window.points.length >= 2
      ? window.points[window.points.length - 1]!.close - window.points[0]!.close
      : 0;
    const trend = rawChange < 0 ? "negative" : rawChange > 0 ? "positive" : "neutral";
    const chartColors = resolveChartPalette({
      bg: colors.bg,
      border: colors.border,
      borderFocused: colors.borderFocused,
      text: colors.text,
      textDim: colors.textDim,
      positive: colors.positive,
      negative: colors.negative,
    }, trend);

    const result = renderChart(projection.points, {
      width: chartWidth,
      height: chartHeight,
      showVolume: showVolume && !compact,
      volumeHeight,
      cursorX: viewState.cursorX !== null ? Math.min(viewState.cursorX, chartWidth - 1) : null,
      mode: projection.effectiveMode,
      colors: chartColors,
    });

    return { window, projection, chartColors, result };
  }, [history, viewState, chartWidth, chartHeight, showVolume, compact, volumeHeight]);

  if (history.length === 0) {
    return <text fg={colors.textDim}>No price history available.</text>;
  }

  const firstPrice = visibleWindow.points[0]?.close ?? 0;
  const lastPrice = visibleWindow.points[visibleWindow.points.length - 1]?.close ?? 0;
  const change = lastPrice - firstPrice;
  const changePct = firstPrice ? (change / firstPrice) * 100 : 0;
  const requestedMode = projection.requestedMode;
  const showOhlcSummary = projection.effectiveMode === "candles" || projection.effectiveMode === "ohlc";
  const hasCursor = viewState.cursorX !== null;
  const displayPrice = hasCursor ? (result.priceAtCursor ?? lastPrice) : lastPrice;
  const displayChange = hasCursor ? (result.changeAtCursor ?? change) : change;
  const displayChangePct = hasCursor ? (result.changePctAtCursor ?? changePct) : changePct;
  const displayDate = hasCursor || showOhlcSummary
    ? (result.dateAtCursor ? formatDateShort(result.dateAtCursor) : null)
    : null;
  const activePoint = showOhlcSummary ? result.activePoint : null;

  if (compact) {
    return (
      <box flexDirection="column">
        {result.lines.map((line, i) => (
          <box key={i} height={1}>
            <text content={line as any} />
          </box>
        ))}
        <box height={1}>
          <text fg={colors.textDim}>{result.timeLabels}</text>
        </box>
      </box>
    );
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" gap={2} height={1}>
        <text attributes={TextAttributes.BOLD} fg={colors.textBright}>
          {ticker?.frontmatter.ticker ?? ""} - {viewState.timeRange}
        </text>
        <text fg={priceColor(displayChange)}>
          {formatCurrency(displayPrice)}
        </text>
        <text fg={priceColor(displayChange)}>
          {displayChange >= 0 ? "+" : ""}{displayChange.toFixed(2)} ({displayChangePct >= 0 ? "+" : ""}{displayChangePct.toFixed(2)}%)
        </text>
        {displayDate && <text fg={colors.textDim}>{displayDate}</text>}
        {showOhlcSummary && activePoint && (
          <>
            <text fg={colors.textDim}>O {formatCurrency(activePoint.open)}</text>
            <text fg={colors.textDim}>H {formatCurrency(activePoint.high)}</text>
            <text fg={colors.textDim}>L {formatCurrency(activePoint.low)}</text>
            <text fg={colors.textDim}>C {formatCurrency(activePoint.close)}</text>
            <text fg={colors.textDim}>V {formatCompact(activePoint.volume)}</text>
          </>
        )}
      </box>

      <box flexDirection="row" height={1}>
        <box flexDirection="row" gap={1}>
          {TIME_RANGES.map((range, i) => (
            <text
              key={range}
              fg={viewState.timeRange === range ? chartColors.activeRangeColor : chartColors.inactiveRangeColor}
              attributes={viewState.timeRange === range ? TextAttributes.BOLD : 0}
            >
              {`${i + 1}:${range}`}
            </text>
          ))}
          {viewState.zoomLevel !== 1 && (
            <text fg={colors.textDim}> zoom:{viewState.zoomLevel.toFixed(1)}x</text>
          )}
        </box>
        <box flexGrow={1} />
        {chartWidth >= 72 ? (
          <box flexDirection="row" gap={1}>
            {CHART_RENDER_MODES.map((mode) => (
              <text
                key={mode}
                fg={requestedMode === mode ? chartColors.activeRangeColor : chartColors.inactiveRangeColor}
                attributes={requestedMode === mode ? TextAttributes.BOLD : 0}
              >
                {MODE_CHIPS[mode]}
              </text>
            ))}
            {projection.fallbackMode && (
              <text fg={colors.textDim}>auto:{MODE_LABELS[projection.fallbackMode]}</text>
            )}
          </box>
        ) : (
          <box flexDirection="row" gap={1}>
            <text fg={colors.textDim}>mode:{MODE_LABELS[requestedMode]}</text>
            {projection.fallbackMode && (
              <text fg={colors.textDim}>auto:{MODE_LABELS[projection.fallbackMode]}</text>
            )}
          </box>
        )}
      </box>

      <box height={1} />

      {result.lines.map((line, i) => {
        const axisLabel = result.axisLabels.find((entry) => entry.row === i);
        return (
          <box key={i} flexDirection="row" height={1}>
            <text content={line as any} />
            {axisLabel && (
              <text fg={colors.textDim}> {axisLabel.label.padStart(axisWidth - 1)}</text>
            )}
          </box>
        );
      })}

      <box height={1}>
        <text fg={colors.textDim}>{result.timeLabels}</text>
      </box>

      <box height={1}>
        <text fg={colors.textMuted}>
          {interactive
            ? "←→ cursor  ⇧←→ pan  a/d pan  +/- zoom  m mode  1-7 range  v vol  Esc exit"
            : "Enter crosshair  a/d pan  +/- zoom  m mode  1-7 range  v volume  0 reset"}
        </text>
      </box>
    </box>
  );
}
