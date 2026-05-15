import type { GloomPlugin } from "../../../types/plugin";
import { normalizeTickerInput } from "../../../utils/ticker-search";
import { TickerDetailPane } from "./pane";
import { QuoteMonitorPane } from "./quote-monitor";
import {
  buildQuoteMonitorSettingsDef,
  buildQuoteMonitorPaneTitle,
  buildTickerDetailSettingsDef,
  getTickerDetailPaneSettings,
} from "./settings";
import { formatTickerListInput } from "../../../utils/ticker-list";

export { FinancialsTab } from "./financials-tab";
export { QuoteMonitorPane } from "./quote-monitor";

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
      defaultFloatingSize: { width: 72, height: 10 },
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
      description: "Open a compact quote monitor for one or more tickers",
      keywords: ["quote", "monitor", "price", "ticker", "pane"],
      shortcut: { prefix: "QQ", argPlaceholder: "tickers", argKind: "ticker-list" },
      wizard: [
        {
          key: "tickers",
          label: "Quote Tickers",
          placeholder: "AAPL, MSFT, NVDA",
          body: ["Enter one or more ticker symbols separated by commas."],
          type: "text",
        },
      ],
      canCreate: (context, options) => (
        (options?.symbols?.length ?? 0) > 0
        || normalizeTickerInput(context.activeTicker, options?.arg) !== null
      ),
      createInstance: (context, options) => {
        const symbols = options?.symbols?.length
          ? options.symbols
          : [normalizeTickerInput(context.activeTicker, options?.arg)].filter((symbol): symbol is string => !!symbol);
        const primarySymbol = symbols[0];
        return primarySymbol
          ? {
            title: buildQuoteMonitorPaneTitle(symbols),
            binding: { kind: "fixed", symbol: primarySymbol },
            settings: {
              symbol: primarySymbol,
              symbols,
              symbolsText: formatTickerListInput(symbols),
            },
            placement: "floating",
          }
          : null;
      },
    },
  ],
};
