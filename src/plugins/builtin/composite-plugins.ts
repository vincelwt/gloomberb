import { portfolioAnalyticsModule } from "./analytics";
import { brokerManagerModule } from "./broker-manager";
import { changelogModule } from "./changelog";
import { chartComposerModule } from "./chart-composer";
import { correlationModule } from "./correlation";
import { economicCalendarModule } from "./econ";
import { earningsModule } from "./earnings";
import { fearGreedModule } from "./fear-greed";
import { fxMatrixModule } from "./fx-matrix";
import { helpModule } from "./help";
import { holdersModule } from "./holders";
import { insiderModule } from "./insider";
import { positionSizerModule } from "./kelly-sizer";
import { layoutManagerModule } from "./layout-manager";
import { marketHeatmapModule } from "./market-heatmap";
import { marketMoversModule } from "./market-movers";
import { tvModule } from "./tv";
import { optionsModule } from "./options";
import { composeBuiltinPlugin } from "./plugin-module";
import { portfolioListModule } from "./portfolio-list";
import { researchModule } from "./research";
import { secModule } from "./sec";
import { sectorsModule } from "./sectors";
import { thirteenFModule } from "./thirteenf";
import { tickerDetailModule } from "./ticker-detail";
import { worldIndicesModule } from "./world-indices";
import { yieldCurveModule } from "./yield-curve";

export const applicationPlugin = composeBuiltinPlugin({
  id: "application",
  name: "Application",
  version: "1.0.0",
  description: "Core layout, help, and release information.",
  modules: [layoutManagerModule, helpModule, changelogModule],
});

export const portfolioPlugin = composeBuiltinPlugin({
  id: "portfolio",
  name: "Portfolio",
  version: "1.0.0",
  description: "Portfolio and watchlist management, analytics, and position sizing.",
  toggleable: true,
  modules: [portfolioListModule, portfolioAnalyticsModule, positionSizerModule],
});

export const tickerResearchPlugin = composeBuiltinPlugin({
  id: "ticker-research",
  name: "Ticker Research",
  version: "1.0.0",
  description: "Company research workspace: overview, charts, financials, filings, ownership, options, analyst research, and events.",
  toggleable: true,
  modules: [
    tickerDetailModule,
    chartComposerModule,
    optionsModule,
    researchModule,
    holdersModule,
    thirteenFModule,
    secModule,
    insiderModule,
  ],
});

export const brokerPlugin = composeBuiltinPlugin({
  id: "broker",
  name: "Broker",
  version: "1.0.0",
  description: "Broker profiles, account sync, and connection status.",
  toggleable: true,
  modules: [brokerManagerModule],
});

export const marketOverviewPlugin = composeBuiltinPlugin({
  id: "market-overview",
  name: "Market Overview",
  version: "1.0.0",
  description: "Global indices, movers, sectors, FX, sentiment, and correlations.",
  toggleable: true,
  modules: [
    correlationModule,
    worldIndicesModule,
    marketHeatmapModule,
    marketMoversModule,
    fearGreedModule,
    sectorsModule,
    fxMatrixModule,
  ],
});

export const macroPlugin = composeBuiltinPlugin({
  id: "macro",
  name: "Macro",
  version: "1.0.0",
  description: "Economic calendar, yield curve, earnings calendar, and live financial TV.",
  toggleable: true,
  modules: [economicCalendarModule, yieldCurveModule, earningsModule, tvModule],
});
