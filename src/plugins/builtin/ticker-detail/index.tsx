import type { GloomPlugin } from "../../../types/plugin";
import { normalizeTickerInput } from "../../../utils/ticker-search";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import {
  createGraphPaneTemplate,
  FundamentalGraphPane,
  FundamentalGraphsDetailTab,
} from "./data-panes/fundamental-graph";
import { HistoricalPricesPane } from "./data-panes/historical-prices";
import {
  createProviderSearchPaneTemplate,
  ProviderSearchPane,
} from "./data-panes/provider-search";
import { TickerDetailPane } from "./pane";
import { QuoteMonitorPane } from "./quote-monitor";
import {
  buildQuoteMonitorSettingsDef,
  buildQuoteMonitorPaneTitle,
  buildTickerDetailSettingsDef,
  getTickerDetailPaneSettings,
} from "./settings";
import { formatTickerListInput } from "../../../utils/ticker-list";

export const tickerDetailPlugin: GloomPlugin = {
  id: "ticker-detail",
  name: "Ticker Detail",
  version: "1.0.0",

  setup(ctx) {
    ctx.registerDetailTab({
      id: "fundamental-graphs",
      name: "Graphs",
      order: 28,
      component: FundamentalGraphsDetailTab,
      isVisible: ({ ticker, financials }) => !!ticker && (
        (financials?.annualStatements.length ?? 0) > 0
        || (financials?.quarterlyStatements.length ?? 0) > 0
        || !!financials?.fundamentals
        || !!financials?.quote?.marketCap
      ),
    });
  },

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
    {
      id: "historical-prices",
      name: "Historical Prices",
      icon: "H",
      component: HistoricalPricesPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 92, height: 26 },
    },
    {
      id: "fundamental-graph",
      name: "Fundamental Graph",
      icon: "G",
      component: FundamentalGraphPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 82, height: 22 },
    },
    {
      id: "provider-search-results",
      name: "Provider Search",
      icon: "S",
      component: ProviderSearchPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 86, height: 24 },
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
    createTickerSurfacePaneTemplate({
      id: "historical-prices-pane",
      paneId: "historical-prices",
      label: "Historical Prices",
      description: "Open a historical OHLCV table for a ticker.",
      keywords: ["historical", "prices", "hp", "ohlc", "volume"],
      shortcut: "HP",
    }),
    createGraphPaneTemplate({
      id: "fundamental-graph-pane",
      label: "Fundamental Graph",
      description: "Graph statement metrics for one or more tickers.",
      shortcut: "GF",
      chartKind: "fundamental",
    }),
    createGraphPaneTemplate({
      id: "valuation-graph-pane",
      label: "Valuation Graph",
      description: "Graph valuation multiples for one or more tickers.",
      shortcut: "GE",
      chartKind: "valuation",
    }),
    createProviderSearchPaneTemplate(),
    createTickerSurfacePaneTemplate({
      id: "financial-analysis-pane",
      paneId: "ticker-detail",
      label: "Financial Analysis",
      description: "Open a ticker detail pane locked to financial statements.",
      keywords: ["fa", "financial", "analysis", "statements"],
      shortcut: "FA",
      settings: () => ({
        hideTabs: true,
        lockedTabId: "financials",
      }),
    }),
    createTickerSurfacePaneTemplate({
      id: "graph-price-pane",
      paneId: "ticker-detail",
      label: "Graph Price",
      description: "Open a ticker detail pane locked to a price chart.",
      keywords: ["gp", "graph", "price", "chart"],
      shortcut: "GP",
      settings: () => ({
        hideTabs: true,
        lockedTabId: "chart",
        chartRangePreset: "5Y",
        chartResolution: "auto",
      }),
    }),
    createTickerSurfacePaneTemplate({
      id: "graph-intraday-price-pane",
      paneId: "ticker-detail",
      label: "Intraday Price Graph",
      description: "Open a ticker detail pane locked to an intraday chart.",
      keywords: ["gip", "intraday", "graph", "chart"],
      shortcut: "GIP",
      settings: () => ({
        hideTabs: true,
        lockedTabId: "chart",
        chartRangePreset: "1D",
        chartResolution: "1m",
      }),
    }),
  ],
};
