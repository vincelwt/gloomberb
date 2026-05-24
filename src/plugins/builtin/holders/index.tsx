import type { GloomPlugin } from "../../../types/plugin";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { HoldersView } from "./pane";

export const holdersPlugin: GloomPlugin = {
  id: "holders",
  name: "Holders",
  version: "1.0.0",
  description: "Institutional holders by value and position change",
  toggleable: true,

  setup(ctx) {
    ctx.registerTickerResearchTab({
      id: "holders",
      name: "Holders",
      order: 42,
      component: HoldersView,
      isVisible: ({ ticker }) => !!ticker,
    });
  },

  panes: [
    {
      id: "holders",
      name: "Holders",
      icon: "H",
      component: HoldersView,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 105, height: 34 },
    },
  ],

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "holders-pane",
      paneId: "holders",
      label: "Holders",
      description: "Institutional holders for the selected ticker.",
      keywords: ["holders", "ownership", "institutional", "owners", "hds"],
      shortcut: "HDS",
    }),
  ],
};
