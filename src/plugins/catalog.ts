import type { GloomPlugin } from "../types/plugin";
import type { LoadedExternalPlugin } from "./loader";
import { portfolioListPlugin } from "./builtin/portfolio-list";
import { tickerDetailPlugin } from "./builtin/ticker-detail";
import { manualEntryPlugin } from "./builtin/manual-entry";
import { ibkrPlugin } from "./ibkr";
import { newsPlugin } from "./builtin/news";
import { secPlugin } from "./builtin/sec";
import { optionsPlugin } from "./builtin/options";
import { notesPlugin } from "./builtin/notes";
import { aiPlugin } from "./builtin/ai";
import { gloomberbCloudPlugin } from "./builtin/chat";
import { helpPlugin } from "./builtin/help";
import { comparisonChartPlugin } from "./builtin/comparison-chart";
import { econCalendarPlugin } from "./builtin/econ";
import { worldIndicesPlugin } from "./builtin/world-indices";
import { marketMoversPlugin } from "./builtin/market-movers";
import { debugPlugin } from "./builtin/debug";
import { layoutManagerPlugin } from "./builtin/layout-manager";
import { yahooPlugin } from "./builtin/yahoo";
import { predictionMarketsPlugin } from "./prediction-markets";
import { correlationPlugin } from "./builtin/correlation";
import { analyticsPlugin } from "./builtin/analytics";
import { insiderPlugin } from "./builtin/insider";
import { newsWirePlugin } from "./builtin/news-wire";
import { alertsPlugin } from "./builtin/alerts";
import { fxMatrixPlugin } from "./builtin/fx-matrix";
import { yieldCurvePlugin } from "./builtin/yield-curve";
import { sectorsPlugin } from "./builtin/sectors";
import { earningsPlugin } from "./builtin/earnings";

export interface PluginCatalogEntry {
  plugin: GloomPlugin;
  source: "builtin" | "external";
  path?: string;
  error?: string;
}

export const builtinPlugins: GloomPlugin[] = [
  yahooPlugin,
  gloomberbCloudPlugin,
  portfolioListPlugin,
  tickerDetailPlugin,
  manualEntryPlugin,
  ibkrPlugin,
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
  econCalendarPlugin,
  worldIndicesPlugin,
  marketMoversPlugin,
  newsWirePlugin,
  alertsPlugin,
  fxMatrixPlugin,
  yieldCurvePlugin,
  sectorsPlugin,
  earningsPlugin,
  debugPlugin,
];

export function getPluginCatalog(externalPlugins: LoadedExternalPlugin[] = []): PluginCatalogEntry[] {
  return [
    ...builtinPlugins.map((plugin) => ({
      plugin,
      source: "builtin" as const,
    })),
    ...externalPlugins.map((entry) => ({
      plugin: entry.plugin,
      source: "external" as const,
      path: entry.path,
      error: entry.error,
    })),
  ];
}

export function getLoadablePlugins(externalPlugins: LoadedExternalPlugin[] = []): GloomPlugin[] {
  return getPluginCatalog(externalPlugins)
    .filter((entry) => !entry.error)
    .map((entry) => entry.plugin);
}
