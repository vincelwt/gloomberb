import type { GloomPlugin } from "../../../types/plugin";
import { formatMarketPrice } from "../../../utils/market-format";
import {
  createAlert,
  evaluateAlert,
  formatAlertDescription,
} from "./alert-engine";
import {
  parseAlertCommandValues,
  parseAlertShortcutValues,
} from "./command";
import { POLL_INTERVAL_MS } from "./constants";
import { AlertsPane } from "./pane";
import {
  createQuoteErrorMessage,
  quoteAlertFields,
  quoteErrorAlertFields,
  resolveAlertQuote,
} from "./quotes";
import {
  loadAlerts,
  saveAlerts,
} from "./storage";

let pollInterval: ReturnType<typeof setInterval> | null = null;

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
        kind: "ticker",
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
        if (!input) throw new Error("Use a symbol, condition, and target price.");

        const quote = await resolveAlertQuote(ctx.marketData, input.symbol);

        const alert = {
          ...createAlert(quote.symbol || input.symbol, input.condition, input.price),
          ...quoteAlertFields(quote),
        };
        const existing = loadAlerts(ctx);
        existing.push(alert);
        saveAlerts(ctx, existing);

        ctx.notify({
          body: `Alert set: ${formatAlertDescription(alert)} (current ${formatMarketPrice(quote.price, { minimumFractionDigits: 2 })})`,
          type: "success",
        });
      },
    });

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
          const quote = await ctx.marketData.getQuote(alert.symbol, "");
          if (!quote || typeof quote.price !== "number") {
            ctx.log.warn("poll: no quote", { symbol: alert.symbol });
            Object.assign(alert, quoteErrorAlertFields(`No quote found for "${alert.symbol}".`));
            changed = true;
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
          Object.assign(alert, quoteAlertFields(quote));
          changed = true;
        } catch (err) {
          ctx.log.error("poll: error", { symbol: alert.symbol, error: String(err) });
          Object.assign(alert, quoteErrorAlertFields(createQuoteErrorMessage(alert.symbol, err)));
          changed = true;
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
      defaultFloatingSize: { width: 82, height: 20 },
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
