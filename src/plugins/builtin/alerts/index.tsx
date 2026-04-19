import { useCallback, useEffect, useMemo, useState } from "react";
import { TextAttributes } from "../../../ui";
import { DataTableView, usePaneFooter, type DataTableCell, type DataTableColumn, type DataTableKeyEvent } from "../../../components";
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
  { id: "status", label: "Status", width: 6, align: "left" },
  { id: "symbol", label: "Symbol", width: 8, align: "left" },
  { id: "condition", label: "Condition", width: 9, align: "left" },
  { id: "target", label: "Target", width: 8, align: "right" },
  { id: "last", label: "Last", width: 8, align: "right" },
  { id: "triggered", label: "Triggered", width: 9, align: "left" },
  { id: "rearm", label: "", width: 6, align: "left" },
];

const ALERT_TABLE_CONTENT_WIDTH = ALERT_COLUMNS.reduce(
  (sum, column) => sum + column.width + 1,
  2,
);

export function AlertsPane({ focused, width, height, close }: PaneProps) {
  const [alertsJson, setAlertsJson] = usePluginConfigState<string>(ALERTS_KEY, "[]");
  const [selectedIdx, setSelectedIdx] = useState(0);
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

  usePaneFooter("alerts", () => ({
    info: [
      {
        id: "active",
        parts: [
          { text: String(activeCount), tone: "value", bold: true },
          { text: "active", tone: "label" },
        ],
      },
      ...(triggeredCount > 0 ? [{
        id: "triggered",
        parts: [
          { text: String(triggeredCount), tone: "warning" as const, bold: true },
          { text: "triggered", tone: "label" as const },
        ],
      }] : []),
    ],
    hints: [
      { id: "add", key: "a", label: "dd alert", onPress: openSetAlertCommand },
      { id: "delete", key: "d", label: "elete", onPress: deleteSelectedAlert, disabled: rows.length === 0 },
    ],
  }), [activeCount, deleteSelectedAlert, openSetAlertCommand, rows.length, triggeredCount]);

  useEffect(() => {
    setSelectedIdx((prev) => (rows.length === 0 ? 0 : Math.min(prev, rows.length - 1)));
  }, [rows.length]);

  const handleTableKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name === "d") {
      event.preventDefault?.();
      deleteSelectedAlert();
      return true;
    }
    if (event.name === "a" || event.name === "n") {
      event.preventDefault?.();
      openSetAlertCommand();
      return true;
    }
    if (event.name === "escape") {
      event.preventDefault?.();
      close?.();
      return true;
    }
    return false;
  }, [close, deleteSelectedAlert, openSetAlertCommand]);

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
    <DataTableView<AlertRule, AlertColumn>
      focused={focused}
      selectedIndex={selectedIdx}
      onRootKeyDown={handleTableKeyDown}
      rootWidth={width}
      rootHeight={height}
      rootBackgroundColor={colors.bg}
      columns={ALERT_COLUMNS}
      items={rows}
      sortColumnId={null}
      sortDirection="asc"
      onHeaderClick={() => {}}
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
