import { useCallback, useEffect, useMemo, useState } from "react";
import { TextAttributes } from "../../../ui";
import { DataTableView, usePaneFooter, type DataTableCell, type DataTableColumn, type DataTableKeyEvent } from "../../../components";
import type { GloomPlugin, PaneProps } from "../../../types/plugin";
import type { EarningsEvent } from "../../../types/data-provider";
import { colors } from "../../../theme/colors";
import { useAppSelector, getFocusedCollectionId } from "../../../state/app-context";
import { getCollectionTickers } from "../../../state/selectors";
import { formatCompact, formatNumber, formatPercent } from "../../../utils/format";
import { useAssetData, usePluginPaneState, usePluginTickerActions } from "../../plugin-runtime";
import {
  attachEarningsCalendarPersistence,
  loadEarningsCalendar,
  resetEarningsCalendarPersistence,
} from "./earnings-cache";

type DisplayRow =
  | { kind: "separator"; key: string; label: string }
  | { kind: "event"; key: string; event: EarningsEvent; eventIdx: number };

type EarningsColumnId =
  | "date"
  | "when"
  | "status"
  | "symbol"
  | "name"
  | "epsEstimate"
  | "epsRange"
  | "epsGrowth"
  | "epsTrend"
  | "epsRevisions"
  | "revenueEstimate"
  | "revenueRange"
  | "revenueGrowth"
  | "analysts";
type EarningsColumn = DataTableColumn & { id: EarningsColumnId };

