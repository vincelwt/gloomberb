import { useCallback, useEffect, useRef, useState } from "react";
import { Box, ScrollBox, Text, TextAttributes, useUiHost } from "../../../ui";
import { useShortcut } from "../../../react/input";
import { SpeedometerGauge, StaticChartSurface, usePaneFooter, type SpeedometerSegment } from "../../../components";
import type { GloomPlugin, PaneProps } from "../../../types/plugin";
import { colors, blendHex } from "../../../theme/colors";
import { resolveChartPalette } from "../../../components/chart/chart-renderer";
import type { ChartIndicatorOverlays } from "../../../components/chart/chart-types";
import { formatNumber } from "../../../utils/format";
import {
  fetchFearGreedData,
  type FearGreedData,
  type FearGreedIndicator,
  type FearGreedRating,
  type FearGreedValueFormat,
} from "./fear-greed-data";

const CACHE_TTL_MS = 5 * 60 * 1000;
const DESKTOP_SUMMARY_STACK_WIDTH = 84;
const CHART_META_STACK_WIDTH = 84;
const FEAR_GREED_GAUGE_SEGMENTS: SpeedometerSegment[] = [
  { from: 0, to: 24.999, label: "EXTREME FEAR", color: colors.negative },
  { from: 25, to: 44.999, label: "FEAR", color: colors.warning },
  { from: 45, to: 55, label: "NEUTRAL", color: colors.neutral },
  { from: 55.001, to: 75, label: "GREED", color: colors.positive },
  { from: 75.001, to: 100, label: "EXTREME GREED", color: colors.positive },
];

let sharedCache: { data: FearGreedData; fetchedAt: number } | null = null;
let activeFetch: Promise<FearGreedData> | null = null;

async function loadFearGreed(force = false): Promise<FearGreedData> {
  if (!force && sharedCache && Date.now() - sharedCache.fetchedAt < CACHE_TTL_MS) {
    return sharedCache.data;
  }
  if (activeFetch) return activeFetch;

  activeFetch = fetchFearGreedData()
    .then((data) => {
      sharedCache = { data, fetchedAt: Date.now() };
      return data;
    })
    .finally(() => {
      activeFetch = null;
    });
  return activeFetch;
}

function ratingLabel(rating: FearGreedRating): string {
  return rating.toUpperCase();
}

function ratingColor(rating: FearGreedRating): string {
  switch (rating) {
    case "extreme fear":
      return colors.negative;
    case "fear":
      return colors.warning;
    case "neutral":
      return colors.neutral;
    case "greed":
    case "extreme greed":
      return colors.positive;
  }
}

function ratingTrend(rating: FearGreedRating): "positive" | "negative" | "neutral" {
  switch (rating) {
    case "extreme fear":
    case "fear":
      return "negative";
    case "neutral":
      return "neutral";
    case "greed":
    case "extreme greed":
      return "positive";
  }
}

function formatScore(score: number | null | undefined): string {
  if (score == null || Number.isNaN(score)) return "--";
  return String(Math.round(score));
}

function formatIndicatorValue(value: number | null | undefined, format: FearGreedValueFormat): string {
  if (value == null || Number.isNaN(value)) return "--";
  switch (format) {
    case "score":
      return formatScore(value);
    case "percent":
      return `${formatNumber(value, 2)}%`;
    case "ratio":
      return value.toFixed(2);
    case "number": {
      const abs = Math.abs(value);
      if (abs >= 1000) return formatNumber(value, 0);
      if (abs >= 100) return formatNumber(value, 1);
      return formatNumber(value, 2);
    }
  }
}

function formatAxisValue(format: FearGreedValueFormat): (value: number) => string {
  return (value) => formatIndicatorValue(value, format);
}

function formatUpdatedAt(date: Date | null): string {
  if (!date) return "Last updated --";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `Last updated ${part("month")} ${part("day")} at ${part("hour")}:${part("minute")} ${part("dayPeriod")} ET`;
}

function formatAge(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}

function SentimentBadge({ rating }: { rating: FearGreedRating }) {
  const color = ratingColor(rating);
  return (
    <Box height={1} paddingX={1} backgroundColor={blendHex(colors.bg, color, 0.28)}>
      <Text fg={color} attributes={TextAttributes.BOLD}>{ratingLabel(rating)}</Text>
    </Box>
  );
}

