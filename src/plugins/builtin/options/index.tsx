import type { PluginModule } from "../plugin-module";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { OptionsView } from "./view";

export const optionsModule: PluginModule = {
  panes: [
    {
      id: "options",
      name: "Options",
      icon: "O",
      component: OptionsView,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 112, height: 28 },
    },
  ],

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "options-pane",
      paneId: "options",
      label: "Options",
      description: "Options chain for the selected ticker.",
      keywords: ["options", "chain", "calls", "puts", "omon"],
      shortcut: "OMON",
    }),
  ],

  setup(ctx) {
    ctx.registerTickerResearchTab({
      id: "options",
      name: "Options",
      order: 35,
      component: OptionsView,
      isVisible: ({ hasOptionsChain }) => hasOptionsChain,
    });
  },
};
