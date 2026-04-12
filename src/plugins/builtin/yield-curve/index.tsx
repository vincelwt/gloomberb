import { useEffect, useRef, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type { GloomPlugin, PaneProps } from "../../../types/plugin";
import { colors } from "../../../theme/colors";
import { useAppSelector } from "../../../state/app-context";
import { renderChart, resolveChartPalette } from "../../../components/chart/chart-renderer";
import type { ProjectedChartPoint } from "../../../components/chart/chart-data";
import {
  attachYieldCurvePersistence,
  loadYieldCurve,
  parseYieldPoints,
  isInverted,
  resetYieldCurvePersistence,
  TREASURY_MATURITIES,
  type YieldPoint,
} from "./treasury-data";
import { FRED_API_KEY_COMMAND_LABEL, getSharedFredApiKey } from "../fred-settings";

function formatYield(y: number | null): string {
  if (y == null) return "—";
  return y.toFixed(2);
}

function spreadBp(points: YieldPoint[]): number | null {
  const y2 = points.find((p) => p.maturity === "2Y")?.yield;
  const y10 = points.find((p) => p.maturity === "10Y")?.yield;
  if (y2 == null || y10 == null) return null;
  return Math.round((y10 - y2) * 100);
}

export function YieldCurvePane({ focused, width, height }: PaneProps) {
  const config = useAppSelector((s) => s.config);
  const apiKey = getSharedFredApiKey(config);

  const [points, setPoints] = useState<YieldPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchGenRef = useRef(0);

  const load = async (force = false) => {
    if (!apiKey) return;

    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setLoading(true);
    setError(null);

    try {
      const data = await loadYieldCurve(apiKey, { force });
      if (fetchGenRef.current !== gen) return;
      setPoints(data);
    } catch (err) {
      if (fetchGenRef.current !== gen) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (fetchGenRef.current === gen) setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [apiKey]);

  useKeyboard((ev) => {
    if (!focused) return;
    if (ev.name === "r") {
      load(true);
    }
  });

  if (!apiKey) {
    return (
      <box flexDirection="column" width={width} height={height}>
        <box flexGrow={1} justifyContent="center" alignItems="center">
          <text fg={colors.textMuted}>{`Configure FRED API key: type '${FRED_API_KEY_COMMAND_LABEL}' in command bar`}</text>
        </box>
        <box height={1} paddingX={1}>
          <text fg={colors.textMuted}>[r]efresh</text>
        </box>
      </box>
    );
  }

  if (loading && points.length === 0) {
    return (
      <box flexDirection="column" width={width} height={height}>
        <box flexGrow={1} justifyContent="center" alignItems="center">
          <text fg={colors.textMuted}>Loading...</text>
        </box>
        <box height={1} paddingX={1}>
          <text fg={colors.textMuted}>[r]efresh</text>
        </box>
      </box>
    );
  }

  if (error && points.length === 0) {
    return (
      <box flexDirection="column" width={width} height={height}>
        <box flexGrow={1} justifyContent="center" alignItems="center">
          <text fg={colors.negative}>{error}</text>
        </box>
        <box height={1} paddingX={1}>
          <text fg={colors.textMuted}>[r]efresh</text>
        </box>
      </box>
    );
  }

  const validPoints = parseYieldPoints(points);
  const inverted = isInverted(points);
  const bp = spreadBp(points);
  const spreadStr = bp != null ? `  2Y-10Y: ${bp >= 0 ? "+" : ""}${bp}bp` : "";

  const chartWidth = Math.max(10, width - 2);
  const chartHeight = Math.min(12, Math.max(6, Math.floor(height * 0.3)));

  const palette = resolveChartPalette(colors, "positive");

  // Map yield points to chart points: use epoch + maturityYears*365*86400000 to space them on the x-axis
  const chartPoints: ProjectedChartPoint[] = validPoints.map((p) => ({
    date: new Date(p.maturityYears * 365 * 86400000),
    open: p.yield!,
    high: p.yield!,
    low: p.yield!,
    close: p.yield!,
    volume: 0,
  }));

  let chartResult: ReturnType<typeof renderChart> | null = null;
  if (chartPoints.length >= 2) {
    chartResult = renderChart(chartPoints, {
      width: chartWidth,
      height: chartHeight,
      showVolume: false,
      volumeHeight: 0,
      cursorX: null,
      cursorY: null,
      mode: "line",
      colors: palette,
      timeAxisDates: chartPoints.map((p) => p.date),
    });
  }

  // Build maturity label row and yield value row for the table
  const colWidth = Math.max(6, Math.floor((width - 2) / TREASURY_MATURITIES.length));
  const maturityLabels = TREASURY_MATURITIES.map((m) => m.maturity.padEnd(colWidth)).join("").trimEnd();
  const yieldValues = TREASURY_MATURITIES.map((m) => {
    const pt = points.find((p) => p.maturity === m.maturity);
    return formatYield(pt?.yield ?? null).padEnd(colWidth);
  }).join("").trimEnd();

  return (
    <box flexDirection="column" width={width} height={height}>
      {/* Header */}
      <box height={1} paddingX={1} flexDirection="row">
        {inverted ? (
          <text fg={colors.warning} attributes={TextAttributes.BOLD}>⚠ INVERTED</text>
        ) : null}
        {spreadStr ? (
          <text fg={colors.textDim}>{inverted ? spreadStr : spreadStr.trimStart()}</text>
        ) : null}
        <box flexGrow={1} />
        {loading ? <text fg={colors.textDim}>updating…</text> : null}
      </box>

      {/* Scrollable chart + table */}
      <scrollbox flexGrow={1} scrollY focusable={false}>
        <box flexDirection="column">
          {/* Chart */}
          {chartResult && chartResult.lines.length > 0 ? (
            <box flexDirection="column" paddingX={1} marginTop={1}>
              <box flexDirection="column" height={chartHeight} backgroundColor={palette.bgColor}>
                {chartResult.lines.map((line, i) => (
                  <text key={i} content={line} />
                ))}
              </box>
            </box>
          ) : (
            <box paddingX={1} marginTop={1}>
              <text fg={colors.textMuted}>Not enough data for chart</text>
            </box>
          )}

          {/* Maturity table */}
          <box paddingX={1} marginTop={1} height={1}>
            <text fg={colors.textDim}>{maturityLabels}</text>
          </box>
          <box paddingX={1} height={1}>
            <text fg={colors.text}>{yieldValues}</text>
          </box>
        </box>
      </scrollbox>

      {/* Footer */}
      <box height={1} paddingX={1}>
        <text fg={colors.textMuted}>[r]efresh</text>
      </box>
    </box>
  );
}

export const yieldCurvePlugin: GloomPlugin = {
  id: "yield-curve",
  name: "Yield Curve",
  version: "1.0.0",
  description: "US Treasury yield curve from FRED",
  toggleable: true,

  setup(ctx) {
    attachYieldCurvePersistence(ctx.persistence);
  },

  dispose() {
    resetYieldCurvePersistence();
  },

  panes: [
    {
      id: "yield-curve",
      name: "US Treasury Yield Curve",
      icon: "Y",
      component: YieldCurvePane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 80, height: 20 },
    },
  ],

  paneTemplates: [
    {
      id: "yield-curve-pane",
      paneId: "yield-curve",
      label: "Yield Curve",
      description: "US Treasury yield curve charted from FRED data.",
      keywords: ["yield", "curve", "treasury", "bonds", "rates", "gc", "interest"],
      shortcut: { prefix: "GC" },
    },
  ],
};