function PreviousScoreGrid({ data, width, layout = "grid" }: { data: FearGreedData; width: number; layout?: "grid" | "rail" }) {
  const items = [
    { label: "Previous close", value: data.overall.previousClose },
    { label: "1 week ago", value: data.overall.previousWeek },
    { label: "1 month ago", value: data.overall.previousMonth },
    { label: "1 year ago", value: data.overall.previousYear },
  ];
  const columns = width >= 84 ? 4 : width >= 42 ? 2 : 1;
  const columnWidth = Math.max(18, Math.floor((width - 2) / columns));
  const rows = Array.from({ length: Math.ceil(items.length / columns) }, (_, rowIndex) => (
    items.slice(rowIndex * columns, rowIndex * columns + columns)
  ));

  if (layout === "rail") {
    return (
      <Box flexDirection="column" width={width} flexShrink={0}>
        {items.map((item) => {
          const value = item.value;
          const color = value == null ? colors.textDim : ratingColor(value < 25 ? "extreme fear" : value < 45 ? "fear" : value <= 55 ? "neutral" : "greed");
          return (
            <Box key={item.label} flexDirection="row" height={1}>
              <Text fg={colors.textDim}>{item.label}: </Text>
              <Box flexGrow={1} />
              <Text fg={color} attributes={TextAttributes.BOLD}>{formatScore(value)}</Text>
            </Box>
          );
        })}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      {rows.map((row, rowIndex) => (
        <Box key={rowIndex} flexDirection="row" height={1}>
          {row.map((item) => {
            const value = item.value;
            const color = value == null ? colors.textDim : ratingColor(value < 25 ? "extreme fear" : value < 45 ? "fear" : value <= 55 ? "neutral" : "greed");
            return (
              <Box key={item.label} width={columnWidth} flexShrink={0} flexDirection="row">
                <Text fg={colors.textDim}>{item.label}: </Text>
                <Text fg={color} attributes={TextAttributes.BOLD}>{formatScore(value)}</Text>
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

function chartOverlay(indicator: FearGreedIndicator): ChartIndicatorOverlays | null {
  if (indicator.secondaryPoints.length === 0) return null;
  return {
    smaLines: [{
      period: 0,
      points: indicator.secondaryPoints,
      color: colors.warning,
    }],
    emaLines: [],
    bollinger: null,
    rsi: null,
    macd: null,
  };
}

function SentimentChart({
  title,
  rating,
  score,
  points,
  width,
  valueFormat,
  updatedAt,
  primaryLabel,
  secondaryLabel,
  secondaryValue,
  overlays,
}: {
  title: string;
  rating: FearGreedRating;
  score: number | null;
  points: FearGreedIndicator["points"];
  width: number;
  valueFormat: FearGreedValueFormat;
  updatedAt: Date | null;
  primaryLabel: string;
  secondaryLabel?: string;
  secondaryValue?: number | null;
  overlays?: ChartIndicatorOverlays | null;
}) {
  const isDesktopWeb = useUiHost().kind === "desktop-web";
  const stackMeta = width < CHART_META_STACK_WIDTH;
  const chartWidth = Math.max(24, width - 2);
  const chartHeight = width >= 96 ? 12 : 10;
  const color = ratingColor(rating);
  const basePalette = resolveChartPalette(colors, ratingTrend(rating));
  const palette = {
    ...basePalette,
    lineColor: color,
    fillColor: blendHex(colors.bg, color, 0.18),
    gridColor: blendHex(colors.bg, colors.border, 0.55),
  };
  const latest = points.length > 0 ? points[points.length - 1]!.close : null;

  return (
    <Box flexDirection="column" marginTop={isDesktopWeb ? 1 : 2} paddingX={1}>
      <Box flexDirection="row" height={1}>
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{title.toUpperCase()}</Text>
        <Box flexGrow={1} />
        <SentimentBadge rating={rating} />
      </Box>
      {stackMeta ? (
        <>
          <Box flexDirection="row" height={1} overflow="hidden">
            <SeriesLegend color={color} primaryLabel={primaryLabel} secondaryLabel={secondaryLabel} />
          </Box>
          <Box flexDirection="row" height={1} overflow="hidden">
            <ChartStats
              color={color}
              latest={latest}
              score={score}
              secondaryLabel={secondaryLabel}
              secondaryValue={secondaryValue}
              valueFormat={valueFormat}
            />
          </Box>
        </>
      ) : (
        <Box flexDirection="row" height={1} overflow="hidden">
          <SeriesLegend color={color} primaryLabel={primaryLabel} secondaryLabel={secondaryLabel} />
          <Box flexGrow={1} />
          <ChartStats
            color={color}
            latest={latest}
            score={score}
            secondaryLabel={secondaryLabel}
            secondaryValue={secondaryValue}
            valueFormat={valueFormat}
          />
        </Box>
      )}
      {points.length >= 2 ? (
        <Box marginTop={1}>
          <StaticChartSurface
            points={points}
            width={chartWidth}
            height={chartHeight}
            mode="line"
            colors={palette}
            indicators={overlays}
            showTimeAxis
            timeAxisColor={colors.textDim}
            yAxisColor={colors.textDim}
            formatYAxisValue={formatAxisValue(valueFormat)}
          />
        </Box>
      ) : (
        <Box height={chartHeight} marginTop={1} justifyContent="center" alignItems="center">
          <Text fg={colors.textMuted}>Not enough chart data</Text>
        </Box>
      )}
      <Box height={1} marginTop={1}>
        <Text fg={colors.textDim}>{formatUpdatedAt(updatedAt)}</Text>
      </Box>
    </Box>
  );
}

function SeriesLegend({
  color,
  primaryLabel,
  secondaryLabel,
}: {
  color: string;
  primaryLabel: string;
  secondaryLabel?: string;
}) {
  return (
    <>
      <Text fg={color}>● </Text>
      <Text fg={colors.textDim}>{primaryLabel}</Text>
      {secondaryLabel ? (
        <>
          <Text fg={colors.warning}>  ● </Text>
          <Text fg={colors.textDim}>{secondaryLabel}</Text>
        </>
      ) : null}
    </>
  );
}

function ChartStats({
  color,
  latest,
  score,
  secondaryLabel,
  secondaryValue,
  valueFormat,
}: {
  color: string;
  latest: number | null;
  score: number | null;
  secondaryLabel?: string;
  secondaryValue?: number | null;
  valueFormat: FearGreedValueFormat;
}) {
  return (
    <>
      <Text fg={colors.textDim}>score </Text>
      <Text fg={color} attributes={TextAttributes.BOLD}>{formatScore(score)}</Text>
      <Text fg={colors.textDim}>  latest </Text>
      <Text fg={colors.text}>{formatIndicatorValue(latest, valueFormat)}</Text>
      {secondaryLabel && secondaryValue != null ? (
        <>
          <Text fg={colors.textDim}>  avg </Text>
          <Text fg={colors.text}>{formatIndicatorValue(secondaryValue, valueFormat)}</Text>
        </>
      ) : null}
    </>
  );
}

function IndexHistoryChart({ data, width }: { data: FearGreedData; width: number }) {
  const indicator: FearGreedIndicator = {
    definition: {
      id: "index-history",
      title: "Index History",
      subtitle: "Fear & Greed score over the past year",
      primaryKey: "fear_and_greed_historical",
      primaryLabel: "Fear & Greed",
      valueFormat: "score",
    },
    score: data.overall.score,
    rating: data.overall.rating,
    updatedAt: data.overall.updatedAt,
    points: data.overall.history,
    secondaryPoints: [],
    latestValue: data.overall.score,
    latestSecondaryValue: null,
  };

  return (
    <SentimentChart
      title={indicator.definition.title}
      rating={indicator.rating}
      score={indicator.score}
      points={indicator.points}
      width={width}
      valueFormat={indicator.definition.valueFormat}
      updatedAt={indicator.updatedAt}
      primaryLabel={indicator.definition.primaryLabel}
    />
  );
}

function FearGreedPane({ paneId, focused, width, height }: PaneProps) {
  const isDesktopWeb = useUiHost().kind === "desktop-web";
  const [data, setData] = useState<FearGreedData | null>(sharedCache?.data ?? null);
  const [loading, setLoading] = useState(!sharedCache);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(sharedCache?.fetchedAt ?? null);
  const [now, setNow] = useState(Date.now());
  const fetchGenRef = useRef(0);

  const load = useCallback(async (force = false) => {
    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setLoading(true);
    setError(null);
    try {
      const nextData = await loadFearGreed(force);
      if (fetchGenRef.current !== gen) return;
      setData(nextData);
      setLastRefreshed(Date.now());
    } catch (err) {
      if (fetchGenRef.current !== gen) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (fetchGenRef.current === gen) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!sharedCache) {
      void load();
    }
  }, [load]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(interval);
  }, []);

  const refresh = useCallback(() => {
    void load(true);
  }, [load]);

  const stackDesktopSummary = isDesktopWeb && width < DESKTOP_SUMMARY_STACK_WIDTH;
  const desktopSummaryRailWidth = stackDesktopSummary ? Math.max(18, Math.min(width - 2, 42)) : 26;
  const desktopSummaryGaugeMaxWidth = Math.max(1, Math.min(width - 2, 50));
  const desktopSummaryGaugeMinWidth = Math.min(34, desktopSummaryGaugeMaxWidth);

  useShortcut((event) => {
    if (!focused) return;
    if (event.name === "r") {
      event.preventDefault?.();
      event.stopPropagation?.();
      refresh();
    }
  });

  const footerAge = lastRefreshed ? `refreshed ${formatAge(now - lastRefreshed)}` : loading ? "loading" : "";
  usePaneFooter(paneId, () => ({
    info: [
      ...(data ? [{
        id: "score",
        parts: [
          { text: `${formatScore(data.overall.score)} ${ratingLabel(data.overall.rating)}`, color: ratingColor(data.overall.rating), bold: true },
        ],
      }] : []),
      ...(footerAge ? [{ id: "age", parts: [{ text: footerAge, tone: loading ? "muted" as const : "value" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : []),
    ],
    hints: [{ id: "refresh", key: "r", label: "efresh", onPress: refresh, disabled: loading }],
  }), [data, error, footerAge, loading, paneId, refresh]);

  if (loading && !data) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Text fg={colors.textMuted}>Loading Fear & Greed...</Text>
        </Box>
      </Box>
    );
  }

  if (!data) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Box flexGrow={1} justifyContent="center" alignItems="center" paddingX={1}>
          <Text fg={colors.negative}>{error ?? "Fear & Greed data unavailable"}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <ScrollBox flexGrow={1} scrollY focusable={false}>
        <Box flexDirection="column" paddingBottom={1}>
          {isDesktopWeb ? (
            <Box
              flexDirection={stackDesktopSummary ? "column" : "row"}
              alignItems="center"
              justifyContent="center"
              gap={stackDesktopSummary ? 0 : 4}
              paddingX={1}
            >
              <SpeedometerGauge
                value={data.overall.score}
                valueLabel={ratingLabel(data.overall.rating)}
                width={width}
                segments={FEAR_GREED_GAUGE_SEGMENTS}
                minWidth={stackDesktopSummary ? desktopSummaryGaugeMinWidth : undefined}
                maxWidth={stackDesktopSummary ? desktopSummaryGaugeMaxWidth : undefined}
                compact={stackDesktopSummary}
              />
              <Box marginTop={0}>
                <PreviousScoreGrid data={data} width={desktopSummaryRailWidth} layout="rail" />
              </Box>
            </Box>
          ) : (
            <>
              <SpeedometerGauge
                value={data.overall.score}
                valueLabel={ratingLabel(data.overall.rating)}
                width={width}
                segments={FEAR_GREED_GAUGE_SEGMENTS}
              />
              <PreviousScoreGrid data={data} width={width} />
            </>
          )}
          {loading ? (
            <Box height={1} paddingX={1} marginTop={1} justifyContent="center">
              <Text fg={colors.textMuted}>refreshing...</Text>
            </Box>
          ) : null}
          {error ? (
            <Box paddingX={1} marginTop={1}>
              <Text fg={colors.warning}>{error}</Text>
            </Box>
          ) : null}
          <IndexHistoryChart data={data} width={width} />
          <Box flexDirection="row" paddingX={1} marginTop={2} height={1}>
            <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>7 FEAR & GREED INDICATORS</Text>
          </Box>
          {data.indicators.map((indicator) => (
            <SentimentChart
              key={indicator.definition.id}
              title={indicator.definition.title}
              rating={indicator.rating}
              score={indicator.score}
              points={indicator.points}
              width={width}
              valueFormat={indicator.definition.valueFormat}
              updatedAt={indicator.updatedAt}
              primaryLabel={indicator.definition.primaryLabel}
              secondaryLabel={indicator.definition.secondaryLabel}
              secondaryValue={indicator.latestSecondaryValue}
              overlays={chartOverlay(indicator)}
            />
          ))}
        </Box>
      </ScrollBox>
    </Box>
  );
}

export const fearGreedPlugin: GloomPlugin = {
  id: "fear-greed",
  name: "Fear & Greed",
  version: "1.0.0",
  description: "CNN Fear & Greed sentiment gauge and market indicator charts.",
  toggleable: true,

  panes: [
    {
      id: "fear-greed",
      name: "Fear & Greed",
      icon: "G",
      component: FearGreedPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 110, height: 36 },
    },
  ],

  paneTemplates: [
    {
      id: "fear-greed-pane",
      paneId: "fear-greed",
      label: "Fear & Greed",
      description: "CNN Fear & Greed sentiment gauge with the seven indicator charts.",
      keywords: ["fear", "greed", "sentiment", "cnn", "market", "indicators", "gauge"],
      shortcut: { prefix: "FNG" },
    },
  ],
};
