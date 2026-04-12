import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { DataTable, type DataTableCell, type DataTableColumn } from "../../../components";
import type { GloomPlugin, GloomPluginContext, PaneProps } from "../../../types/plugin";
import type { AlertCondition, AlertRule } from "./types";
import { colors } from "../../../theme/colors";
import { getSharedRegistry } from "../../registry";
import { usePluginConfigState } from "../../plugin-runtime";
import {
  createAlert,
  evaluateAlert,
  formatAlertDescription,
  serializeAlerts,
  deserializeAlerts,
} from "./alert-engine";

const ALERTS_KEY = "alerts";
const POLL_INTERVAL_MS = 30_000;

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface AlertCommandInput {
  symbol: string;
  condition: AlertCondition;
  price: number;
}

function parseAlertCondition(value: string | undefined): AlertCondition | null {
  const normalized = value?.trim().toLowerCase();
  switch (normalized) {
    case ">":
    case "above":
    case "over":
    case "gt":
      return "above";
    case "<":
    case "below":
    case "under":
    case "lt":
      return "below";
    case "x":
    case "cross":
    case "crosses":
      return "crosses";
    default:
      return null;
  }
}

function parseAlertShortcutValues(input: string): Record<string, string> {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length > 3) {
    throw new Error("Use SA SYMBOL above|below|crosses PRICE.");
  }

  const values: Record<string, string> = {
    symbol: parts[0]!.toUpperCase(),
  };

  if (parts[1]) {
    const condition = parseAlertCondition(parts[1]);
    if (!condition) {
      throw new Error("Use above, below, crosses, >, <, or x.");
    }
    values.condition = condition;
  }

  if (parts[2]) {
    const price = Number.parseFloat(parts[2]!.replace(/^\$/, ""));
    if (!Number.isFinite(price)) {
      throw new Error("Use a numeric target price.");
    }
    values.price = String(price);
  }

  return values;
}

function parseAlertCommandValues(values?: Record<string, string>): AlertCommandInput | null {
  const shortcut = values?.shortcut?.trim();
  if (shortcut) {
    values = {
      ...values,
      ...parseAlertShortcutValues(shortcut),
    };
  }

  const symbol = values?.symbol?.trim().toUpperCase();
  const condition = parseAlertCondition(values?.condition);
  const priceStr = values?.price?.trim();
  if (!symbol || !condition || !priceStr) return null;
  const price = Number.parseFloat(priceStr);
  if (!Number.isFinite(price)) return null;
  return { symbol, condition, price };
}

type AlertColumnId =
  | "status"
  | "symbol"
  | "condition"
  | "target"
  | "last"
  | "triggered"
  | "rearm";

type AlertColumn = DataTableColumn & { id: AlertColumnId };

const ALERT_COLUMNS: AlertColumn[] = [
  { id: "status", label: "Status", width: 6 },
  { id: "symbol", label: "Symbol", width: 8 },
  { id: "condition", label: "Condition", width: 9 },
  { id: "target", label: "Target", width: 8, align: "right" },
  { id: "last", label: "Last", width: 8, align: "right" },
  { id: "triggered", label: "Triggered", width: 9 },
  { id: "rearm", label: "", width: 6 },
];

const ALERT_TABLE_CONTENT_WIDTH = ALERT_COLUMNS.reduce(
  (sum, column) => sum + column.width + 1,
  2,
);

