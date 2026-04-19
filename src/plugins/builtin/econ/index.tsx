import { Box, ScrollBox, Text } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TextAttributes, type ScrollBoxRenderable } from "../../../ui";
import { useShortcut } from "../../../react/input";
import { DataTableStackView, StaticChartSurface, usePaneFooter, type DataTableCell, type DataTableColumn } from "../../../components";
import type { GloomPluginContext, PaneProps } from "../../../types/plugin";
import { colors, blendHex } from "../../../theme/colors";
import { fetchEconCalendar } from "./calendar-source";
import type { EconEvent, EconImpact } from "./types";
import { usePluginTickerActions } from "../../plugin-runtime";
import { resolveFredMapping } from "./fred-series-map";
import { resolveChartPalette } from "../../../components/chart/chart-renderer";
import type { ProjectedChartPoint } from "../../../components/chart/chart-data";
import { apiClient, type CloudFredObservationPayload, type CloudFredSeriesInfoPayload } from "../../../utils/api-client";

const CACHE_TTL_MS = 15 * 60 * 1000;

type ImpactFilter = "high" | "medium" | "low" | "all";
type CountryFilter = "all" | "US" | "G7" | "EU";

const FILTER_CYCLE: ImpactFilter[] = ["all", "high", "medium", "low"];
const COUNTRY_CYCLE: CountryFilter[] = ["all", "US", "G7", "EU"];
const G7_COUNTRIES = new Set(["US", "GB", "EU", "JP", "CA", "DE"]);

