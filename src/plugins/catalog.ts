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
import { worldIndicesPlugin } from "./builtin/world-indices";
import { marketMoversPlugin } from "./builtin/market-movers";
import { debugPlugin } from "./builtin/debug";
import { layoutManagerPlugin } from "./builtin/layout-manager";
import { yahooPlugin } from "./builtin/yahoo";
import { predictionMarketsPlugin } from "./prediction-markets";

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
  worldIndicesPlugin,
  marketMoversPlugin,
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
