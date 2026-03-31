import type { GloomPlugin } from "../../../types/plugin";
import { normalizeTickerInput } from "../../../utils/ticker-search";
import { TickerDetailPane } from "./pane";
import { FinancialsTab } from "./financials-tab";
import { QuoteMonitorPane } from "./quote-monitor";
import {
  buildQuoteMonitorSettingsDef,
  buildTickerDetailSettingsDef,
  getTickerDetailPaneSettings,
} from "./settings";

export { FinancialsTab } from "./financials-tab";
export { QuoteMonitorPane } from "./quote-monitor";
export { buildVisibleDetailTabs } from "./settings";

export const tickerDetailPlugin: GloomPlugin = {
  id: "ticker-detail",
  name: "Ticker Detail",
  version: "1.0.0",

  panes: [
    {
      id: "ticker-detail",
      name: "Detail",
      icon: "D",
      component: TickerDetailPane,
      defaultPosition: "right",
      defaultMode: "floating",
      settings: (context) => buildTickerDetailSettingsDef(getTickerDetailPaneSettings(context.settings)),
    },
    {
      id: "quote-monitor",
      name: "Quote Monitor",
      icon: "Q",
      component: QuoteMonitorPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 64, height: 8 },
      settings: buildQuoteMonitorSettingsDef(),
    },
  ],
  paneTemplates: [
    {
      id: "new-ticker-detail-pane",
      paneId: "ticker-detail",
      label: "New Ticker Detail Pane",
      description: "Open another detail pane for the selected ticker or current collection",
      keywords: ["new", "ticker", "detail", "pane", "inspector"],
      canCreate: (context) => context.activeTicker !== null || context.activeCollectionId !== null,
      createInstance: (context) => (
        context.activeTicker
          ? {
            title: context.activeTicker,
            binding: { kind: "fixed", symbol: context.activeTicker },
          }
          : {}
      ),
    },
    {
      id: "quote-monitor-pane",
      paneId: "quote-monitor",
      label: "Quote Monitor",
      description: "Open a compact quote monitor for the selected ticker",
      keywords: ["quote", "monitor", "price", "ticker", "pane"],
      shortcut: { prefix: "QQ", argPlaceholder: "ticker", argKind: "ticker" },
      canCreate: (context, options) => (options?.symbol ?? normalizeTickerInput(context.activeTicker, options?.arg)) !== null,
      createInstance: (context, options) => {
        const ticker = options?.symbol ?? normalizeTickerInput(context.activeTicker, options?.arg);
        return ticker
          ? {
            title: ticker,
            binding: { kind: "fixed", symbol: ticker },
            settings: { symbol: ticker },
            placement: "floating",
          }
          : null;
      },
    },
  ],
};