const FLAG_MAP: Record<string, string> = {
  US: "🇺🇸", GB: "🇬🇧", EU: "🇪🇺", JP: "🇯🇵", CA: "🇨🇦",
  AU: "🇦🇺", CH: "🇨🇭", CN: "🇨🇳", NZ: "🇳🇿", SE: "🇸🇪", "--": "🌐",
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function countryFlag(code: string): string {
  return FLAG_MAP[code] ?? code;
}

function impactIndicator(impact: EconImpact): { text: string; color: string } {
  switch (impact) {
    case "high":
      return { text: "●●●", color: colors.negative };
    case "medium":
      return { text: "●● ", color: colors.warning };
    case "low":
      return { text: "●  ", color: colors.textDim };
  }
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayLabel(d: Date, today: Date): string {
  const dk = dateKey(d);
  const todayKey = dateKey(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const dayName = DAY_NAMES[d.getDay()]!;
  const monthName = MONTH_NAMES[d.getMonth()]!;
  const dateNum = d.getDate();
  const suffix = `${dayName} ${monthName} ${dateNum}`;

  if (dk === todayKey) return `TODAY — ${suffix}`;
  if (dk === dateKey(tomorrow)) return `TOMORROW — ${suffix}`;
  if (dk === dateKey(yesterday)) return `YESTERDAY — ${suffix}`;
  return suffix;
}

function matchesImpact(event: EconEvent, filter: ImpactFilter): boolean {
  if (filter === "all") return true;
  if (filter === "high") return event.impact === "high";
  if (filter === "medium") return event.impact === "medium" || event.impact === "high";
  return true; // "low" shows everything
}

function matchesCountry(event: EconEvent, filter: CountryFilter): boolean {
  if (filter === "all") return true;
  if (filter === "US") return event.country === "US";
  if (filter === "G7") return G7_COUNTRIES.has(event.country);
  if (filter === "EU") return event.country === "EU";
  return true;
}

function formatCountdown(ms: number): string {
  if (ms <= 60_000) return "in <1m";
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 60) return `in ${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`;
}

function formatStaleness(fetchedAt: number, now: number): string {
  const elapsed = now - fetchedAt;
  if (elapsed < 60_000) return "updated just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `updated ${hours}h ago`;
}

// Module-level cache shared across all pane instances and survives pane close/reopen
let sharedCache: { data: EconEvent[]; fetchedAt: number } | null = null;
let activeFetch: Promise<EconEvent[]> | null = null;

async function loadCalendar(force = false): Promise<EconEvent[]> {
  if (!force && sharedCache && Date.now() - sharedCache.fetchedAt < CACHE_TTL_MS) {
    return sharedCache.data;
  }
  // Deduplicate concurrent fetches
  if (activeFetch) return activeFetch;
  activeFetch = fetchEconCalendar().then((data) => {
    sharedCache = { data, fetchedAt: Date.now() };
    activeFetch = null;
    return data;
  }).catch((err) => {
    activeFetch = null;
    throw err;
  });
  return activeFetch;
}

type DisplayRow =
  | { kind: "separator"; key: string; label: string }
  | { kind: "now"; key: string }
  | { kind: "event"; key: string; event: EconEvent; eventIdx: number };

type EconCalendarColumnId =
  | "time"
  | "impact"
  | "country"
  | "event"
  | "actual"
  | "forecast"
  | "prior";
type EconCalendarColumn = DataTableColumn & { id: EconCalendarColumnId };

// ---------------------------------------------------------------------------
// Detail View — drills into a single economic indicator with FRED history
// ---------------------------------------------------------------------------

interface FredCache {
  observations: CloudFredObservationPayload[];
  info: CloudFredSeriesInfoPayload | null;
}

interface EconDetailViewProps {
  event: EconEvent;
  width: number;
  height: number;
  focused: boolean;
}

function EconDetailView({ event, width, height, focused }: EconDetailViewProps) {
  const { navigateTicker } = usePluginTickerActions();
  const cacheRef = useRef<Map<string, FredCache>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<FredCache | null>(null);
  const scrollRef = useRef<ScrollBoxRenderable>(null);

  const mapping = useMemo(() => resolveFredMapping(event.event, event.country), [event.event, event.country]);

  useEffect(() => {
    if (!mapping) return;

    const cached = cacheRef.current.get(mapping.seriesId);
    if (cached) {
      setData(cached);
      return;
    }

    setLoading(true);
    setError(null);

    const fiveYearsAgo = new Date();
    fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
    const startDate = `${fiveYearsAgo.getFullYear()}-${String(fiveYearsAgo.getMonth() + 1).padStart(2, "0")}-${String(fiveYearsAgo.getDate()).padStart(2, "0")}`;

    apiClient.getCloudFredSeries(mapping.seriesId, { startDate, sortOrder: "asc" })
      .then(({ observations, info }) => {
        const entry: FredCache = { observations, info };
        cacheRef.current.set(mapping.seriesId, entry);
        setData(entry);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [mapping?.seriesId]);

  const scrollDetailBy = useCallback((delta: number) => {
    const scrollBox = scrollRef.current;
    if (!scrollBox?.viewport) return;
    const maxScrollTop = Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height);
    scrollBox.scrollTop = Math.max(0, Math.min(maxScrollTop, scrollBox.scrollTop + delta));
  }, []);

  useShortcut((ev) => {
    if (!focused) return;
    if (ev.name === "j" || ev.name === "down") {
      ev.stopPropagation?.();
      ev.preventDefault?.();
      scrollDetailBy(1);
    } else if (ev.name === "k" || ev.name === "up") {
      ev.stopPropagation?.();
      ev.preventDefault?.();
      scrollDetailBy(-1);
    }
  });

  // No FRED mapping
  if (!mapping) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Box height={1} paddingX={1} flexDirection="row">
          <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
            {event.event}
          </Text>
        </Box>
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Text fg={colors.textMuted}>No historical data available for this indicator</Text>
        </Box>
      </Box>
    );
  }

  // Loading
  if (loading) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Box height={1} paddingX={1} flexDirection="row">
          <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
            {event.event}
          </Text>
          <Box flexGrow={1} />
          <Text fg={colors.textDim}>{mapping.seriesId}</Text>
        </Box>
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Text fg={colors.textMuted}>Loading...</Text>
        </Box>
      </Box>
    );
  }

  // Error
  if (error) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Box height={1} paddingX={1} flexDirection="row">
          <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
            {event.event}
          </Text>
          <Box flexGrow={1} />
          <Text fg={colors.textDim}>{mapping.seriesId}</Text>
        </Box>
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Text fg={colors.negative}>{error}</Text>
        </Box>
      </Box>
    );
  }

  if (!data) return null;

  const { observations, info } = data;
  const chartWidth = Math.max(10, width - 2);
  const chartHeight = Math.min(18, Math.max(9, Math.floor(height * 0.38)));

  // Build chart points (ascending order for chart), exclude null values
  const chartPoints: ProjectedChartPoint[] = observations
    .filter((obs): obs is CloudFredObservationPayload & { value: number } => obs.value != null)
    .map((obs) => ({
      date: new Date(obs.date),
      open: obs.value,
      high: obs.value,
      low: obs.value,
      close: obs.value,
      volume: 0,
    }));

  const palette = resolveChartPalette(colors, "positive");

  // Table rows (descending for display, last 12)
  // For "change" mode, compute m/m or q/q percent change from consecutive observations
  const descObs = [...observations].reverse();
  const ascObs = observations; // already ascending from FRED
  const tableRows = descObs.slice(0, 12).map((obs, i) => {
    if (mapping.displayMode !== "change" || obs.value == null) {
      return { date: obs.date, display: obs.value != null ? obs.value.toLocaleString("en-US", { maximumFractionDigits: 1 }) : "—" };
    }
    // Find the prior observation in ascending order
    const ascIdx = ascObs.findIndex((o) => o.date === obs.date);
    if (ascIdx > 0 && ascObs[ascIdx - 1]!.value != null) {
      const prior = ascObs[ascIdx - 1]!.value!;
      const pct = ((obs.value - prior) / Math.abs(prior)) * 100;
      return { date: obs.date, display: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` };
    }
    return { date: obs.date, display: obs.value.toLocaleString("en-US", { maximumFractionDigits: 1 }) };
  });
  const units = info?.units ?? "";
  const source = info?.source || "";
  const title = info?.title ?? event.event;

  // Value color for table rows
  const valueColor = (display: string): string => {
    if (display.startsWith("+")) return colors.positive;
    if (display.startsWith("-")) return colors.negative;
    return colors.text;
  };

  const dateColWidth = 14;
  const valueColWidth = Math.max(14, Math.floor((width - 4) * 0.3));
  const separatorLine = "─".repeat(Math.max(0, width - 2));

  return (
    <Box flexDirection="column" width={width} height={height}>
      {/* Header */}
      <Box height={1} paddingX={1} flexDirection="row">
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
          {title}
        </Text>
        <Box flexGrow={1} />
        <Text fg={colors.textDim}>{mapping.seriesId}</Text>
      </Box>
      <Box height={1} paddingX={1} flexDirection="row">
        <Text fg={colors.textMuted}>
          {[units, info?.frequency, info?.seasonalAdjustment].filter(Boolean).join(" · ")}
        </Text>
      </Box>

      {/* Event context — scheduled time, forecast, prior */}
      <Box paddingX={1} flexDirection="row" height={1}>
        <Text fg={colors.textDim}>Scheduled: </Text>
        <Text fg={colors.text}>{event.time}</Text>
        {event.forecast ? (
          <>
            <Text fg={colors.textDim}>  Forecast: </Text>
            <Text fg={colors.text}>{event.forecast}</Text>
          </>
        ) : null}
        {event.prior ? (
          <>
            <Text fg={colors.textDim}>  Prior: </Text>
            <Text fg={colors.text}>{event.prior}</Text>
          </>
        ) : null}
      </Box>

      {/* Scrollable content */}
      <ScrollBox ref={scrollRef} flexGrow={1} scrollY focusable={false}>
        <Box flexDirection="column">
          {/* Chart */}
          {chartPoints.length >= 2 ? (
            <Box flexDirection="column" paddingX={1} marginTop={1}>
              <StaticChartSurface
                points={chartPoints}
                width={chartWidth}
                height={chartHeight}
                mode="area"
                colors={palette}
                timeAxisDates={chartPoints.map((p) => p.date)}
                showTimeAxis
                timeAxisColor={colors.textDim}
                yAxisLabel={units ? `Value (${units})` : "Value"}
                yAxisColor={colors.textDim}
                formatYAxisValue={(value) => formatCompactAxisValue(value, units)}
              />
            </Box>
          ) : (
            <Box paddingX={1} marginTop={1}>
              <Text fg={colors.textMuted}>Not enough data for chart</Text>
            </Box>
          )}

          {/* Separator */}
          <Box paddingX={1} height={1} marginTop={1}>
            <Text fg={colors.border}>{separatorLine}</Text>
          </Box>

          {/* Historical readings */}
          <Box paddingX={1} height={1}>
            <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>HISTORICAL READINGS</Text>
          </Box>
          <Box paddingX={1} flexDirection="row" height={1}>
            <Box width={dateColWidth}>
              <Text fg={colors.textDim}>DATE</Text>
            </Box>
            <Box width={valueColWidth} justifyContent="flex-end">
              <Text fg={colors.textDim}>VALUE</Text>
            </Box>
          </Box>
          {tableRows.map((row) => (
            <Box key={row.date} paddingX={1} flexDirection="row" height={1}>
              <Box width={dateColWidth}>
                <Text fg={colors.textDim}>{row.date}</Text>
              </Box>
              <Box width={valueColWidth} justifyContent="flex-end">
                <Text fg={valueColor(row.display)}>{row.display}</Text>
              </Box>
            </Box>
          ))}

          {/* Separator */}
          {mapping.relatedTickers.length > 0 ? (
            <Box paddingX={1} height={1} marginTop={1}>
              <Text fg={colors.border}>{separatorLine}</Text>
            </Box>
          ) : null}

          {/* Related tickers */}
          {mapping.relatedTickers.length > 0 ? (
            <Box paddingX={1} height={1} flexDirection="row">
              <Text fg={colors.textDim}>Related: </Text>
              {mapping.relatedTickers.map((ticker, i) => (
                <Box
                  key={ticker}
                  marginLeft={i > 0 ? 2 : 0}
                  onMouseDown={() => {
                    navigateTicker(ticker);
                  }}
                >
                  <Text fg={colors.textBright} attributes={TextAttributes.UNDERLINE}>{ticker}</Text>
                </Box>
              ))}
            </Box>
          ) : null}
        </Box>
      </ScrollBox>

    </Box>
  );
}

// ---------------------------------------------------------------------------
// Helpers for actual value beat/miss coloring
// ---------------------------------------------------------------------------

function parseNumeric(value: string | null): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[%,KMBTkmbts]/g, "").trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function actualColor(actual: string | null, forecast: string | null): string {
  const a = parseNumeric(actual);
  const f = parseNumeric(forecast);
  if (a === null || f === null) return colors.text;
  if (a > f) return colors.positive;
  if (a < f) return colors.negative;
  return colors.text;
}

function formatCompactAxisValue(value: number, units: string): string {
  const abs = Math.abs(value);
  const normalizedUnits = units.toLowerCase();
  if (normalizedUnits.includes("percent")) {
    return `${value.toFixed(abs >= 10 ? 1 : 2)}%`;
  }
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return value.toLocaleString("en-US", { maximumFractionDigits: abs >= 10 ? 1 : 2 });
}

// ---------------------------------------------------------------------------
// Main Calendar Pane
// ---------------------------------------------------------------------------

export function EconCalendarPane({ focused, width, height }: PaneProps) {
  const [events, setEvents] = useState<EconEvent[]>(sharedCache?.data ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [impactFilter, setImpactFilter] = useState<ImpactFilter>("all");
  const [countryFilter, setCountryFilter] = useState<CountryFilter>("all");
  const [now, setNow] = useState(Date.now());
  const [detailEvent, setDetailEvent] = useState<EconEvent | null>(null);

  const fetchGenRef = useRef(0);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const headerScrollRef = useRef<ScrollBoxRenderable>(null);

  const load = useCallback(async (force = false) => {
    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setLoading(true);
    setError(null);

    try {
      const data = await loadCalendar(force);
      if (fetchGenRef.current !== gen) return;
      setEvents(data);
      if (force) setSelectedIdx(0);
    } catch (err) {
      if (fetchGenRef.current !== gen) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (fetchGenRef.current === gen) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sharedCache && Date.now() - sharedCache.fetchedAt < CACHE_TTL_MS) {
      setEvents(sharedCache.data);
      return;
    }
    load();
  }, [load]);

  // Tick every 30s to update staleness + countdown
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const filtered = useMemo(() => events
    .filter((ev) => matchesImpact(ev, impactFilter) && matchesCountry(ev, countryFilter))
    .sort((a, b) => b.date.getTime() - a.date.getTime()),
  [countryFilter, events, impactFilter]);

  // Build display rows with separator headers and NOW marker
  const today = new Date(now);
  const rows: DisplayRow[] = [];
  let lastDateKey = "";
  let nowInserted = false;
  const hasPastEvents = filtered.some((ev) => ev.date.getTime() <= now);
  const hasFutureEvents = filtered.some((ev) => ev.date.getTime() > now);

  for (let i = 0; i < filtered.length; i++) {
    const ev = filtered[i]!;
    const dk = dateKey(ev.date);

    // Insert date separator if new day
    if (dk !== lastDateKey) {
      lastDateKey = dk;
      rows.push({ kind: "separator", key: `separator-${dk}`, label: dayLabel(ev.date, today) });
    }

    // Reverse chronological order puts upcoming events above the present marker.
    if (hasPastEvents && hasFutureEvents && !nowInserted && ev.date.getTime() <= now) {
      nowInserted = true;
      rows.push({ kind: "now", key: "now" });
    }

    rows.push({ kind: "event", key: `event-${ev.id}-${i}`, event: ev, eventIdx: i });
  }

  // Map from eventIdx to flat row index (for scroll tracking)
  const eventIdxToRowIdx = new Map<number, number>();
  let nowRowIdx = -1;
  let nextUpcomingEventIdx = -1;
  let nextUpcomingTime = Number.POSITIVE_INFINITY;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    if (row.kind === "event") {
      eventIdxToRowIdx.set(row.eventIdx, r);
      const eventTime = row.event.date.getTime();
      if (eventTime > now && eventTime < nextUpcomingTime) {
        nextUpcomingEventIdx = row.eventIdx;
        nextUpcomingTime = eventTime;
      }
    } else if (row.kind === "now") {
      nowRowIdx = r;
    }
  }

  // On initial load, scroll to NOW and select the first upcoming event
  const initialScrollDone = useRef(false);
  useEffect(() => {
    if (initialScrollDone.current || filtered.length === 0) return;
    if (nextUpcomingEventIdx >= 0) {
      setSelectedIdx(nextUpcomingEventIdx);
    }
    const sb = scrollRef.current;
    if (sb?.viewport && nowRowIdx >= 0) {
      // Position NOW a few rows from the top so you can see context
      const scrollTarget = Math.max(0, nowRowIdx - 3);
      sb.scrollTo(scrollTarget);
    }
    initialScrollDone.current = true;
  }, [filtered.length]);

  // Next upcoming event for countdown
  const nextEvent = nextUpcomingEventIdx >= 0 ? filtered[nextUpcomingEventIdx] : undefined;
  const nextCountdown = nextEvent ? formatCountdown(nextEvent.date.getTime() - now) : null;
  const cycleImpactFilter = useCallback(() => {
    setImpactFilter((prev) => {
      const idx = FILTER_CYCLE.indexOf(prev);
      return FILTER_CYCLE[(idx + 1) % FILTER_CYCLE.length]!;
    });
    setSelectedIdx(0);
  }, []);
  const cycleCountryFilter = useCallback(() => {
    setCountryFilter((prev) => {
      const idx = COUNTRY_CYCLE.indexOf(prev);
      return COUNTRY_CYCLE[(idx + 1) % COUNTRY_CYCLE.length]!;
    });
    setSelectedIdx(0);
  }, []);

  const handleRootKeyDown = useCallback((event: {
    name?: string;
    preventDefault?: () => void;
    stopPropagation?: () => void;
  }) => {
    if (event.name === "r") {
      event.stopPropagation?.();
      event.preventDefault?.();
      load(true);
      return true;
    } else if (event.name === "f") {
      event.stopPropagation?.();
      event.preventDefault?.();
      cycleImpactFilter();
      return true;
    } else if (event.name === "c") {
      event.stopPropagation?.();
      event.preventDefault?.();
      cycleCountryFilter();
      return true;
    }
    return false;
  }, [cycleCountryFilter, cycleImpactFilter, load]);

  const columns = useMemo<EconCalendarColumn[]>(() => {
    const timeWidth = 6;
    const impactWidth = 4;
    const flagWidth = 2;
    const actualWidth = 9;
    const forecastWidth = 10;
    const priorWidth = 9;
    const minEventWidth = 12;
    const fixedWidth = timeWidth + impactWidth + flagWidth + actualWidth + forecastWidth + priorWidth;
    const columnCount = 7;
    const eventWidth = Math.max(minEventWidth, width - 2 - columnCount - fixedWidth);

    return [
      { id: "time", label: "TIME", width: timeWidth, align: "left" },
      { id: "impact", label: "IMP", width: impactWidth, align: "left" },
      { id: "country", label: "🌐", width: flagWidth, align: "left" },
      { id: "event", label: "EVENT", width: eventWidth, align: "left" },
      { id: "actual", label: "ACTUAL", width: actualWidth, align: "right" },
      { id: "forecast", label: "FORECAST", width: forecastWidth, align: "right" },
      { id: "prior", label: "PRIOR", width: priorWidth, align: "right" },
    ];
  }, [width]);
  const separatorBg = blendHex(colors.bg, colors.border, 0.3);
  const staleness = sharedCache ? formatStaleness(sharedCache.fetchedAt, now) : "";
  const emptyStateHint = !loading && !error
    ? [
        impactFilter !== "all" ? `impact: ${impactFilter}` : null,
        countryFilter !== "all" ? `country: ${countryFilter}` : null,
      ].filter(Boolean).join(" · ") || undefined
    : undefined;

  usePaneFooter("econ-calendar", () => ({
    info: [
      { id: "impact", parts: [{ text: `impact: ${impactFilter}`, tone: impactFilter === "all" ? "muted" : "value" }] },
      { id: "country", parts: [{ text: `country: ${countryFilter}`, tone: countryFilter === "all" ? "muted" : "value" }] },
      ...(nextEvent && nextCountdown ? [{
        id: "next",
        parts: [{ text: `Next: ${nextEvent.event.length > 18 ? nextEvent.event.slice(0, 18).trimEnd() : nextEvent.event} ${nextCountdown}`, tone: "muted" as const }],
      }] : []),
      ...(staleness ? [{ id: "stale", parts: [{ text: staleness, tone: "muted" as const }] }] : []),
      ...(loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : []),
    ],
    hints: [
      { id: "impact", key: "f", label: "impact", onPress: cycleImpactFilter },
      { id: "country", key: "c", label: "country", onPress: cycleCountryFilter },
      { id: "refresh", key: "r", label: "efresh", onPress: () => load(true) },
    ],
  }), [countryFilter, cycleCountryFilter, cycleImpactFilter, error, impactFilter, load, loading, nextCountdown, nextEvent?.event, staleness]);

  const handleHeaderClick = useCallback(() => {}, []);
  const selectDisplayRow = useCallback((row: DisplayRow) => {
    if (row.kind !== "event") return;
    setSelectedIdx(row.eventIdx);
  }, []);
  const openDisplayRow = useCallback((row: DisplayRow) => {
    if (row.kind !== "event") return;
    setDetailEvent(row.event);
  }, []);
  const renderSectionHeader = useCallback((row: DisplayRow) => {
    if (row.kind === "separator") {
      return {
        text: row.label,
        backgroundColor: separatorBg,
        color: colors.textBright,
        attributes: TextAttributes.BOLD,
      };
    }
    if (row.kind === "now") {
      const label = " ▸ NOW ";
      const line = "─".repeat(Math.max(0, width - label.length - 2));
      return {
        text: `${label}${line}`,
        color: colors.warning,
        attributes: 0,
      };
    }
    return null;
  }, [separatorBg, width]);
  const renderCell = useCallback((
    row: DisplayRow,
    column: EconCalendarColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    if (row.kind !== "event") return { text: "" };

    const ev = row.event;
    const selectedColor = rowState.selected ? colors.selectedText : undefined;

    switch (column.id) {
      case "time":
        return { text: ev.time, color: selectedColor ?? colors.textMuted };
      case "impact": {
        const indicator = impactIndicator(ev.impact);
        return {
          text: indicator.text,
          color: selectedColor ?? indicator.color,
        };
      }
      case "country":
        return { text: countryFlag(ev.country), color: selectedColor };
      case "event":
        return { text: ev.event, color: selectedColor ?? colors.text };
      case "actual":
        return {
          text: ev.actual ?? "—",
          color: selectedColor ?? actualColor(ev.actual, ev.forecast),
        };
      case "forecast":
        return { text: ev.forecast ?? "—", color: selectedColor ?? colors.textDim };
      case "prior":
        return { text: ev.prior ?? "—", color: selectedColor ?? colors.textDim };
    }
  }, []);

  const detailContent = detailEvent ? (
    <EconDetailView
      event={detailEvent}
      width={width}
      height={Math.max(height - 1, 1)}
      focused={focused}
    />
  ) : (
    <Box flexGrow={1} />
  );

  return (
    <DataTableStackView<DisplayRow, EconCalendarColumn>
      focused={focused}
      detailOpen={!!detailEvent}
      onBack={() => setDetailEvent(null)}
      detailContent={detailContent}
      rootWidth={width}
      rootHeight={height}
      onRootKeyDown={handleRootKeyDown}
      selectedIndex={eventIdxToRowIdx.get(selectedIdx) ?? selectedIdx}
      onSelectIndex={(_index, row) => {
        if (row.kind === "event") setSelectedIdx(row.eventIdx);
      }}
      onActivateIndex={(_index, row) => {
        if (row.kind === "event") setDetailEvent(row.event);
      }}
      columns={columns}
      items={rows}
      isNavigable={(row) => row.kind === "event"}
      sortColumnId={null}
      sortDirection="asc"
      onHeaderClick={handleHeaderClick}
      headerScrollRef={headerScrollRef}
      scrollRef={scrollRef}
      getItemKey={(row) => row.key}
      isSelected={(row) => row.kind === "event" && row.eventIdx === selectedIdx}
      onSelect={selectDisplayRow}
      onActivate={openDisplayRow}
      renderSectionHeader={renderSectionHeader}
      renderCell={renderCell}
      emptyStateTitle={loading ? "Loading economic events..." : "No events"}
      emptyStateHint={emptyStateHint}
      showHorizontalScrollbar={false}
    />
  );
}

export function registerEconCalendarFeature(ctx: GloomPluginContext): void {
  ctx.registerPane({
    id: "econ-calendar",
    name: "Economic Calendar",
    icon: "E",
    component: EconCalendarPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 100, height: 30 },
  });

  ctx.registerPaneTemplate({
    id: "econ-calendar-pane",
    paneId: "econ-calendar",
    label: "Economic Calendar",
    description: "Upcoming economic events, releases, and indicators.",
    keywords: ["econ", "economic", "calendar", "events", "macro", "releases", "fed", "cpi", "gdp"],
    shortcut: { prefix: "ECON" },
  });
}
