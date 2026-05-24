import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DataTableView,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
} from "../../../components";
import { colors } from "../../../theme/colors";
import { TextAttributes } from "../../../ui";
import type { PaneProps } from "../../../types/plugin";
import { useMarketData, usePluginAppActions, usePluginConfigState } from "../../runtime";
import {
  deserializeAlerts,
  serializeAlerts,
} from "./alert-engine";
import { ALERTS_KEY, PANE_QUOTE_REFRESH_MS } from "./constants";
import {
  conditionLabel,
  formatAlertDistance,
  formatAlertTargetPrice,
  formatCurrentPrice,
  formatQuoteChecked,
  relativeTime,
} from "./format";
import {
  createQuoteErrorMessage,
  quoteAlertFields,
  quoteErrorAlertFields,
  resolveAlertQuote,
} from "./quotes";
import type { AlertRule } from "./types";

type AlertColumnId =
  | "status"
  | "symbol"
  | "current"
  | "target"
  | "away"
  | "condition"
  | "quote"
  | "triggered"
  | "rearm";

type AlertColumn = DataTableColumn & { id: AlertColumnId };

const ALERT_COLUMNS: AlertColumn[] = [
  { id: "status", label: "State", width: 6, align: "left" },
  { id: "symbol", label: "Symbol", width: 7, align: "left" },
  { id: "current", label: "Current", width: 9, align: "right" },
  { id: "target", label: "Target", width: 9, align: "right" },
  { id: "away", label: "Away", width: 8, align: "right" },
  { id: "condition", label: "Trigger", width: 7, align: "left" },
  { id: "quote", label: "Quote", width: 8, align: "left" },
  { id: "triggered", label: "Alerted", width: 8, align: "left" },
  { id: "rearm", label: "", width: 6, align: "left" },
];

const ALERT_TABLE_CONTENT_WIDTH = ALERT_COLUMNS.reduce(
  (sum, column) => sum + column.width + 1,
  2,
);

export function AlertsPane({ focused, width, height, close }: PaneProps) {
  const [alertsJson, setAlertsJson] = usePluginConfigState<string>(ALERTS_KEY, "[]");
  const marketData = useMarketData();
  const { openPluginCommandWorkflow } = usePluginAppActions();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const marketDataId = marketData?.id ?? null;
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

  const savePaneAlerts = useCallback((next: AlertRule[] | ((current: AlertRule[]) => AlertRule[])) => {
    setAlertsJson((currentJson) => {
      const current = deserializeAlerts(currentJson);
      const resolved = typeof next === "function" ? next(current) : next;
      return serializeAlerts(resolved);
    });
  }, [setAlertsJson]);

  const deleteAlert = useCallback((id: string) => {
    savePaneAlerts(alerts.filter((a) => a.id !== id));
    setSelectedIdx((prev) => Math.max(0, Math.min(prev, rows.length - 2)));
  }, [alerts, rows.length, savePaneAlerts]);

  const rearmAlert = useCallback((id: string) => {
    savePaneAlerts(
      alerts.map((a) =>
        a.id === id ? {
          ...a,
          status: "active" as const,
          triggeredAt: undefined,
          lastCheckError: undefined,
        } : a,
      ),
    );
  }, [alerts, savePaneAlerts]);

  const startAddAlert = useCallback(() => {
    openPluginCommandWorkflow("set-alert");
  }, [openPluginCommandWorkflow]);

  const deleteSelectedAlert = useCallback(() => {
    const selected = rows[selectedIdx];
    if (selected) deleteAlert(selected.id);
  }, [deleteAlert, rows, selectedIdx]);

  useEffect(() => {
    if (!marketData || rows.length === 0) return;
    const now = Date.now();
    const dueAlerts = rows.filter((alert) => (
      !alert.lastCheckedAt || now - alert.lastCheckedAt > PANE_QUOTE_REFRESH_MS
    ));
    if (dueAlerts.length === 0) return;

    let cancelled = false;
    void Promise.all(dueAlerts.map(async (alert) => {
      try {
        const quote = await resolveAlertQuote(marketData, alert.symbol);
        return { id: alert.id, patch: quoteAlertFields(quote) };
      } catch (error) {
        return {
          id: alert.id,
          patch: quoteErrorAlertFields(createQuoteErrorMessage(alert.symbol, error)),
        };
      }
    })).then((updates) => {
      if (cancelled || updates.length === 0) return;
      const patches = new Map(updates.map((update) => [update.id, update.patch]));
      savePaneAlerts((current) => current.map((alert) => {
        const patch = patches.get(alert.id);
        return patch ? { ...alert, ...patch } : alert;
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [marketDataId, rows, savePaneAlerts]);

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
      { id: "add", key: "a", label: "dd alert", onPress: startAddAlert },
      {
        id: "delete",
        key: "d",
        label: "elete",
        onPress: deleteSelectedAlert,
        disabled: rows.length === 0,
      },
    ],
  }), [
    activeCount,
    deleteSelectedAlert,
    rows.length,
    startAddAlert,
    triggeredCount,
  ]);

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
      startAddAlert();
      return true;
    }
    if (event.name === "escape") {
      event.preventDefault?.();
      close?.();
      return true;
    }
    return false;
  }, [close, deleteSelectedAlert, startAddAlert]);

  const renderCell = useCallback((
    alert: AlertRule,
    column: AlertColumn,
    _index: number,
    rowState: { selected: boolean; hovered: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    const actionMouseDown = (handler: () => void) => (
      event: { preventDefault?: () => void; stopPropagation?: () => void },
    ) => {
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
      case "current":
        return {
          text: formatCurrentPrice(alert, column.width),
          color: selectedColor ?? (alert.lastCheckError ? colors.negative : colors.text),
        };
      case "target":
        return { text: formatAlertTargetPrice(alert, column.width), color: selectedColor };
      case "away":
        return {
          text: formatAlertDistance(alert),
          color: selectedColor ?? colors.textDim,
        };
      case "condition":
        return {
          text: conditionLabel(alert.condition),
          color: selectedColor,
        };
      case "quote":
        return {
          text: formatQuoteChecked(alert),
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