export function AlertsPane({ focused, width, height, close }: PaneProps) {
  const [alertsJson, setAlertsJson] = usePluginConfigState<string>(ALERTS_KEY, "[]");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const headerScrollRef = useRef<ScrollBoxRenderable>(null);
  const showHorizontalScrollbar = ALERT_TABLE_CONTENT_WIDTH > width;

  const { alerts, rows, activeCount, triggeredCount } = useMemo(() => {
    const parsed = deserializeAlerts(alertsJson);
    const activeAlerts = parsed.filter((a) => a.status === "active");
    const triggeredAlerts = parsed
      .filter((a) => a.status === "triggered")
      .sort((a, b) => (b.triggeredAt ?? 0) - (a.triggeredAt ?? 0));

    return {
      alerts: parsed,
      rows: [...activeAlerts, ...triggeredAlerts],
      activeCount: activeAlerts.length,
      triggeredCount: triggeredAlerts.length,
    };
  }, [alertsJson]);

  const saveAlerts = useCallback((next: AlertRule[]) => {
    setAlertsJson(serializeAlerts(next));
  }, [setAlertsJson]);

  const deleteAlert = useCallback((id: string) => {
    saveAlerts(alerts.filter((a) => a.id !== id));
    setSelectedIdx((prev) => Math.max(0, Math.min(prev, rows.length - 2)));
  }, [alerts, rows.length, saveAlerts]);

  const rearmAlert = useCallback((id: string) => {
    saveAlerts(
      alerts.map((a) =>
        a.id === id ? { ...a, status: "active" as const, triggeredAt: undefined } : a,
      ),
    );
  }, [alerts, saveAlerts]);

  const openSetAlertCommand = useCallback(() => {
    getSharedRegistry()?.openPluginCommandWorkflow("set-alert");
  }, []);

  const deleteSelectedAlert = useCallback(() => {
    const selected = rows[selectedIdx];
    if (selected) deleteAlert(selected.id);
  }, [deleteAlert, rows, selectedIdx]);

  const syncHeaderScroll = useCallback(() => {
    const body = scrollRef.current;
    const header = headerScrollRef.current;
    if (body && header && header.scrollLeft !== body.scrollLeft) {
      header.scrollLeft = body.scrollLeft;
    }
  }, []);

  const handleBodyScrollActivity = useCallback(() => {
    syncHeaderScroll();
  }, [syncHeaderScroll]);

  useEffect(() => {
    setSelectedIdx((prev) => (rows.length === 0 ? 0 : Math.min(prev, rows.length - 1)));
  }, [rows.length]);

  useKeyboard((event) => {
    if (!focused) return;

    if (event.name === "j" || event.name === "down") {
      event.preventDefault?.();
      if (rows.length > 0) {
        setSelectedIdx((prev) => Math.min(prev + 1, rows.length - 1));
      }
    } else if (event.name === "k" || event.name === "up") {
      event.preventDefault?.();
      if (rows.length > 0) {
        setSelectedIdx((prev) => Math.max(prev - 1, 0));
      }
    } else if (event.name === "d") {
      event.preventDefault?.();
      deleteSelectedAlert();
    } else if (event.name === "return") {
      event.preventDefault?.();
      const selected = rows[selectedIdx];
      if (selected?.status === "triggered") rearmAlert(selected.id);
    } else if (event.name === "a" || event.name === "n") {
      event.preventDefault?.();
      openSetAlertCommand();
    } else if (event.name === "escape") {
      event.preventDefault?.();
      close?.();
    }
  });

  // Keep selection in scroll view
  useEffect(() => {
    const sb = scrollRef.current;
    if (!sb?.viewport || rows.length === 0 || selectedIdx < 0) return;
    const viewportHeight = Math.max(sb.viewport.height, 1);
    if (selectedIdx < sb.scrollTop) {
      sb.scrollTo(selectedIdx);
    } else if (selectedIdx >= sb.scrollTop + viewportHeight) {
      sb.scrollTo(selectedIdx - viewportHeight + 1);
    }
  }, [selectedIdx, rows.length]);

  const renderCell = useCallback((
    alert: AlertRule,
    column: AlertColumn,
    _index: number,
    rowState: { selected: boolean; hovered: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    const actionMouseDown = (handler: () => void) => (event: any) => {
      event.preventDefault?.();
      event.stopPropagation?.();
      handler();
    };

    switch (column.id) {
      case "status":
        return {
          text: alert.status === "triggered" ? "Trig" : "Active",
          color: selectedColor ?? (alert.status === "triggered" ? colors.positive : colors.textDim),
          attributes: alert.status === "triggered" ? TextAttributes.BOLD : TextAttributes.NONE,
        };
      case "symbol":
        return {
          text: alert.symbol,
          color: selectedColor ?? colors.textBright,
          attributes: TextAttributes.BOLD,
        };
      case "condition":
        return {
          text: alert.condition,
          color: selectedColor,
        };
      case "target":
        return { text: String(alert.targetPrice), color: selectedColor };
      case "last":
        return {
          text: alert.lastCheckedPrice == null ? "-" : String(alert.lastCheckedPrice),
          color: selectedColor ?? colors.textDim,
        };
      case "triggered":
        return {
          text: alert.triggeredAt ? relativeTime(alert.triggeredAt) : "-",
          color: selectedColor ?? colors.textDim,
        };
      case "rearm":
        return alert.status === "triggered"
          ? {
              text: "Re-arm",
              color: selectedColor ?? colors.textBright,
              onMouseDown: actionMouseDown(() => rearmAlert(alert.id)),
            }
          : { text: "-", color: selectedColor ?? colors.textDim };
    }
  }, [rearmAlert]);

  return (
    <box
      flexDirection="column"
      width={width}
      height={height}
      backgroundColor={colors.bg}
    >
      <box
        flexDirection="row"
        height={1}
        paddingX={1}
        backgroundColor={colors.bg}
      >
        <text fg={colors.textDim}>{activeCount} active</text>
        {triggeredCount > 0 && (
          <box marginLeft={1}>
            <text fg={colors.textMuted}>{triggeredCount} triggered</text>
          </box>
        )}
      </box>

      <DataTable<AlertRule, AlertColumn>
        columns={ALERT_COLUMNS}
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
        getItemKey={(alert) => alert.id}
        isSelected={(_alert, index) => index === selectedIdx}
        onSelect={(_alert, index) => setSelectedIdx(index)}
        onActivate={(alert) => {
          if (alert.status === "triggered") rearmAlert(alert.id);
        }}
        renderCell={renderCell}
        emptyStateTitle="No alerts"
        emptyStateHint="Use the action bar to create one."
        showHorizontalScrollbar={showHorizontalScrollbar}
      />

      <box
        flexDirection="row"
        height={1}
        paddingX={1}
        backgroundColor={colors.panel}
      >
        <box
          onMouseDown={(event: any) => {
            event.preventDefault?.();
            event.stopPropagation?.();
            openSetAlertCommand();
          }}
        >
          <text fg={colors.textDim}>[a]dd alert</text>
        </box>
        <box width={2} />
        <box
          onMouseDown={(event: any) => {
            event.preventDefault?.();
            event.stopPropagation?.();
            deleteSelectedAlert();
          }}
        >
          <text fg={rows.length > 0 ? colors.textDim : colors.textMuted}>[d]elete</text>
        </box>
      </box>
    </box>
  );
}

let pollInterval: ReturnType<typeof setInterval> | null = null;

function loadAlerts(ctx: GloomPluginContext): AlertRule[] {
  const json = ctx.configState.get<string>(ALERTS_KEY);
  if (!json) return [];
  return deserializeAlerts(json);
}

function saveAlerts(ctx: GloomPluginContext, alerts: AlertRule[]): void {
  ctx.configState.set(ALERTS_KEY, serializeAlerts(alerts));
}

export const alertsPlugin: GloomPlugin = {
  id: "alerts",
  name: "Alerts",
  version: "1.0.0",
  description: "Price trigger alerts with desktop notifications",
  toggleable: true,

  setup(ctx) {
    ctx.registerCommand({
      id: "set-alert",
      label: "Add Alert",
      description: "Create a price alert from a symbol, condition, and target price",
      keywords: ["add", "set", "alert", "price", "trigger", "notify", "alarm", "watch"],
      category: "data",
      shortcut: "SA",
      shortcutArg: {
        placeholder: "symbol condition price",
        kind: "text",
        parse: parseAlertShortcutValues,
      },
      wizardLayout: "form",
      wizard: [
        {
          key: "symbol",
          label: "Symbol",
          placeholder: "AAPL",
          type: "text",
        },
        {
          key: "condition",
          label: "Condition",
          type: "select",
          options: [
            { label: "Above", value: "above" },
            { label: "Below", value: "below" },
            { label: "Crosses", value: "crosses" },
          ],
        },
        {
          key: "price",
          label: "Target Price",
          placeholder: "200.00",
          type: "number",
        },
      ],
      async execute(values) {
        const input = parseAlertCommandValues(values);
        if (!input) return;

        const alert = createAlert(input.symbol, input.condition, input.price);
        const existing = loadAlerts(ctx);
        existing.push(alert);
        saveAlerts(ctx, existing);

        ctx.notify({
          body: `Alert set: ${formatAlertDescription(alert)}`,
          type: "info",
        });
      },
    });

    // Polling engine
    const poll = async () => {
      const alerts = loadAlerts(ctx);
      if (alerts.length === 0) return;

      const activeAlerts = alerts.filter((a) => a.status === "active");
      if (activeAlerts.length === 0) return;

      ctx.log.info("poll", { total: alerts.length, active: activeAlerts.length });

      let changed = false;
      for (const alert of alerts) {
        if (alert.status !== "active") continue;
        try {
          const quote = await ctx.dataProvider.getQuote(alert.symbol, "");
          if (!quote || typeof quote.price !== "number") {
            ctx.log.warn("poll: no quote", { symbol: alert.symbol });
            continue;
          }

          const triggered = evaluateAlert(alert, quote.price);

          if (triggered) {
            alert.status = "triggered";
            alert.triggeredAt = Date.now();
            ctx.log.info("poll: TRIGGERED", { symbol: alert.symbol, price: quote.price });
            ctx.notify({
              body: `${formatAlertDescription(alert)} triggered at ${quote.price}`,
              type: "success",
              desktop: "always",
              persistent: true,
              sound: "Glass",
            });
            changed = true;
          }
          alert.lastCheckedPrice = quote.price;
          changed = true;
        } catch (err) {
          ctx.log.error("poll: error", { symbol: alert.symbol, error: String(err) });
        }
      }

      if (changed) {
        saveAlerts(ctx, alerts);
      }
    };

    poll();
    pollInterval = setInterval(poll, POLL_INTERVAL_MS);

    ctx.registerPane({
      id: "alerts",
      name: "Alerts",
      icon: "A",
      component: AlertsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 65, height: 20 },
    });

    ctx.registerPaneTemplate({
      id: "alerts-pane",
      paneId: "alerts",
      label: "Alerts",
      description: "Price trigger alerts with notifications",
      keywords: ["alerts", "price", "trigger", "alarm", "watch", "notify"],
      shortcut: { prefix: "ALRT" },
    });
  },

  dispose() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  },
};