function groupByRelativeDate(events: EarningsEvent[]): DisplayRow[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfterTomorrow = new Date(today);
  dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);

  const endOfWeek = new Date(today);
  endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));
  const endOfNextWeek = new Date(endOfWeek);
  endOfNextWeek.setDate(endOfNextWeek.getDate() + 7);

  const groups: { label: string; events: EarningsEvent[] }[] = [
    { label: "TODAY", events: [] },
    { label: "TOMORROW", events: [] },
    { label: "THIS WEEK", events: [] },
    { label: "NEXT WEEK", events: [] },
    { label: "LATER", events: [] },
  ];

  for (const event of events) {
    const date = event.earningsDate;
    if (date >= today && date < tomorrow) {
      groups[0]!.events.push(event);
    } else if (date >= tomorrow && date < dayAfterTomorrow) {
      groups[1]!.events.push(event);
    } else if (date >= dayAfterTomorrow && date < endOfWeek) {
      groups[2]!.events.push(event);
    } else if (date >= endOfWeek && date < endOfNextWeek) {
      groups[3]!.events.push(event);
    } else if (date >= endOfNextWeek) {
      groups[4]!.events.push(event);
    }
  }

  const rows: DisplayRow[] = [];
  let eventIdx = 0;
  for (const group of groups) {
    if (group.events.length === 0) continue;
    rows.push({ kind: "separator", key: `sep-${group.label}`, label: `${group.label} (${group.events.length})` });
    for (const event of group.events) {
      rows.push({
        kind: "event",
        key: `event-${event.symbol}-${event.earningsDate.getTime()}-${eventIdx}`,
        event,
        eventIdx,
      });
      eventIdx++;
    }
  }
  return rows;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function formatDate(date: Date): string {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`;
}

function formatTime(date: Date | null | undefined): string {
  if (!date) return "—";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatMaybeNumber(value: number | null | undefined, decimals = 2): string {
  return value == null ? "—" : formatNumber(value, decimals);
}

function formatRange(
  low: number | null | undefined,
  high: number | null | undefined,
  formatter: (value: number) => string,
): string {
  if (low == null && high == null) return "—";
  return `${low == null ? "—" : formatter(low)}-${high == null ? "—" : formatter(high)}`;
}

function formatRevisionSummary(event: EarningsEvent): string {
  const up = event.epsRevisionUp30d ?? event.epsRevisionUp7d;
  const down = event.epsRevisionDown30d ?? event.epsRevisionDown7d;
  if (up == null && down == null) return "—";
  return `${up ?? 0}/${down ?? 0}`;
}

function formatAnalystSummary(event: EarningsEvent): string {
  const eps = event.epsAnalysts;
  const revenue = event.revenueAnalysts;
  if (eps == null && revenue == null) return "—";
  if (eps === revenue || revenue == null) return String(eps);
  if (eps == null) return String(revenue);
  return `${eps}/${revenue}`;
}

function estimateColor(value: number | null | undefined, selectedColor: string | undefined): string | undefined {
  if (selectedColor) return selectedColor;
  if (value == null) return colors.textDim;
  return value >= 0 ? colors.positive : colors.negative;
}

function buildColumns(width: number): EarningsColumn[] {
  const dateWidth = 8;
  const whenWidth = 8;
  const statusWidth = 4;
  const symbolWidth = 8;
  const epsWidth = 8;
  const epsRangeWidth = 11;
  const growthWidth = 8;
  const trendWidth = 8;
  const revisionsWidth = 7;
  const revenueWidth = 9;
  const revenueRangeWidth = 13;
  const analystsWidth = 7;
  const columnCount = 14;
  const fixedWidth = dateWidth + whenWidth + statusWidth + symbolWidth + epsWidth
    + epsRangeWidth + growthWidth + trendWidth + revisionsWidth + revenueWidth
    + revenueRangeWidth + growthWidth + analystsWidth;
  const nameWidth = Math.max(14, width - 2 - columnCount - fixedWidth);

  return [
    { id: "date", label: "DATE", width: dateWidth, align: "left" },
    { id: "when", label: "WHEN", width: whenWidth, align: "left" },
    { id: "status", label: "ST", width: statusWidth, align: "left" },
    { id: "symbol", label: "TICKER", width: symbolWidth, align: "left" },
    { id: "name", label: "NAME", width: nameWidth, align: "left" },
    { id: "epsEstimate", label: "EPS", width: epsWidth, align: "right" },
    { id: "epsRange", label: "EPS RNG", width: epsRangeWidth, align: "right" },
    { id: "epsGrowth", label: "EPS YOY", width: growthWidth, align: "right" },
    { id: "epsTrend", label: "EPS 30D", width: trendWidth, align: "right" },
    { id: "epsRevisions", label: "REV", width: revisionsWidth, align: "right" },
    { id: "revenueEstimate", label: "SALES", width: revenueWidth, align: "right" },
    { id: "revenueRange", label: "SALES RNG", width: revenueRangeWidth, align: "right" },
    { id: "revenueGrowth", label: "SALES YOY", width: growthWidth, align: "right" },
    { id: "analysts", label: "ANL", width: analystsWidth, align: "right" },
  ];
}

function EarningsCalendarPane({ focused, width, height }: PaneProps) {
  const dataProvider = useAssetData();
  const { navigateTicker } = usePluginTickerActions();
  const [events, setEvents] = useState<EarningsEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = usePluginPaneState<number>("selectedIdx", 0);

  const state = useAppSelector((current) => current);
  const collectionId = getFocusedCollectionId(state);
  const tickerSymbols = useMemo(() => {
    if (collectionId) {
      return getCollectionTickers(state, collectionId).map((ticker) => ticker.metadata.ticker);
    }
    return [...state.tickers.values()].map((ticker) => ticker.metadata.ticker);
  }, [state.tickers, collectionId]);

  const rows = useMemo(() => groupByRelativeDate(events), [events]);
  const eventRows = useMemo(
    () => rows.filter((row): row is DisplayRow & { kind: "event" } => row.kind === "event"),
    [rows],
  );
  const eventCount = eventRows.length;
  const activeEventIdx = eventCount > 0 ? Math.min(Math.max(selectedIdx, 0), eventCount - 1) : -1;
  const selectedRowIndex = rows.findIndex((row) => row.kind === "event" && row.eventIdx === activeEventIdx);
  const columns = useMemo(() => buildColumns(width), [width]);

  const reload = useCallback((force = false) => {
    if (tickerSymbols.length === 0) {
      setEvents([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    loadEarningsCalendar(dataProvider, tickerSymbols, { force })
      .then((data) => {
        setEvents(data);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [dataProvider, tickerSymbols]);

  useEffect(() => {
    reload(false);
  }, [reload]);

  useEffect(() => {
    if (eventCount > 0 && selectedIdx >= eventCount) {
      setSelectedIdx(eventCount - 1);
    }
  }, [eventCount, selectedIdx, setSelectedIdx]);

  const openEvent = useCallback((event: EarningsEvent) => {
    navigateTicker(event.symbol);
  }, [navigateTicker]);

  const handleTableKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name === "r") {
      event.preventDefault?.();
      reload(true);
      return true;
    }
    return false;
  }, [reload]);

  const selectDisplayRow = useCallback((row: DisplayRow) => {
    if (row.kind !== "event") return;
    if (row.eventIdx === activeEventIdx) {
      openEvent(row.event);
      return;
    }
    setSelectedIdx(row.eventIdx);
  }, [activeEventIdx, openEvent, setSelectedIdx]);

  const renderSectionHeader = useCallback((row: DisplayRow) => {
    if (row.kind !== "separator") return null;
    return {
      text: row.label,
      color: colors.textBright,
      attributes: TextAttributes.BOLD,
    };
  }, []);

  const renderCell = useCallback((
    row: DisplayRow,
    column: EarningsColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    if (row.kind !== "event") return { text: "" };

    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "date":
        return { text: formatDate(row.event.earningsDate), color: selectedColor ?? colors.textDim };
      case "when":
        return {
          text: row.event.timing || formatTime(row.event.earningsCallDate),
          color: selectedColor ?? colors.textDim,
        };
      case "status":
        if (row.event.isDateEstimate == null) {
          return {
            text: "—",
            color: selectedColor ?? colors.textDim,
          };
        }
        return {
          text: row.event.isDateEstimate === true ? "est" : "firm",
          color: selectedColor ?? (row.event.isDateEstimate === true ? colors.warning : colors.textDim),
        };
      case "symbol":
        return {
          text: row.event.symbol,
          color: selectedColor ?? colors.text,
          attributes: TextAttributes.BOLD,
        };
      case "name":
        return { text: row.event.name, color: selectedColor ?? colors.text };
      case "epsEstimate":
        return {
          text: formatMaybeNumber(row.event.epsEstimate),
          color: selectedColor ?? colors.textDim,
        };
      case "epsRange":
        return {
          text: formatRange(row.event.epsLow, row.event.epsHigh, (value) => formatNumber(value, 2)),
          color: selectedColor ?? colors.textDim,
        };
      case "epsGrowth":
        return {
          text: row.event.epsGrowth != null ? formatPercent(row.event.epsGrowth) : "—",
          color: estimateColor(row.event.epsGrowth, selectedColor),
        };
      case "epsTrend": {
        const current = row.event.epsEstimate;
        const prior = row.event.epsTrend30dAgo ?? row.event.epsTrend7dAgo;
        const change = current != null && prior != null ? current - prior : null;
        return {
          text: change != null ? formatNumber(change, 2) : "—",
          color: estimateColor(change, selectedColor),
        };
      }
      case "epsRevisions": {
        const net = (row.event.epsRevisionUp30d ?? row.event.epsRevisionUp7d ?? 0)
          - (row.event.epsRevisionDown30d ?? row.event.epsRevisionDown7d ?? 0);
        return {
          text: formatRevisionSummary(row.event),
          color: selectedColor ?? (net > 0 ? colors.positive : net < 0 ? colors.negative : colors.textDim),
        };
      }
      case "revenueEstimate":
        return {
          text: row.event.revenueEstimate != null ? formatCompact(row.event.revenueEstimate) : "—",
          color: selectedColor ?? colors.textDim,
        };
      case "revenueRange":
        return {
          text: formatRange(row.event.revenueLow, row.event.revenueHigh, formatCompact),
          color: selectedColor ?? colors.textDim,
        };
      case "revenueGrowth":
        return {
          text: row.event.revenueGrowth != null ? formatPercent(row.event.revenueGrowth) : "—",
          color: estimateColor(row.event.revenueGrowth, selectedColor),
        };
      case "analysts":
        return {
          text: formatAnalystSummary(row.event),
          color: selectedColor ?? colors.textDim,
        };
    }
  }, []);

  usePaneFooter("earnings-calendar", () => ({
    info: [
      ...(loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : []),
    ],
    hints: [{ id: "refresh", key: "r", label: "efresh", onPress: () => reload(true) }],
  }), [error, loading, reload]);

  return (
    <DataTableView<DisplayRow, EarningsColumn>
      focused={focused}
      selectedIndex={selectedRowIndex}
      isNavigable={(row) => row.kind === "event"}
      onSelectIndex={(_index, row) => {
        if (row.kind === "event") setSelectedIdx(row.eventIdx);
      }}
      onActivateIndex={(_index, row) => {
        if (row.kind === "event") openEvent(row.event);
      }}
      onRootKeyDown={handleTableKeyDown}
      rootWidth={width}
      rootHeight={height}
      columns={columns}
      items={rows}
      sortColumnId={null}
      sortDirection="asc"
      onHeaderClick={() => {}}
      getItemKey={(row) => row.key}
      isSelected={(row) => row.kind === "event" && row.eventIdx === activeEventIdx}
      onSelect={selectDisplayRow}
      renderSectionHeader={renderSectionHeader}
      renderCell={renderCell}
      emptyStateTitle={loading ? "Loading earnings..." : "No upcoming earnings found"}
    />
  );
}

export const earningsPlugin: GloomPlugin = {
  id: "earnings-calendar",
  name: "Earnings Calendar",
  version: "1.0.0",
  description: "Upcoming earnings dates for tracked tickers",
  toggleable: true,

  setup(ctx) {
    attachEarningsCalendarPersistence(ctx.persistence);
  },

  dispose() {
    resetEarningsCalendarPersistence();
  },

  panes: [
    {
      id: "earnings-calendar",
      name: "Earnings Calendar",
      icon: "$",
      component: EarningsCalendarPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 85, height: 25 },
    },
  ],

  paneTemplates: [
    {
      id: "earnings-calendar-pane",
      paneId: "earnings-calendar",
      label: "Earnings Calendar",
      description: "Upcoming earnings dates and estimates for your tickers.",
      keywords: ["earn", "earnings", "calendar", "eps", "revenue", "quarterly"],
      shortcut: { prefix: "ERN" },
    },
  ],
};
