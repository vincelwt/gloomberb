import type { GloomPlugin } from "../../../types/plugin";
import {
  attachSubstackPersistence,
  resetSubstackPersistence,
} from "./api/store";
import {
  SUBSTACK_PANE_ID,
  SUBSTACK_PLUGIN_ID,
} from "./types";
import { SubstackPane } from "./pane";

export const substackPlugin: GloomPlugin = {
  id: SUBSTACK_PLUGIN_ID,
  name: "Substack",
  version: "1.0.0",
  description: "Authenticated Substack reader feed and subscriptions",
  toggleable: true,

  setup(ctx) {
    attachSubstackPersistence(ctx.persistence);
  },

  dispose() {
    resetSubstackPersistence();
  },

  panes: [
    {
      id: SUBSTACK_PANE_ID,
      name: "Substack",
      icon: "S",
      component: SubstackPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 104, height: 32 },
    },
  ],

  paneTemplates: [
    {
      id: "substack-pane",
      paneId: SUBSTACK_PANE_ID,
      label: "Substack",
      description: "Open the authenticated Substack reader feed.",
      keywords: ["substack", "newsletter", "feed", "reader", "subscription"],
      shortcut: { prefix: "SUB" },
    },
  ],
};
