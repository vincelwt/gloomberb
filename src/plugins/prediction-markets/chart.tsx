import { useMemo } from "react";
import { TextAttributes } from "@opentui/core";
import { StockChart } from "../../components/chart/stock-chart";
import { EmptyState } from "../../components/ui/status";
import { colors } from "../../theme/colors";
import { formatNumber, formatPercentRaw } from "../../utils/format";
import type { PricePoint } from "../../types/financials";
import type { PredictionHistoryPoint, PredictionHistoryRange } from "./types";

const RANGES: PredictionHistoryRange[] = ["1D", "1W", "1M", "ALL"];

function coercePredictionPointDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const next = new Date(value);
    return Number.isFinite(next.getTime()) ? next : null;
  }
  return null;
}

function toPricePoints(points: PredictionHistoryPoint[]): PricePoint[] {
  return points.flatMap((point) => {
    const date = coercePredictionPointDate(point.date);
    if (!date) return [];
    return [{
      date,
      close: point.close,
      open: point.open,
      high: point.high,
      low: point.low,
      volume: point.volume,
    }];
  });
}

function PredictionRangeTabs({
  activeRange,
  onRangeSelect,
}: {
  activeRange: PredictionHistoryRange;
  onRangeSelect: (range: PredictionHistoryRange) => void;
}) {
  return (
    <box flexDirection="row" gap={1}>
      {RANGES.map((entry) => {
        const active = entry === activeRange;
        return (
          <box
            key={entry}
            onMouseDown={(event) => {
              event.preventDefault();
              onRangeSelect(entry);
            }}
          >
            <text
              fg={active ? colors.textBright : colors.textDim}
              attributes={active ? TextAttributes.BOLD : 0}
            >
              {entry}
            </text>
          </box>
        );
      })}
    </box>
  );
}

export function PredictionMarketChart({
  history,
  width,
  height,
  range,
  onRangeSelect,
}: {
  history: PredictionHistoryPoint[];
  width: number;
  height: number;
  range: PredictionHistoryRange;
  onRangeSelect: (range: PredictionHistoryRange) => void;
}) {
  const pricePoints = useMemo(() => toPricePoints(history), [history]);

  if (pricePoints.length === 0) {
    return (
      <box flexDirection="column" height={height}>
        <box flexDirection="row" height={1}>
          <PredictionRangeTabs
            activeRange={range}
            onRangeSelect={onRangeSelect}
          />
        </box>
        <box flexGrow={1} justifyContent="center">
          <EmptyState
            title="No chart history."
            hint="This venue did not return price history for the selected market."
          />
        </box>
      </box>
    );
  }

  const first = pricePoints[0] ?? null;
  const last = pricePoints[pricePoints.length - 1] ?? null;
  const delta = first && last ? last.close - first.close : 0;
  const deltaPct = first?.close ? (delta / first.close) * 100 : 0;
  const chartHeight = Math.max(height - 1, 2);

  return (
    <box flexDirection="column" height={height}>
      <box flexDirection="row" height={1}>
        <PredictionRangeTabs
          activeRange={range}
          onRangeSelect={onRangeSelect}
        />
        <box flexGrow={1} />
        <text
          fg={
            delta > 0
              ? colors.positive
              : delta < 0
                ? colors.negative
                : colors.text
          }
        >
          {`${formatNumber(last?.close ?? 0, 3)}  ${formatPercentRaw(deltaPct)}`}
        </text>
      </box>

      <StockChart
        width={width}
        height={chartHeight}
        focused={false}
        compact
        historyOverride={pricePoints}
        currencyOverride="USD"
      />
    </box>
  );
}
