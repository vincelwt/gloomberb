import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyledText, TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { DataTable, PageStackView, type DataTableCell, type DataTableColumn } from "../../../components";
import type { GloomPlugin, PaneProps } from "../../../types/plugin";
import { colors, blendHex } from "../../../theme/colors";
import {
  attachEconCalendarPersistence,
  fetchEconCalendar,
  resetEconCalendarPersistence,
} from "./calendar-source";
import type { EconEvent, EconImpact } from "./types";
import { usePluginConfigState, usePluginTickerActions } from "../../plugin-runtime";
import { resolveFredMapping } from "./fred-series-map";
import { fetchFredObservations, fetchFredSeriesInfo, type FredObservation, type FredSeriesInfo } from "./fred-client";
import { renderChart, resolveChartPalette, type StyledContent } from "../../../components/chart/chart-renderer";
import type { ProjectedChartPoint } from "../../../components/chart/chart-data";
import { FRED_API_KEY_COMMAND_LABEL, FRED_API_KEY_CONFIG_KEY } from "../fred-settings";

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
  observations: FredObservation[];
  info: FredSeriesInfo | null;
}

interface EconDetailViewProps {
  event: EconEvent;
  width: number;
  height: number;
  focused: boolean;
}

function EconDetailView({ event, width, height, focused }: EconDetailViewProps) {
  const [fredApiKey] = usePluginConfigState<string>(FRED_API_KEY_CONFIG_KEY, "");
  const { navigateTicker } = usePluginTickerActions();
  const cacheRef = useRef<Map<string, FredCache>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<FredCache | null>(null);
  const scrollRef = useRef<ScrollBoxRenderable>(null);

  const mapping = useMemo(() => resolveFredMapping(event.event, event.country), [event.event, event.country]);

  useEffect(() => {
    if (!mapping) return;
    if (!fredApiKey) return;

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

    Promise.all([
      fetchFredObservations(fredApiKey, mapping.seriesId, { startDate, sortOrder: "asc" }),
      fetchFredSeriesInfo(fredApiKey, mapping.seriesId),
    ])
      .then(([observations, info]) => {
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
  }, [mapping?.seriesId, fredApiKey]);

  const scrollDetailBy = useCallback((delta: number) => {
    const scrollBox = scrollRef.current;
    if (!scrollBox?.viewport) return;
    const maxScrollTop = Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height);
    scrollBox.scrollTop = Math.max(0, Math.min(maxScrollTop, scrollBox.scrollTop + delta));
  }, []);

  useKeyboard((ev) => {
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
      <box flexDirection="column" width={width} height={height}>
        <box height={1} paddingX={1} flexDirection="row">
          <text fg={colors.textBright} attributes={TextAttributes.BOLD}>
            {event.event}
          </text>
        </box>
        <box flexGrow={1} justifyContent="center" alignItems="center">
          <text fg={colors.textMuted}>No historical data available for this indicator</text>
        </box>
      </box>
    );
  }

  // No API key
  if (!fredApiKey) {
    return (
      <box flexDirection="column" width={width} height={height}>
        <box height={1} paddingX={1} flexDirection="row">
          <text fg={colors.textBright} attributes={TextAttributes.BOLD}>
            {event.event}
          </text>
          <box flexGrow={1} />
          <text fg={colors.textDim}>{mapping.seriesId}</text>
        </box>
        <box flexGrow={1} justifyContent="center" alignItems="center">
          <text fg={colors.textMuted}>{`Configure FRED API key: type '${FRED_API_KEY_COMMAND_LABEL}' in command bar`}</text>
        </box>
      </box>
    );
  }

  // Loading
  if (loading) {
    return (
      <box flexDirection="column" width={width} height={height}>
        <box height={1} paddingX={1} flexDirection="row">
          <text fg={colors.textBright} attributes={TextAttributes.BOLD}>
            {event.event}
          </text>
          <box flexGrow={1} />
          <text fg={colors.textDim}>{mapping.seriesId}</text>
        </box>
        <box flexGrow={1} justifyContent="center" alignItems="center">
          <text fg={colors.textMuted}>Loading...</text>
        </box>
      </box>
    );
  }

  // Error
  if (error) {
    return (
      <box flexDirection="column" width={width} height={height}>
        <box height={1} paddingX={1} flexDirection="row">
          <text fg={colors.textBright} attributes={TextAttributes.BOLD}>
            {event.event}
          </text>
          <box flexGrow={1} />
          <text fg={colors.textDim}>{mapping.seriesId}</text>
        </box>
        <box flexGrow={1} justifyContent="center" alignItems="center">
          <text fg={colors.negative}>{error}</text>
        </box>
      </box>
    );
  }

  if (!data) return null;

  const { observations, info } = data;
  const chartWidth = Math.max(10, width - 2);
  const chartHeight = Math.min(16, Math.max(8, Math.floor(height * 0.3)));

  // Build chart points (ascending order for chart), exclude null values
  const chartPoints: ProjectedChartPoint[] = observations
    .filter((obs): obs is FredObservation & { value: number } => obs.value != null)
    .map((obs) => ({
      date: new Date(obs.date),
      open: obs.value,
      high: obs.value,
      low: obs.value,
      close: obs.value,
      volume: 0,
    }));

  const palette = resolveChartPalette(colors, "positive");

  let chartResult: ReturnType<typeof renderChart> | null = null;
  if (chartPoints.length >= 2) {
    chartResult = renderChart(chartPoints, {
      width: chartWidth,
      height: chartHeight,
      showVolume: false,
      volumeHeight: 0,
      cursorX: null,
      cursorY: null,
      mode: "area",
      colors: palette,
      timeAxisDates: chartPoints.map((p) => p.date),
    });
  }

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
    <box flexDirection="column" width={width} height={height}>
      {/* Header */}
      <box height={1} paddingX={1} flexDirection="row">
        <text fg={colors.textBright} attributes={TextAttributes.BOLD}>
          {title}
        </text>
        <box flexGrow={1} />
        <text fg={colors.textDim}>{mapping.seriesId}</text>
      </box>
      <box height={1} paddingX={1} flexDirection="row">
        <text fg={colors.textMuted}>
          {[units, info?.frequency, info?.seasonalAdjustment].filter(Boolean).join(" · ")}
        </text>
      </box>

      {/* Event context — scheduled time, forecast, prior */}
      <box paddingX={1} flexDirection="row" height={1}>
        <text fg={colors.textDim}>Scheduled: </text>
        <text fg={colors.text}>{event.time}</text>
        {event.forecast ? (
          <>
            <text fg={colors.textDim}>  Forecast: </text>
            <text fg={colors.text}>{event.forecast}</text>
          </>
        ) : null}
        {event.prior ? (
          <>
            <text fg={colors.textDim}>  Prior: </text>
            <text fg={colors.text}>{event.prior}</text>
          </>
        ) : null}
      </box>

      {/* Scrollable content */}
      <scrollbox ref={scrollRef} flexGrow={1} scrollY focusable={false}>
        <box flexDirection="column">
          {/* Chart */}
          {chartResult ? (
            <box flexDirection="column" paddingX={1} marginTop={1}>
              <box flexDirection="column" height={chartHeight} backgroundColor={palette.bgColor}>
                {chartResult.lines.map((line, i) => (
                  <text key={i} content={chartLineContent(line)} />
                ))}
              </box>
              <text fg={colors.textDim}>{chartResult.timeLabels}</text>
            </box>
          ) : (
            <box paddingX={1} marginTop={1}>
              <text fg={colors.textMuted}>Not enough data for chart</text>
            </box>
          )}

          {/* Separator */}
          <box paddingX={1} height={1} marginTop={1}>
            <text fg={colors.border}>{separatorLine}</text>
          </box>

          {/* Historical readings */}
          <box paddingX={1} height={1}>
            <text fg={colors.textBright} attributes={TextAttributes.BOLD}>HISTORICAL READINGS</text>
          </box>
          <box paddingX={1} flexDirection="row" height={1}>
            <box width={dateColWidth}>
              <text fg={colors.textDim}>DATE</text>
            </box>
            <box width={valueColWidth} justifyContent="flex-end">
              <text fg={colors.textDim}>VALUE</text>
            </box>
          </box>
          {tableRows.map((row) => (
            <box key={row.date} paddingX={1} flexDirection="row" height={1}>
              <box width={dateColWidth}>
                <text fg={colors.textDim}>{row.date}</text>
              </box>
              <box width={valueColWidth} justifyContent="flex-end">
                <text fg={valueColor(row.display)}>{row.display}</text>
              </box>
            </box>
          ))}

          {/* Separator */}
          {mapping.relatedTickers.length > 0 ? (
            <box paddingX={1} height={1} marginTop={1}>
              <text fg={colors.border}>{separatorLine}</text>
            </box>
          ) : null}

          {/* Related tickers */}
          {mapping.relatedTickers.length > 0 ? (
            <box paddingX={1} height={1} flexDirection="row">
              <text fg={colors.textDim}>Related: </text>
              {mapping.relatedTickers.map((ticker, i) => (
                <box
                  key={ticker}
                  marginLeft={i > 0 ? 2 : 0}
                  onMouseDown={() => {
                    navigateTicker(ticker);
                  }}
                >
                  <text fg={colors.textBright} attributes={TextAttributes.UNDERLINE}>{ticker}</text>
                </box>
              ))}
            </box>
          ) : null}
        </box>
      </scrollbox>

    </box>
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

function chartLineContent(line: string | StyledContent): string | StyledText {
  return typeof line === "string" ? line : new StyledText(line.chunks);
}

// ---------------------------------------------------------------------------
// Main Calendar Pane
// ---------------------------------------------------------------------------

export function EconCalendarPane({ focused, width, height }: PaneProps) {
  const [events, setEvents] = useState<EconEvent[]>(sharedCache?.data ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [hoveredRowIdx, setHoveredRowIdx] = useState<number | null>(null);
  const [impactFilter, setImpactFilter] = useState<ImpactFilter>("all");
  const [countryFilter, setCountryFilter] = useState<CountryFilter>("all");
  const [now, setNow] = useState(Date.now());
  const [detailEvent, setDetailEvent] = useState<EconEvent | null>(null);

  const fetchGenRef = useRef(0);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const headerScrollRef = useRef<ScrollBoxRenderable>(null);
  const backfilledSeriesRef = useRef<Set<string>>(new Set());

  const [fredApiKey] = usePluginConfigState<string>(FRED_API_KEY_CONFIG_KEY, "");

  const syncHeaderScroll = useCallback(() => {
    const bodyScrollBox = scrollRef.current;
    const headerScrollBox = headerScrollRef.current;
    if (bodyScrollBox && headerScrollBox && headerScrollBox.scrollLeft !== bodyScrollBox.scrollLeft) {
      headerScrollBox.scrollLeft = bodyScrollBox.scrollLeft;
    }
  }, []);

  const handleBodyScrollActivity = useCallback(() => {
    syncHeaderScroll();
  }, [syncHeaderScroll]);

  const load = async (force = false) => {
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
  };

  useEffect(() => {
    if (sharedCache && Date.now() - sharedCache.fetchedAt < CACHE_TTL_MS) {
      setEvents(sharedCache.data);
      return;
    }
    load();
  }, []);

  // Tick every 30s to update staleness + countdown
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  // Backfill actual values for past US events using FRED
  useEffect(() => {
    if (!fredApiKey || events.length === 0) return;

    const nowTs = Date.now();
    const pastEvents = events.filter(
      (ev) =>
        ev.date.getTime() < nowTs &&
        ev.actual === null &&
        resolveFredMapping(ev.event, ev.country),
    );

    // Group by series ID to deduplicate fetches
    const seriesGroups = new Map<string, { mapping: ReturnType<typeof resolveFredMapping>; events: EconEvent[] }>();
    for (const ev of pastEvents) {
      const mapping = resolveFredMapping(ev.event, ev.country)!;
      if (backfilledSeriesRef.current.has(mapping.seriesId)) continue;
      const group = seriesGroups.get(mapping.seriesId);
      if (group) {
        group.events.push(ev);
      } else {
        seriesGroups.set(mapping.seriesId, { mapping, events: [ev] });
      }
    }

    if (seriesGroups.size === 0) return;

    (async () => {
      const results = await Promise.allSettled(
        [...seriesGroups.entries()].map(async ([seriesId, { mapping }]) => {
          const obs = await fetchFredObservations(fredApiKey, seriesId, {
            limit: mapping!.displayMode === "change" ? 2 : 1,
            sortOrder: "desc",
          });
          backfilledSeriesRef.current.add(seriesId);
          if (obs.length === 0 || obs[0]!.value === null) return null;

          let formatted: string;
          if (mapping!.displayMode === "change" && obs.length >= 2 && obs[1]!.value) {
            // Compute month-over-month percent change
            const current = obs[0]!.value!;
            const prior = obs[1]!.value!;
            const pctChange = ((current - prior) / Math.abs(prior)) * 100;
            formatted = `${pctChange >= 0 ? "" : "-"}${Math.abs(pctChange).toFixed(1)}%`;
          } else {
            const value = obs[0]!.value!;
            formatted = value.toLocaleString("en-US", { maximumFractionDigits: 1 });
          }
          return { seriesId, formatted };
        }),
      );

      const actuals = new Map<string, string>();
      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          actuals.set(result.value.seriesId, result.value.formatted);
        }
      }

      if (actuals.size === 0) return;

      setEvents((prev) =>
        prev.map((ev) => {
          if (ev.actual !== null) return ev;
          const mapping = resolveFredMapping(ev.event, ev.country);
          if (!mapping) return ev;
          const actual = actuals.get(mapping.seriesId);
          if (!actual) return ev;
          return { ...ev, actual };
        }),
      );
    })();
  }, [events, fredApiKey]);

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

  useKeyboard((event) => {
    if (!focused) return;

    // Detail mode handles its own keys
    if (detailEvent) return;

    if (event.name === "j" || event.name === "down") {
      setSelectedIdx((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (event.name === "k" || event.name === "up") {
      setSelectedIdx((prev) => Math.max(prev - 1, 0));
    } else if (event.name === "enter" || event.name === "return") {
      const ev = filtered[selectedIdx];
      if (ev) setDetailEvent(ev);
    } else if (event.name === "r") {
      load(true);
    } else if (event.name === "f") {
      setImpactFilter((prev) => {
        const idx = FILTER_CYCLE.indexOf(prev);
        return FILTER_CYCLE[(idx + 1) % FILTER_CYCLE.length]!;
      });
      setSelectedIdx(0);
    } else if (event.name === "c") {
      setCountryFilter((prev) => {
        const idx = COUNTRY_CYCLE.indexOf(prev);
        return COUNTRY_CYCLE[(idx + 1) % COUNTRY_CYCLE.length]!;
      });
      setSelectedIdx(0);
    }
  });

  // Scroll to keep selected row visible
  useEffect(() => {
    const sb = scrollRef.current;
    if (!sb?.viewport || filtered.length === 0 || selectedIdx < 0) return;
    const flatIdx = eventIdxToRowIdx.get(selectedIdx) ?? selectedIdx;
    const viewportHeight = Math.max(sb.viewport.height, 1);
    if (flatIdx < sb.scrollTop) {
      sb.scrollTo(flatIdx);
    } else if (flatIdx >= sb.scrollTop + viewportHeight) {
      sb.scrollTo(flatIdx - viewportHeight + 1);
    }
  }, [selectedIdx, filtered.length]);

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

  const calendarContent = (
    <box flexDirection="column" width={width} height={height}>
      {/* Header */}
      <box flexDirection="row" height={1} paddingX={1}>
        <text fg={colors.textBright} attributes={TextAttributes.BOLD}>
          Economic Calendar
        </text>
        <box marginLeft={1}>
          <text fg={colors.textDim}>[{impactFilter}]</text>
        </box>
        <box marginLeft={0}>
          <text fg={colors.textDim}>[{countryFilter}]</text>
        </box>
        <box marginLeft={1}>
          <text fg={colors.textMuted}>{filtered.length} events</text>
        </box>
        {nextEvent && nextCountdown && (
          <box marginLeft={1}>
            <text fg={colors.textMuted}>
              Next: {nextEvent.event.length > 16 ? nextEvent.event.slice(0, 16).trimEnd() : nextEvent.event} {nextCountdown}
            </text>
          </box>
        )}
        {loading && (
          <box marginLeft={1}>
            <text fg={colors.textMuted}>loading…</text>
          </box>
        )}
        <box flexGrow={1} />
        {staleness ? <text fg={colors.textMuted}>{staleness}</text> : null}
      </box>

      {/* Error state */}
      {error && (
        <box paddingX={1} paddingY={1}>
          <text fg={colors.negative}>Error: {error}</text>
        </box>
      )}

      <DataTable<DisplayRow, EconCalendarColumn>
        columns={columns}
        items={rows}
        sortColumnId={null}
        sortDirection="asc"
        onHeaderClick={handleHeaderClick}
        headerScrollRef={headerScrollRef}
        scrollRef={scrollRef}
        syncHeaderScroll={syncHeaderScroll}
        onBodyScrollActivity={handleBodyScrollActivity}
        hoveredIdx={hoveredRowIdx}
        setHoveredIdx={setHoveredRowIdx}
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

      <box height={1} paddingX={1}>
        <text fg={colors.textMuted}>[r]efresh</text>
      </box>
    </box>
  );

  const detailContent = detailEvent ? (
    <EconDetailView
      event={detailEvent}
      width={width}
      height={Math.max(height - 1, 1)}
      focused={focused}
    />
  ) : (
    <box flexGrow={1} />
  );

  return (
    <PageStackView
      focused={focused}
      detailOpen={!!detailEvent}
      onBack={() => setDetailEvent(null)}
      rootContent={calendarContent}
      detailContent={detailContent}
    />
  );
}

export const econCalendarPlugin: GloomPlugin = {
  id: "econ-calendar",
  name: "Economic Calendar",
  version: "1.0.0",
  description: "Upcoming economic events and releases",
  toggleable: true,

  setup(ctx) {
    attachEconCalendarPersistence(ctx.persistence);

    ctx.registerCommand({
      id: "econ-set-fred-key",
      label: FRED_API_KEY_COMMAND_LABEL,
      keywords: ["fred", "api", "key", "economic", "econ", "configure", "setup"],
      category: "config",
      description: "Configure your free FRED API key for historical economic data (fred.stlouisfed.org)",
      wizard: [
        {
          key: "apiKey",
          label: "FRED API Key",
          placeholder: "Paste your FRED API key",
          type: "password",
        },
      ],
      async execute(values) {
        const key = values?.apiKey?.trim();
        if (!key) return;
        await ctx.configState.set(FRED_API_KEY_CONFIG_KEY, key);
        ctx.notify({ body: "FRED API key saved", type: "success" });
      },
    });
  },

  dispose() {
    resetEconCalendarPersistence();
  },

  panes: [
    {
      id: "econ-calendar",
      name: "Economic Calendar",
      icon: "E",
      component: EconCalendarPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
    },
  ],

  paneTemplates: [
    {
      id: "econ-calendar-pane",
      paneId: "econ-calendar",
      label: "Economic Calendar",
      description: "Upcoming economic events, releases, and indicators.",
      keywords: ["econ", "economic", "calendar", "events", "macro", "releases", "fed", "cpi", "gdp"],
      shortcut: { prefix: "ECON" },
    },
  ],
};
