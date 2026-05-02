import type { GloomPlugin, GloomPluginContext } from "../../types/plugin";
import { comparisonChartPlugin } from "./comparison-chart";
import { correlationPlugin } from "./correlation";
import { earningsPlugin } from "./earnings";
import { registerEconCalendarFeature } from "./econ";
import { fxMatrixPlugin } from "./fx-matrix";
import { holdersPlugin } from "./holders";
import { insiderPlugin } from "./insider";
import { marketMoversPlugin } from "./market-movers";
import { optionsPlugin } from "./options";
import { researchPlugin } from "./research";
import { secPlugin } from "./sec";
import { sectorsPlugin } from "./sectors";
import { registerYieldCurveFeature } from "./yield-curve";
import { worldIndicesPlugin } from "./world-indices";

type PluginGroupOptions = Pick<
  GloomPlugin,
  "id" | "name" | "description" | "toggleable" | "order"
> & {
  plugins: GloomPlugin[];
  setup?: (ctx: GloomPluginContext) => void | Promise<void>;
};

function createPluginGroup(options: PluginGroupOptions): GloomPlugin {
  return {
    id: options.id,
    name: options.name,
    version: "1.0.0",
    description: options.description,
    toggleable: options.toggleable,
    order: options.order,
    cliCommands: options.plugins.flatMap((plugin) => plugin.cliCommands ?? []),
    panes: options.plugins.flatMap((plugin) => plugin.panes ?? []),
    paneTemplates: options.plugins.flatMap((plugin) => plugin.paneTemplates ?? []),
    capabilities: options.plugins.flatMap((plugin) => plugin.capabilities ?? []),

    async setup(ctx) {
      await options.setup?.(ctx);
      for (const plugin of options.plugins) {
        await plugin.setup?.(ctx);
      }
    },

    dispose() {
      for (const plugin of [...options.plugins].reverse()) {
        plugin.dispose?.();
      }
    },
  };
}

export const companyResearchPlugin = createPluginGroup({
  id: "company-research",
  name: "Company Research",
  description: "Options, SEC filings, ownership, insider activity, analyst research, and corporate actions.",
  toggleable: true,
  plugins: [
    optionsPlugin,
    researchPlugin,
    holdersPlugin,
    secPlugin,
    insiderPlugin,
  ],
});

export const marketOverviewPlugin = createPluginGroup({
  id: "market-overview",
  name: "Market Overview",
  description: "Global indices, movers, sectors, FX, comparison charts, and correlations.",
  toggleable: true,
  plugins: [
    comparisonChartPlugin,
    correlationPlugin,
    worldIndicesPlugin,
    marketMoversPlugin,
    sectorsPlugin,
    fxMatrixPlugin,
  ],
});

export const macroPlugin = createPluginGroup({
  id: "macro",
  name: "Macro",
  description: "Economic calendar, yield curve, and earnings calendar.",
  toggleable: true,
  plugins: [earningsPlugin],
  setup(ctx) {
    registerEconCalendarFeature(ctx);
    registerYieldCurveFeature(ctx);
  },
});
