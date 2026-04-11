import { useState, useEffect, useRef } from "react";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type { GloomPlugin, GloomPluginContext, PaneProps } from "../../../types/plugin";
import type { AlertRule } from "./types";
import { colors } from "../../../theme/colors";
import { useAppDispatch } from "../../../state/app-context";
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

function conditionIcon(condition: string): string {
  switch (condition) {
    case "above": return "▲";
    case "below": return "▼";
    case "crosses": return "↕";
    default: return "?";
  }
}

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

const CONDITIONS: AlertCondition[] = ["above", "below", "crosses"];
const CONDITION_LABELS: Record<AlertCondition, string> = {
  above: "▲ Above",
  below: "▼ Below",
  crosses: "↕ Crosses",
};

type FormField = "symbol" | "condition" | "price";
const FORM_FIELDS: FormField[] = ["symbol", "condition", "price"];

function AlertsPane({ focused, width, height, close }: PaneProps) {
  const [alertsJson, setAlertsJson] = usePluginConfigState<string>(ALERTS_KEY, "[]");
  const alerts = deserializeAlerts(alertsJson);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const scrollRef = useRef<ScrollBoxRenderable>(null);

  const dispatch = useAppDispatch();

  // Inline add form state
  const [adding, setAdding] = useState(false);
  const [formSymbol, setFormSymbol] = useState("");
  const [formCondition, setFormCondition] = useState<AlertCondition>("below");
  const [formPrice, setFormPrice] = useState("");
  const [formField, setFormField] = useState<FormField>("symbol");

  const activeAlerts = alerts.filter((a) => a.status === "active");
  const triggeredAlerts = alerts
    .filter((a) => a.status === "triggered")
    .sort((a, b) => (b.triggeredAt ?? 0) - (a.triggeredAt ?? 0));

  const allDisplayed = [...activeAlerts, ...triggeredAlerts];
  const activeCount = activeAlerts.length;

  const saveAlerts = (next: AlertRule[]) => {
    setAlertsJson(serializeAlerts(next));
  };

  const deleteAlert = (id: string) => {
    saveAlerts(alerts.filter((a) => a.id !== id));
    setSelectedIdx((prev) => Math.max(0, Math.min(prev, allDisplayed.length - 2)));
  };

  const rearmAlert = (id: string) => {
    saveAlerts(
      alerts.map((a) =>
        a.id === id ? { ...a, status: "active" as const, triggeredAt: undefined } : a,
      ),
    );
  };

  // Capture input when form is active so app-level handlers don't steal keys
  useEffect(() => {
    dispatch({ type: "SET_INPUT_CAPTURED", captured: adding });
    return () => {
      if (adding) dispatch({ type: "SET_INPUT_CAPTURED", captured: false });
    };
  }, [adding, dispatch]);

  const startAdding = () => {
    setFormSymbol("");
    setFormCondition("below");
    setFormPrice("");
    setFormField("symbol");
    setAdding(true);
  };

  const submitForm = () => {
    const symbol = formSymbol.trim().toUpperCase();
    const price = parseFloat(formPrice);
    if (!symbol || isNaN(price)) return;
    const alert = createAlert(symbol, formCondition, price);
    saveAlerts([...alerts, alert]);
    setAdding(false);
  };

  const cancelForm = () => {
    setAdding(false);
  };

  useKeyboard((event) => {
    if (!focused) return;

    if (adding) {
      if (event.name === "escape") {
        cancelForm();
        return;
      }
      if (event.name === "return") {
        submitForm();
        return;
      }

      // Arrow keys move between fields (not j/k — those type characters)
      if (event.name === "down") {
        const idx = FORM_FIELDS.indexOf(formField);
        if (idx < FORM_FIELDS.length - 1) setFormField(FORM_FIELDS[idx + 1]!);
        return;
      }
      if (event.name === "up") {
        const idx = FORM_FIELDS.indexOf(formField);
        if (idx > 0) setFormField(FORM_FIELDS[idx - 1]!);
        return;
      }

      // Field-specific input handling
      // OpenTUI: event.name is the key name — single chars are "a", "b", "1", etc.
      const ch = event.name;
      const isChar = ch.length === 1;

      if (formField === "symbol") {
        if (event.name === "backspace") {
          setFormSymbol((prev) => prev.slice(0, -1));
        } else if (isChar && /[a-zA-Z0-9.=^-]/.test(ch)) {
          setFormSymbol((prev) => prev + ch.toUpperCase());
        }
      } else if (formField === "condition") {
        if (event.name === "left" || event.name === "h") {
          const idx = CONDITIONS.indexOf(formCondition);
          setFormCondition(CONDITIONS[(idx - 1 + CONDITIONS.length) % CONDITIONS.length]!);
        } else if (event.name === "right" || event.name === "l") {
          const idx = CONDITIONS.indexOf(formCondition);
          setFormCondition(CONDITIONS[(idx + 1) % CONDITIONS.length]!);
        }
      } else if (formField === "price") {
        if (event.name === "backspace") {
          setFormPrice((prev) => prev.slice(0, -1));
        } else if (isChar && /[0-9.]/.test(ch)) {
          setFormPrice((prev) => prev + ch);
        }
      }
      return;
    }

    if (event.name === "j" || event.name === "down") {
      setSelectedIdx((prev) => Math.min(prev + 1, allDisplayed.length - 1));
    } else if (event.name === "k" || event.name === "up") {
      setSelectedIdx((prev) => Math.max(prev - 1, 0));
    } else if (event.name === "d") {
      const selected = allDisplayed[selectedIdx];
      if (selected) deleteAlert(selected.id);
    } else if (event.name === "return") {
      const selected = allDisplayed[selectedIdx];
      if (selected?.status === "triggered") rearmAlert(selected.id);
    } else if (event.name === "a" || event.name === "n") {
      startAdding();
    } else if (event.name === "escape") {
      close?.();
    }
  });

  // Keep selection in scroll view
  useEffect(() => {
    const sb = scrollRef.current;
    if (!sb?.viewport || allDisplayed.length === 0 || selectedIdx < 0) return;
    const viewportHeight = Math.max(sb.viewport.height, 1);
    if (selectedIdx < sb.scrollTop) {
      sb.scrollTo(selectedIdx);
    } else if (selectedIdx >= sb.scrollTop + viewportHeight) {
      sb.scrollTo(selectedIdx - viewportHeight + 1);
    }
  }, [selectedIdx, allDisplayed.length]);

  const formFieldBg = (field: FormField) =>
    formField === field ? colors.selected : colors.panel;
  const formFieldFg = (field: FormField) =>
    formField === field ? colors.selectedText : colors.text;

  const formView = (
    <box flexDirection="column" paddingX={1} paddingY={1}>
      <box height={1}>
        <text fg={colors.textBright} attributes={TextAttributes.BOLD}>New Alert</text>
      </box>
      <box height={1} />
      {/* Symbol */}
      <box flexDirection="row" height={1}>
        <box width={12}><text fg={colors.textDim}>Symbol</text></box>
        <box backgroundColor={formFieldBg("symbol")} paddingX={1}>
          <text fg={formFieldFg("symbol")}>
            {formSymbol || (formField === "symbol" ? "▏" : "—")}
            {formField === "symbol" && formSymbol ? "▏" : ""}
          </text>
        </box>
      </box>
      <box height={1} />
      {/* Condition */}
      <box flexDirection="row" height={1}>
        <box width={12}><text fg={colors.textDim}>Condition</text></box>
        <box backgroundColor={formFieldBg("condition")} paddingX={1} flexDirection="row">
          {formField === "condition" && <text fg={colors.textDim}>◂ </text>}
          <text fg={formFieldFg("condition")}>{CONDITION_LABELS[formCondition]}</text>
          {formField === "condition" && <text fg={colors.textDim}> ▸</text>}
        </box>
      </box>
      <box height={1} />
      {/* Price */}
      <box flexDirection="row" height={1}>
        <box width={12}><text fg={colors.textDim}>Price</text></box>
        <box backgroundColor={formFieldBg("price")} paddingX={1}>
          <text fg={formFieldFg("price")}>
            {formPrice || (formField === "price" ? "▏" : "—")}
            {formField === "price" && formPrice ? "▏" : ""}
          </text>
        </box>
      </box>
      <box height={1} />
      <text fg={colors.textMuted}>↑/↓ move field · ←/→ change condition · Enter submit · Esc cancel</text>
    </box>
  );

  if (adding) {
    return (
      <box flexDirection="column" width={width} height={height}>
        {formView}
        <box flexGrow={1} />
      </box>
    );
  }

  if (allDisplayed.length === 0) {
    return (
      <box flexDirection="column" width={width} height={height} padding={1}>
        <box flexDirection="row" height={1}>
          <text fg={colors.textDim}>0 active</text>
        </box>
        <box flexGrow={1} justifyContent="center" alignItems="center">
          <text fg={colors.textMuted}>No alerts. Press [a] to add one.</text>
        </box>
        <box height={1}>
          <text fg={colors.textMuted}>[a]dd alert · Esc close</text>
        </box>
      </box>
    );
  }

  let rowIndex = 0;

  return (
    <box flexDirection="column" width={width} height={height}>
      {/* Header */}
      <box flexDirection="row" height={1} paddingX={1}>
        <text fg={colors.textDim}>{activeCount} active</text>
      </box>

      <scrollbox ref={scrollRef} flexGrow={1} scrollY focusable={false}>
        <box flexDirection="column">
          {/* Active section */}
          {activeAlerts.length > 0 && (
            <>
              <box height={1} paddingX={1}>
                <text fg={colors.textDim} attributes={TextAttributes.BOLD}>Active</text>
              </box>
              {activeAlerts.map((alert) => {
                const idx = rowIndex++;
                const isSelected = idx === selectedIdx;
                const bg = isSelected ? colors.selected : undefined;
                const fg = isSelected ? colors.selectedText : colors.text;
                return (
                  <box
                    key={alert.id}
                    flexDirection="row"
                    paddingX={1}
                    backgroundColor={bg}
                    onMouseDown={() => setSelectedIdx(idx)}
                  >
                    <text fg={isSelected ? colors.selectedText : colors.textDim}>
                      {conditionIcon(alert.condition)}{" "}
                    </text>
                    <text fg={isSelected ? colors.selectedText : colors.textBright} attributes={TextAttributes.BOLD}>
                      {alert.symbol}
                    </text>
                    <text fg={fg}>{" "}{alert.condition} {alert.targetPrice}</text>
                  </box>
                );
              })}
            </>
          )}

          {/* Triggered section */}
          {triggeredAlerts.length > 0 && (
            <>
              <box height={1} paddingX={1}>
                <text fg={colors.textDim} attributes={TextAttributes.BOLD}>Triggered</text>
              </box>
              {triggeredAlerts.map((alert) => {
                const idx = rowIndex++;
                const isSelected = idx === selectedIdx;
                const bg = isSelected ? colors.selected : undefined;
                return (
                  <box
                    key={alert.id}
                    flexDirection="row"
                    paddingX={1}
                    backgroundColor={bg}
                    onMouseDown={() => setSelectedIdx(idx)}
                  >
                    <text fg={isSelected ? colors.selectedText : colors.positive}>
                      {conditionIcon(alert.condition)}{" "}
                    </text>
                    <text fg={isSelected ? colors.selectedText : colors.positive} attributes={TextAttributes.BOLD}>
                      {alert.symbol}
                    </text>
                    <text fg={isSelected ? colors.selectedText : colors.positive}>
                      {" "}{alert.condition} {alert.targetPrice}
                    </text>
                    <text fg={isSelected ? colors.selectedText : colors.positive}> TRIGGERED</text>
                    {alert.triggeredAt && (
                      <text fg={isSelected ? colors.selectedText : colors.textDim}>
                        {" "}{relativeTime(alert.triggeredAt)}
                      </text>
                    )}
                  </box>
                );
              })}
            </>
          )}
        </box>
      </scrollbox>

      <box height={1} paddingX={1}>
        <text fg={colors.textMuted}>[a]dd alert · j/k navigate · d delete · Enter re-arm · Esc close</text>
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
      label: "Set Alert",
      keywords: ["alert", "price", "trigger", "notify", "alarm", "watch"],
      category: "data",
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
        const symbol = values?.symbol?.trim();
        const condition = values?.condition as "above" | "below" | "crosses" | undefined;
        const priceStr = values?.price?.trim();
        if (!symbol || !condition || !priceStr) return;
        const price = parseFloat(priceStr);
        if (isNaN(price)) return;

        const alert = createAlert(symbol, condition, price);
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
