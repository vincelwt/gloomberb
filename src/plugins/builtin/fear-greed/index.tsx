import type { GloomPlugin } from "../../../types/plugin";
import { FearGreedPane } from "./pane";

export const fearGreedPlugin: GloomPlugin = {
  id: "fear-greed",
  name: "Fear & Greed",
  version: "1.0.0",
  description: "CNN Fear & Greed sentiment gauge and market indicator charts.",
  toggleable: true,

  panes: [
    {
      id: "fear-greed",
      name: "Fear & Greed",
      icon: "G",
      component: FearGreedPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 110, height: 36 },
    },
  ],

  paneTemplates: [
    {
      id: "fear-greed-pane",
      paneId: "fear-greed",
      label: "Fear & Greed",
      description: "CNN Fear & Greed sentiment gauge with the seven indicator charts.",
      keywords: ["fear", "greed", "sentiment", "cnn", "market", "indicators", "gauge"],
      shortcut: { prefix: "FNG" },
    },
  ],
};
