import { useState, useEffect, useCallback, useRef } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { GloomPlugin, PaneProps } from "../../types/plugin";
import { useAppState } from "../../state/app-context";
import { colors, hoverBg } from "../../theme/colors";
import { debugLog, type LogEntry, type LogLevel } from "../../utils/debug-log";
import { writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

function exportDebugLogFile(options: {
  filterLevel?: LogLevel | null;
  filterSource?: string | null;
}): { ok: true; filename: string } | { ok: false } {
  const text = debugLog.exportAsText(
    options.filterLevel || options.filterSource
      ? { level: options.filterLevel ?? undefined, source: options.filterSource ?? undefined }
      : undefined,
  );
  const downloadsDir = join(homedir(), "Downloads");
  const filename = `gloomberb-debug-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.log`;
  const filepath = join(downloadsDir, filename);

  try {
    writeFileSync(filepath, text);
    return { ok: true, filename };
  } catch {
    return { ok: false };
  }
}

function levelColor(level: LogLevel): string {
  switch (level) {
    case "debug": return colors.textDim;
    case "info": return colors.positive;
    case "warn": return "#e5c07b";
    case "error": return colors.negative;
  }
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: "DBG",
  info: "INF",
  warn: "WRN",
  error: "ERR",
};

const ALL_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toISOString().slice(11, 23);
}

