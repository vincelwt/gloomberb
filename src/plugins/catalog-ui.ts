import type { GloomPlugin } from "../types/plugin";
import { portfolioListPlugin } from "./builtin/portfolio-list";
import { newsPlugin } from "./builtin/news";
import { notesPlugin } from "./builtin/notes";
import { aiPlugin } from "./builtin/ai";
import { gloomberbCloudPlugin } from "./builtin/cloud";
import { changelogPlugin } from "./builtin/changelog";
import { helpPlugin } from "./builtin/help";
import { ibkrPlugin } from "./ibkr";
import { layoutManagerPlugin } from "./builtin/layout-manager";
import { predictionMarketsPlugin } from "./prediction-markets";
import { analyticsPlugin } from "./builtin/analytics";
import { alertsPlugin } from "./builtin/alerts";
import {
  brokerPlugin,
  macroPlugin,
  marketOverviewPlugin,
  tickerResearchPlugin,
} from "./builtin/plugin-groups";

export const uiBuiltinPlugins: GloomPlugin[] = [
  gloomberbCloudPlugin,
  portfolioListPlugin,
  tickerResearchPlugin,
  brokerPlugin,
  ibkrPlugin,
  layoutManagerPlugin,
  newsPlugin,
  notesPlugin,
  aiPlugin,
  changelogPlugin,
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
