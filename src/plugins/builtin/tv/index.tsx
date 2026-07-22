import type { PluginModule } from "../plugin-module";
import { TvPane } from "./pane";

export const tvModule: PluginModule = {
  panes: [{
    id: "macro-tv",
    name: "TV",
    icon: "T",
    component: TvPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 92, height: 32 },
  }],
  paneTemplates: [{
    id: "macro-tv-pane",
    paneId: "macro-tv",
    label: "TV",
    description: "Live Bloomberg, CNBC, and Yahoo Finance television.",
    keywords: [
      "tv",
      "television",
      "live tv",
      "finance tv",
      "financial television",
      "live stream",
      "market news",
      "business news",
      "markets",
      "news",
      "bloomberg",
      "bloomberg tv",
      "cnbc",
      "cnbc tv",
      "yahoo",
      "yahoo finance",
      "macro",
    ],
    shortcut: { prefix: "TV" },
  }],
};