function DebugPane({ focused, width, height, close }: PaneProps) {
  const { dispatch } = useAppState();
  const [entries, setEntries] = useState<LogEntry[]>(() => debugLog.getEntries());
  const [filterLevel, setFilterLevel] = useState<LogLevel | null>(null);
  const [filterSource, setFilterSource] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const sourcesRef = useRef<string[]>(debugLog.getSources());

  useEffect(() => {
    const unsub = debugLog.subscribe(() => {
      const filtered = debugLog.getEntries(
        filterLevel || filterSource
          ? { level: filterLevel ?? undefined, source: filterSource ?? undefined }
          : undefined,
      );
      setEntries(filtered);
      sourcesRef.current = debugLog.getSources();
      if (autoScroll) setScrollOffset(0);
    });
    return unsub;
  }, [filterLevel, filterSource, autoScroll]);

  const exportLogs = useCallback(() => {
    const result = exportDebugLogFile({ filterLevel, filterSource });
    const registry = (globalThis as any).__gloomRegistry;
    if (result.ok) {
      registry?.notify?.({ body: `Exported to ~/Downloads/${result.filename}`, type: "success" });
      return;
    }
    registry?.notify?.({ body: "Failed to export logs", type: "error" });
  }, [filterLevel, filterSource]);

  const clearLogs = useCallback(() => {
    debugLog.clear();
    setEntries([]);
  }, []);

  useKeyboard((event) => {
    if (!focused) return;

    // Level filter cycling
    if (event.name === "l") {
      const currentIdx = filterLevel ? ALL_LEVELS.indexOf(filterLevel) : -1;
      const nextIdx = currentIdx + 1;
      setFilterLevel(nextIdx >= ALL_LEVELS.length ? null : ALL_LEVELS[nextIdx] ?? null);
      return;
    }

    // Source filter cycling
    if (event.name === "s") {
      const sources = sourcesRef.current;
      if (sources.length === 0) return;
      const currentIdx = filterSource ? sources.indexOf(filterSource) : -1;
      const nextIdx = currentIdx + 1;
      setFilterSource(nextIdx >= sources.length ? null : sources[nextIdx] ?? null);
      return;
    }

    // Export
    if (event.name === "e") {
      exportLogs();
      return;
    }

    // Clear
    if (event.name === "x") {
      clearLogs();
      return;
    }

    // Auto-scroll toggle
    if (event.name === "a") {
      setAutoScroll((prev) => !prev);
      return;
    }

    // Detail toggle
    if (event.name === "return" && selectedIdx >= 0) {
      setShowDetail((prev) => !prev);
      return;
    }

    // Navigation
    if (event.name === "j" || event.name === "down") {
      setAutoScroll(false);
      setSelectedIdx((prev) => Math.min(prev + 1, entries.length - 1));
      return;
    }
    if (event.name === "k" || event.name === "up") {
      setAutoScroll(false);
      setSelectedIdx((prev) => Math.max(prev - 1, 0));
      return;
    }

    if (event.name === "g" && !event.shift) {
      setSelectedIdx(0);
      setAutoScroll(false);
      return;
    }
    if (event.name === "g" && event.shift) {
      setSelectedIdx(entries.length - 1);
      setAutoScroll(true);
      return;
    }

    if (event.name === "escape") {
      if (showDetail) {
        setShowDetail(false);
      } else {
        close?.();
      }
      return;
    }
  });

  const headerHeight = 2;
  const footerHeight = 1;
  const contentWidth = Math.max(1, width - 2);
  const messageAreaHeight = Math.max(1, height - headerHeight - footerHeight);

  // Compute visible window
  const visibleCount = showDetail ? Math.max(1, messageAreaHeight - 4) : messageAreaHeight;
  const totalEntries = entries.length;

  // Keep selected entry visible
  let viewStart: number;
  if (autoScroll) {
    viewStart = Math.max(0, totalEntries - visibleCount);
    // In auto-scroll, selected follows bottom
  } else {
    if (selectedIdx < 0) {
      viewStart = Math.max(0, totalEntries - visibleCount);
    } else {
      viewStart = Math.max(0, Math.min(selectedIdx - Math.floor(visibleCount / 2), totalEntries - visibleCount));
    }
  }
  const visibleEntries = entries.slice(viewStart, viewStart + visibleCount);

  const selectedEntry = selectedIdx >= 0 && selectedIdx < entries.length ? entries[selectedIdx] : null;

  return (
    <box flexDirection="column" width={width} height={height}>
      {/* Header */}
      <box height={1} width={contentWidth} flexDirection="row" paddingLeft={1}>
        <text fg={colors.textBright} attributes={TextAttributes.BOLD}>Debug Log</text>
        <text fg={colors.textDim}> ({totalEntries})</text>
        <box flexGrow={1} />
        {filterLevel && (
          <text fg={levelColor(filterLevel)} attributes={TextAttributes.BOLD}>
            {" "}{filterLevel.toUpperCase()}{" "}
          </text>
        )}
        {filterSource && (
          <text fg={colors.positive}>
            {" "}{filterSource}{" "}
          </text>
        )}
        {autoScroll && <text fg={colors.textDim}> AUTO </text>}
      </box>
      <box height={1} width={contentWidth}>
        <text fg={colors.border}>{"-".repeat(contentWidth)}</text>
      </box>

      {/* Log entries */}
      <box
        height={visibleCount}
        flexDirection="column"
        onMouseScroll={(event: any) => {
          const dir = event.scroll?.direction;
          if (!dir) return;
          if (dir === "up" || dir === "down") {
            setAutoScroll(false);
            setSelectedIdx((prev) => {
              const next = dir === "up" ? prev - 3 : prev + 3;
              return Math.max(0, Math.min(next, entries.length - 1));
            });
          }
        }}
      >
        {visibleEntries.length === 0 && (
          <box alignItems="center" justifyContent="center" flexGrow={1}>
            <text fg={colors.textDim}>No log entries{filterLevel || filterSource ? " matching filter" : ""}</text>
          </box>
        )}
        {visibleEntries.map((entry, i) => {
          const globalIdx = viewStart + i;
          const isSelected = globalIdx === selectedIdx;
          const isHovered = globalIdx === hoveredIdx && !isSelected;
          const bgColor = isSelected ? colors.selected : isHovered ? hoverBg() : undefined;
          const ts = formatTimestamp(entry.timestamp);
          const lvl = LEVEL_LABELS[entry.level];
          const sourceTag = entry.source;
          const maxMsg = Math.max(0, contentWidth - ts.length - lvl.length - sourceTag.length - 8);
          const msg = entry.message.length > maxMsg
            ? entry.message.slice(0, maxMsg - 1) + "…"
            : entry.message;

          return (
            <box
              key={entry.id}
              height={1}
              width={contentWidth}
              flexDirection="row"
              backgroundColor={bgColor}
              onMouseMove={() => setHoveredIdx(globalIdx)}
              onMouseDown={() => { setSelectedIdx(globalIdx); setAutoScroll(false); }}
            >
              <text fg={colors.textMuted}> {ts} </text>
              <text fg={levelColor(entry.level)} attributes={TextAttributes.BOLD}>{lvl}</text>
              <text fg={colors.textDim}> [{sourceTag}] </text>
              <text fg={isSelected ? colors.selectedText ?? colors.textBright : colors.text}>
                {msg}
              </text>
            </box>
          );
        })}
      </box>

      {/* Detail panel */}
      {showDetail && selectedEntry && (
        <box flexDirection="column" height={4} width={contentWidth}>
          <box height={1} width={contentWidth}>
            <text fg={colors.border}>{"-".repeat(contentWidth)}</text>
          </box>
          <box paddingLeft={1} flexDirection="column">
            <text fg={colors.text}>{selectedEntry.message}</text>
            {selectedEntry.data !== undefined && (
              <text fg={colors.textDim}>
                {JSON.stringify(selectedEntry.data, null, 2).slice(0, contentWidth * 2)}
              </text>
            )}
          </box>
        </box>
      )}

      {/* Footer */}
      <box height={1} width={contentWidth} flexDirection="row" paddingLeft={1}>
        <text fg={colors.textMuted}>
          <span fg={colors.text}>l</span>evel
          {"  "}
          <span fg={colors.text}>s</span>ource
          {"  "}
          <span fg={colors.text}>e</span>xport
          {"  "}
          <span fg={colors.text}>x</span> clear
          {"  "}
          <span fg={colors.text}>a</span>uto-scroll
        </text>
      </box>
    </box>
  );
}

export const debugPlugin: GloomPlugin = {
  id: "debug",
  name: "Debug",
  version: "1.0.0",
  description: "View and export debug logs",
  toggleable: true,

  setup(ctx) {
    ctx.registerPane({
      id: "debug",
      name: "Debug Log",
      icon: "D",
      component: DebugPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 120, height: 30 },
    });

    ctx.registerCommand({
      id: "open-debug-log",
      label: "Debug Log",
      description: "Open the debug log viewer",
      keywords: ["debug", "log", "logs", "console", "errors"],
      category: "navigation",
      execute: () => {
        ctx.showWidget("debug");
      },
    });

    ctx.registerCommand({
      id: "export-debug-log",
      label: "Export Debug Log",
      description: "Export debug logs to ~/Downloads",
      keywords: ["export", "debug", "log", "download", "save"],
      category: "config",
      execute: () => {
        const result = exportDebugLogFile({});
        if (result.ok) {
          ctx.notify({ body: `Exported to ~/Downloads/${result.filename}`, type: "success" });
        } else {
          ctx.notify({ body: "Failed to export logs", type: "error" });
        }
      },
    });

  },
};
