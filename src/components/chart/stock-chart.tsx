import { useState, useMemo, useEffect } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import { useSelectedTicker } from "../../state/app-context";
import { colors, priceColor } from "../../theme/colors";
import { formatCurrency, formatPercentRaw } from "../../utils/format";
import { getVisibleWindow, downsample } from "./chart-data";
import { renderChart, formatDateShort } from "./chart-renderer";
import type { StyledContent } from "./chart-renderer";
import type { ChartViewState, ChartColors } from "./chart-types";
import { TIME_RANGES } from "./chart-types";

function getChartColors(isPositive: boolean): ChartColors {
  return {
    lineColor: isPositive ? "#00cc66" : "#ff3333",
    fillColor: isPositive ? "#003d1e" : "#3d0000",
    volumeUp: "#004d2e",
    volumeDown: "#4d0000",
    gridColor: "#0d1a2d",
    crosshairColor: "#ffaa00",
    bgColor: colors.bg,
    axisColor: colors.textDim,
    activeRangeColor: colors.text,
    inactiveRangeColor: "#555555",
  };
}

interface StockChartProps {
  width: number;
  height: number;
  focused: boolean;
  interactive?: boolean;
  compact?: boolean;
}

export function StockChart({ width, height, focused, interactive, compact }: StockChartProps) {
  const { ticker, financials } = useSelectedTicker();
  const [viewState, setViewState] = useState<ChartViewState>({
    timeRange: compact ? "1Y" : "5Y",
    panOffset: 0,
    zoomLevel: 1,
    cursorX: null,
  });
  const [showVolume, setShowVolume] = useState(!compact);

  const history = financials?.priceHistory ?? [];

  const axisWidth = compact ? 0 : 10;
  const chartWidth = Math.max(width - axisWidth - 2, 20); // 2 for padding

  // Show crosshair at rightmost position when entering interactive mode
  useEffect(() => {
    if (interactive) {
      setViewState(s => s.cursorX === null ? { ...s, cursorX: chartWidth - 1 } : s);
    } else {
      setViewState(s => s.cursorX !== null ? { ...s, cursorX: null } : s);
    }
  }, [interactive, chartWidth]);

  // Keyboard controls (full mode only)
  useKeyboard((event) => {
    if (!focused || compact) return;

    const maxCursorX = chartWidth - 1;
    const panStep = Math.max(Math.floor(chartWidth / 10), 1);

    // These keys always work when focused on chart tab (no interactive mode needed)
    switch (event.name) {
      case "=":
        setViewState(s => ({ ...s, zoomLevel: Math.min(s.zoomLevel * 1.5, 10) }));
        return;
      case "-":
        setViewState(s => ({ ...s, zoomLevel: Math.max(s.zoomLevel / 1.5, 0.5) }));
        return;
      case "0":
        setViewState(s => ({ ...s, panOffset: 0, zoomLevel: 1, cursorX: null }));
        return;
      case "v":
        setShowVolume(v => !v);
        return;
      case "a":
        setViewState(s => ({ ...s, panOffset: s.panOffset + panStep }));
        return;
      case "d":
        setViewState(s => ({ ...s, panOffset: Math.max(s.panOffset - panStep, 0) }));
        return;
    }

    // Number keys for time ranges
    if (event.name >= "1" && event.name <= "7") {
      const idx = parseInt(event.name) - 1;
      if (idx < TIME_RANGES.length) {
        setViewState(s => ({
          ...s,
          timeRange: TIME_RANGES[idx]!,
          panOffset: 0,
          zoomLevel: 1,
          cursorX: null,
        }));
      }
      return;
    }

    // Arrow keys only work in interactive mode (Enter to activate, Escape to exit)
    if (!interactive) return;

    switch (event.name) {
      case "left":
        if (event.shift) {
          setViewState(s => ({ ...s, panOffset: s.panOffset + panStep }));
        } else {
          setViewState(s => {
            const cur = s.cursorX === null ? maxCursorX : s.cursorX - 1;
            if (cur < 0) {
              // At left edge — pan left and keep cursor at 0
              return { ...s, cursorX: 0, panOffset: s.panOffset + 1 };
            }
            return { ...s, cursorX: cur };
          });
        }
        break;
      case "right":
        if (event.shift) {
          setViewState(s => ({ ...s, panOffset: Math.max(s.panOffset - panStep, 0) }));
        } else {
          setViewState(s => {
            const cur = s.cursorX === null ? 0 : s.cursorX + 1;
            if (cur > maxCursorX) {
              // At right edge — pan right and keep cursor at max
              return { ...s, cursorX: maxCursorX, panOffset: Math.max(s.panOffset - 1, 0) };
            }
            return { ...s, cursorX: cur };
          });
        }
        break;
    }
  });
  const headerRows = compact ? 0 : 3; // header + range bar + spacer
  const helpRow = compact ? 0 : 1;
  const timeAxisRow = 1;
  const volumeHeight = showVolume && !compact ? 3 : 0;
  const chartHeight = Math.max(height - headerRows - helpRow - timeAxisRow, 4);

  // Compute visible data
  const { window: visibleWindow, chartColors, result } = useMemo(() => {
    const w = getVisibleWindow(history, viewState, chartWidth);
    const sampled = downsample(w.points, chartWidth);

    const isPositive = sampled.length >= 2
      ? sampled[sampled.length - 1]!.close >= sampled[0]!.close
      : true;
    const cc = getChartColors(isPositive);

    const r = renderChart(sampled, {
      width: chartWidth,
      height: chartHeight,
      showVolume: showVolume && !compact,
      volumeHeight,
      cursorX: viewState.cursorX !== null ? Math.min(viewState.cursorX, chartWidth - 1) : null,
      colors: cc,
    });

    return { window: w, chartColors: cc, result: r };
  }, [history, viewState, chartWidth, chartHeight, showVolume, compact, volumeHeight]);

  if (history.length === 0) {
    return <text fg={colors.textDim}>No price history available.</text>;
  }

  const firstPrice = visibleWindow.points[0]?.close ?? 0;
  const lastPrice = visibleWindow.points[visibleWindow.points.length - 1]?.close ?? 0;
  const change = lastPrice - firstPrice;
  const changePct = firstPrice ? (change / firstPrice) * 100 : 0;
  const changeColor = priceColor(change);

  // Cursor display values
  const displayPrice = result.priceAtCursor ?? lastPrice;
  const displayChange = result.changeAtCursor ?? change;
  const displayChangePct = result.changePctAtCursor ?? changePct;
  const displayDate = result.dateAtCursor ? formatDateShort(result.dateAtCursor) : null;

  if (compact) {
    // Compact mode: just the chart lines
    return (
      <box flexDirection="column">
        {result.lines.map((line, i) => (
          <box key={i} height={1}>
            <text content={line as any} />
          </box>
        ))}
        {/* Time axis */}
        <box height={1}>
          <text fg={colors.textDim}>{result.timeLabels}</text>
        </box>
      </box>
    );
  }

  // Full interactive mode
  return (
    <box flexDirection="column" flexGrow={1}>
      {/* Header: ticker + price at cursor */}
      <box flexDirection="row" gap={2} height={1}>
        <text attributes={TextAttributes.BOLD} fg={colors.textBright}>
          {ticker?.frontmatter.ticker ?? ""} - {viewState.timeRange}
        </text>
        <text fg={changeColor}>
          {formatCurrency(displayPrice)}
        </text>
        <text fg={priceColor(displayChange)}>
          {displayChange >= 0 ? "+" : ""}{displayChange.toFixed(2)} ({displayChangePct >= 0 ? "+" : ""}{displayChangePct.toFixed(2)}%)
        </text>
        {displayDate && (
          <text fg={colors.textDim}>{displayDate}</text>
        )}
      </box>

      {/* Time range bar */}
      <box flexDirection="row" gap={1} height={1}>
        {TIME_RANGES.map((r, i) => (
          <text
            key={r}
            fg={viewState.timeRange === r ? chartColors.activeRangeColor : chartColors.inactiveRangeColor}
            attributes={viewState.timeRange === r ? TextAttributes.BOLD : 0}
          >
            {`${i + 1}:${r}`}
          </text>
        ))}
        {viewState.zoomLevel !== 1 && (
          <text fg={colors.textDim}> zoom:{viewState.zoomLevel.toFixed(1)}x</text>
        )}
      </box>

      {/* Spacer */}
      <box height={1} />

      {/* Chart area with axis labels */}
      {result.lines.map((line, i) => {
        const axisLabel = result.axisLabels.find(a => a.row === i);
        return (
          <box key={i} flexDirection="row" height={1}>
            <text content={line as any} />
            {axisLabel && (
              <text fg={colors.textDim}> {axisLabel.label.padStart(axisWidth - 1)}</text>
            )}
          </box>
        );
      })}

      {/* Time axis */}
      <box height={1}>
        <text fg={colors.textDim}>{result.timeLabels}</text>
      </box>

      {/* Help bar */}
      <box height={1}>
        <text fg={colors.textMuted}>
          {interactive
            ? "←→ cursor  ⇧←→ pan  a/d pan  +/- zoom  1-7 range  v vol  Esc exit"
            : "Enter crosshair  a/d pan  +/- zoom  1-7 range  v volume  0 reset"}
        </text>
      </box>
    </box>
  );
}
