import type { GloomPlugin } from "../../../types/plugin";
import type { TickerFinancials } from "../../../types/financials";
import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import { normalizeTickerInput } from "../../../tickers/search";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { TickerChartPane, ChartResearchTab } from "./chart-pane";
import {
  createGraphPaneTemplate,
  FundamentalGraphPane,
  FundamentalGraphsResearchTab,
} from "./data-panes/fundamental-graph";
import { FinancialAnalysisPane, FinancialsResearchTab } from "./financials/pane";
import { HistoricalPricesPane } from "./data-panes/historical-prices";
import {
  createProviderSearchPaneTemplate,
  ProviderSearchPane,
} from "./data-panes/provider-search";
import { TickerResearchPane } from "./pane";
import { OverviewResearchTab } from "./overview/pane";
import { QuoteMonitorPane } from "./quote-monitor";
import {
  buildQuoteMonitorSettingsDef,
  buildQuoteMonitorPaneTitle,
  buildTickerChartSettingsDef,
  buildTickerResearchSettingsDef,
  getTickerResearchPaneSettings,
} from "./settings";
import { formatTickerListInput } from "../../../tickers/list";

function hasStatementFinancials(financials: TickerFinancials | null | undefined): boolean {
  return (financials?.annualStatements.length ?? 0) > 0 || (financials?.quarterlyStatements.length ?? 0) > 0;
}

export const tickerDetailPlugin: GloomPlugin = {
  id: "ticker-detail",
  name: "Ticker Research",
  version: "1.0.0",

  setup(ctx) {
    ctx.registerTickerResearchTab({
      id: "overview",
      name: "Overview",
      order: 10,
      component: OverviewResearchTab,
      isVisible: ({ ticker }) => !!ticker,
    });
    ctx.registerTickerResearchTab({
      id: "financials",
      name: "Financials",
      order: 20,
      component: FinancialsResearchTab,
      isVisible: ({ financials }) => hasStatementFinancials(financials),
    });
    ctx.registerTickerResearchTab({
      id: "chart",
      name: "Chart",
      order: 30,
      component: ChartResearchTab,
      isVisible: ({ ticker }) => !!ticker,
    });
    ctx.registerTickerResearchTab({
      id: "fundamental-graphs",
      name: "Graphs",
      order: 28,
      component: FundamentalGraphsResearchTab,
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
      id: TICKER_RESEARCH_PANE_ID,
      name: "Research",
      icon: "D",
      component: TickerResearchPane,
      defaultPosition: "right",
      defaultMode: "floating",
      settings: (context) => buildTickerResearchSettingsDef(getTickerResearchPaneSettings(context.settings)),
    },
    {
      id: "financial-analysis",
      name: "Financials",
      icon: "F",
      component: FinancialAnalysisPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 98, height: 30 },
    },
    {
      id: "ticker-chart",
      name: "Chart",
      icon: "G",
      component: TickerChartPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 92, height: 30 },
      settings: () => buildTickerChartSettingsDef(),
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
      paneId: TICKER_RESEARCH_PANE_ID,
      label: "Ticker Research",
      description: "Open another research pane for the selected ticker or current collection",
      keywords: ["new", "ticker", "research", "detail", "pane", "inspector"],
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
      paneId: "financial-analysis",
      label: "Financial Analysis",
      description: "Open financial statements for a ticker.",
      keywords: ["fa", "financial", "analysis", "statements"],
      shortcut: "FA",
      titlePrefix: "FA",
    }),
    createTickerSurfacePaneTemplate({
      id: "graph-price-pane",
      paneId: "ticker-chart",
      label: "Graph Price",
      description: "Open a price chart for a ticker.",
      keywords: ["gp", "graph", "price", "chart"],
      shortcut: "GP",
      viewKey: "price",
      settings: () => ({
        chartRangePreset: "5Y",
        chartResolution: "auto",
      }),
    }),
    createTickerSurfacePaneTemplate({
      id: "graph-intraday-price-pane",
      paneId: "ticker-chart",
      label: "Intraday Price Graph",
      description: "Open an intraday price chart for a ticker.",
      keywords: ["gip", "intraday", "graph", "chart"],
      shortcut: "GIP",
      viewKey: "intraday",
      settings: () => ({
        chartRangePreset: "1D",
        chartResolution: "1m",
      }),
    }),
  ],
};
