import type { GloomPlugin } from "../types/plugin";
import { portfolioListPlugin } from "./builtin/portfolio-list";
import { tickerDetailPlugin } from "./builtin/ticker-detail";
import { manualEntryPlugin } from "./builtin/manual-entry";
import { newsPlugin } from "./builtin/news";
import { secPlugin } from "./builtin/sec";
import { optionsPlugin } from "./builtin/options";
import { notesPlugin } from "./builtin/notes";
import { aiPlugin } from "./builtin/ai";
import { gloomberbCloudPlugin } from "./builtin/chat";
import { helpPlugin } from "./builtin/help";
import { ibkrPlugin } from "./ibkr";
import { comparisonChartPlugin } from "./builtin/comparison-chart";
import { worldIndicesPlugin } from "./builtin/world-indices";
import { marketMoversPlugin } from "./builtin/market-movers";
import { layoutManagerPlugin } from "./builtin/layout-manager";
import { predictionMarketsPlugin } from "./prediction-markets";
import { correlationPlugin } from "./builtin/correlation";
import { analyticsPlugin } from "./builtin/analytics";
import { insiderPlugin } from "./builtin/insider";
import { holdersPlugin } from "./builtin/holders";
import { alertsPlugin } from "./builtin/alerts";
import { fxMatrixPlugin } from "./builtin/fx-matrix";
import { sectorsPlugin } from "./builtin/sectors";
import { earningsPlugin } from "./builtin/earnings";
import { brokerManagerPlugin } from "./builtin/broker-manager";
import { researchPlugin } from "./builtin/research";

export const uiBuiltinPlugins: GloomPlugin[] = [
  gloomberbCloudPlugin,
  portfolioListPlugin,
  tickerDetailPlugin,
  manualEntryPlugin,
  ibkrPlugin,
  brokerManagerPlugin,
  layoutManagerPlugin,
  newsPlugin,
  secPlugin,
  optionsPlugin,
  notesPlugin,
  aiPlugin,
  helpPlugin,
  comparisonChartPlugin,
  predictionMarketsPlugin,
  correlationPlugin,
  analyticsPlugin,
  insiderPlugin,
  holdersPlugin,
  worldIndicesPlugin,
  marketMoversPlugin,
  alertsPlugin,
  fxMatrixPlugin,
  sectorsPlugin,
  earningsPlugin,
  researchPlugin,
];

export function getRendererBuiltinPlugins(): GloomPlugin[] {
  return uiBuiltinPlugins.map((plugin) => (
    plugin.dataSources?.length
      ? { ...plugin, dataSources: [] }
      : plugin
  ));
}
