import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { DataTable, type DataTableCell, type DataTableColumn } from "../../../components";
import type { GloomPlugin, PaneProps } from "../../../types/plugin";
import type { EarningsEvent } from "../../../types/data-provider";
import { colors } from "../../../theme/colors";
import { getSharedDataProvider } from "../../registry";
import { useAppSelector, getFocusedCollectionId } from "../../../state/app-context";
import { getCollectionTickers } from "../../../state/selectors";
import { formatCompact } from "../../../utils/format";
import { usePluginPaneState, usePluginTickerActions } from "../../plugin-runtime";
import {
  attachEarningsCalendarPersistence,
  loadEarningsCalendar,
  resetEarningsCalendarPersistence,
} from "./earnings-cache";

type DisplayRow =
  | { kind: "separator"; key: string; label: string }
  | { kind: "event"; key: string; event: EarningsEvent; eventIdx: number };

type EarningsColumnId = "date" | "symbol" | "name" | "epsEstimate" | "revenueEstimate";
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

function buildColumns(width: number): EarningsColumn[] {
  const dateWidth = 8;
  const symbolWidth = 8;
  const epsWidth = 10;
  const revenueWidth = 10;
  const columnCount = 5;
  const fixedWidth = dateWidth + symbolWidth + epsWidth + revenueWidth;
  const nameWidth = Math.max(12, width - 2 - columnCount - fixedWidth);

  return [
    { id: "date", label: "DATE", width: dateWidth, align: "left" },
    { id: "symbol", label: "TICKER", width: symbolWidth, align: "left" },
    { id: "name", label: "NAME", width: nameWidth, align: "left" },
    { id: "epsEstimate", label: "EPS EST", width: epsWidth, align: "right" },
    { id: "revenueEstimate", label: "REV EST", width: revenueWidth, align: "right" },
  ];
}

function EarningsCalendarPane({ focused, width, height }: PaneProps) {
  const { navigateTicker } = usePluginTickerActions();
  const [events, setEvents] = useState<EarningsEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = usePluginPaneState<number>("selectedIdx", 0);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const headerScrollRef = useRef<ScrollBoxRenderable>(null);

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

  const reload = useCallback((force = false) => {
    if (tickerSymbols.length === 0) {
      setEvents([]);
      setError(null);
      setLoading(false);
      return;
    }

    const provider = getSharedDataProvider();
    setLoading(true);
    setError(null);
    loadEarningsCalendar(provider, tickerSymbols, { force })
      .then((data) => {
        setEvents(data);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [tickerSymbols]);

  useEffect(() => {
    reload(false);
  }, [reload]);

  useEffect(() => {
    if (eventCount > 0 && selectedIdx >= eventCount) {
      setSelectedIdx(eventCount - 1);
    }
  }, [eventCount, selectedIdx, setSelectedIdx]);

  useEffect(() => {
    const scrollBox = scrollRef.current;
    if (!scrollBox || selectedRowIndex < 0) return;
    scrollBox.scrollTo?.(0, Math.max(0, selectedRowIndex - Math.floor((height - 3) / 2)));
  }, [height, selectedRowIndex]);

  const openEvent = useCallback((event: EarningsEvent) => {
    navigateTicker(event.symbol);
  }, [navigateTicker]);

  const selectEventIndex = useCallback((index: number) => {
    if (eventCount === 0) return;
    setSelectedIdx(Math.min(Math.max(index, 0), eventCount - 1));
  }, [eventCount, setSelectedIdx]);

  useKeyboard((event) => {
    if (!focused) return;
    if (event.name === "j" || event.name === "down") {
      selectEventIndex(activeEventIdx + 1);
    } else if (event.name === "k" || event.name === "up") {
      selectEventIndex(activeEventIdx - 1);
    } else if (event.name === "return" || event.name === "enter") {
      const selected = eventRows[activeEventIdx];
      if (selected) openEvent(selected.event);
    } else if (event.name === "r") {
      reload(true);
    }
  });

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
          text: row.event.epsEstimate != null ? row.event.epsEstimate.toFixed(2) : "—",
          color: selectedColor ?? colors.textDim,
        };
      case "revenueEstimate":
        return {
          text: row.event.revenueEstimate != null ? formatCompact(row.event.revenueEstimate) : "—",
          color: selectedColor ?? colors.textDim,
        };
    }
  }, []);

  return (
    <box flexDirection="column" width={width} height={height}>
      <box height={1} paddingX={1} flexDirection="row">
        <text fg={colors.textDim}>
          {loading ? "loading..." : `${eventCount} upcoming`}
        </text>
      </box>

      {error ? (
        <box paddingX={1}>
          <text fg={colors.negative}>{error}</text>
        </box>
      ) : null}

      <DataTable<DisplayRow, EarningsColumn>
        columns={columns}
        items={rows}
        sortColumnId={null}
        sortDirection="asc"
        onHeaderClick={() => {}}
        headerScrollRef={headerScrollRef}
        scrollRef={scrollRef}
        syncHeaderScroll={syncHeaderScroll}
        onBodyScrollActivity={handleBodyScrollActivity}
        hoveredIdx={hoveredIdx}
        setHoveredIdx={setHoveredIdx}
        getItemKey={(row) => row.key}
        isSelected={(row) => row.kind === "event" && row.eventIdx === activeEventIdx}
        onSelect={selectDisplayRow}
        renderSectionHeader={renderSectionHeader}
        renderCell={renderCell}
        emptyStateTitle={loading ? "Loading earnings..." : "No upcoming earnings found"}
        showHorizontalScrollbar={false}
      />

      <box height={1} paddingX={1}>
        <text fg={colors.textMuted}>[r]efresh</text>
      </box>
    </box>
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
