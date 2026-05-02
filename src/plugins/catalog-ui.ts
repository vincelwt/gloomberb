import type { GloomPlugin } from "../types/plugin";
import { portfolioListPlugin } from "./builtin/portfolio-list";
import { tickerDetailPlugin } from "./builtin/ticker-detail";
import { manualEntryPlugin } from "./builtin/manual-entry";
import { newsPlugin } from "./builtin/news";
import { notesPlugin } from "./builtin/notes";
import { aiPlugin } from "./builtin/ai";
import { gloomberbCloudPlugin } from "./builtin/chat";
import { helpPlugin } from "./builtin/help";
import { ibkrPlugin } from "./ibkr";
import { layoutManagerPlugin } from "./builtin/layout-manager";
import { predictionMarketsPlugin } from "./prediction-markets";
import { analyticsPlugin } from "./builtin/analytics";
import { alertsPlugin } from "./builtin/alerts";
import { brokerManagerPlugin } from "./builtin/broker-manager";
import {
  companyResearchPlugin,
  macroPlugin,
  marketOverviewPlugin,
} from "./builtin/plugin-groups";

export const uiBuiltinPlugins: GloomPlugin[] = [
  gloomberbCloudPlugin,
  portfolioListPlugin,
  tickerDetailPlugin,
  manualEntryPlugin,
  ibkrPlugin,
  brokerManagerPlugin,
  layoutManagerPlugin,
  newsPlugin,
  companyResearchPlugin,
  notesPlugin,
  aiPlugin,
  helpPlugin,
  predictionMarketsPlugin,
  marketOverviewPlugin,
  macroPlugin,
  analyticsPlugin,
  alertsPlugin,
];

export function getRendererBuiltinPlugins(): GloomPlugin[] {
  return uiBuiltinPlugins;
}
