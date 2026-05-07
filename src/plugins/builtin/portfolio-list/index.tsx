import type { GloomPlugin, PaneTemplateContext, PaneTemplateInstanceConfig } from "../../../types/plugin";
import { PortfolioListPane } from "./pane";
import { shouldToggleCashMarginDrawer } from "./header";
import {
  buildPortfolioPaneSettingsDef,
  getPortfolioPaneSettings,
  resolveCollectionPaneId,
} from "./settings";
import { portfolioCliCommand, watchlistCliCommand } from "./cli/commands";

export { shouldToggleCashMarginDrawer };

function resolveCollectionIdForKind(context: PaneTemplateContext, kind: "portfolio" | "watchlist"): string | null {
  if (context.activeCollectionId) {
    const matchesKind = kind === "portfolio"
      ? context.config.portfolios.some((portfolio) => portfolio.id === context.activeCollectionId)
      : context.config.watchlists.some((watchlist) => watchlist.id === context.activeCollectionId);
    if (matchesKind) return context.activeCollectionId;
  }

  return kind === "portfolio"
    ? (context.config.portfolios[0]?.id ?? null)
    : (context.config.watchlists[0]?.id ?? null);
}

function createCollectionPaneInstance(
  context: PaneTemplateContext,
  kind?: "portfolio" | "watchlist",
): PaneTemplateInstanceConfig | null {
  const collectionId = kind ? resolveCollectionIdForKind(context, kind) : resolveCollectionPaneId(context);
  return collectionId ? { params: { collectionId } } : null;
}

export const portfolioListPlugin: GloomPlugin = {
  id: "portfolio-list",
  name: "Portfolio List",
  version: "1.0.0",
  panes: [
    {
      id: "portfolio-list",
      name: "Portfolio",
      icon: "P",
      component: PortfolioListPane,
      defaultPosition: "left",
      defaultMode: "floating",
      defaultWidth: "40%",
      settings: (context) => buildPortfolioPaneSettingsDef(
        context.config,
        getPortfolioPaneSettings(context.settings),
      ),
    },
  ],
  cliCommands: [
    portfolioCliCommand,
    watchlistCliCommand,
  ],
  paneTemplates: [
    {
      id: "new-collection-pane",
      paneId: "portfolio-list",
      label: "Collection Pane",
      description: "Open another pane for the current portfolio or watchlist",
      keywords: ["portfolio", "watchlist", "collection", "pane", "list"],
      shortcut: { prefix: "PF" },
      canCreate: (context) => resolveCollectionPaneId(context) !== null,
      createInstance: (context) => createCollectionPaneInstance(context),
    },
    {
      id: "new-portfolio-pane",
      paneId: "portfolio-list",
      label: "New Portfolio Pane",
      description: "Open another portfolio list pane",
      keywords: ["new", "portfolio", "pane", "list"],
      canCreate: (context) => context.config.portfolios.length > 0,
      createInstance: (context) => createCollectionPaneInstance(context, "portfolio"),
    },
    {
      id: "new-watchlist-pane",
      paneId: "portfolio-list",
      label: "New Watchlist Pane",
      description: "Open another watchlist pane",
      keywords: ["new", "watchlist", "pane", "list"],
      canCreate: (context) => context.config.watchlists.length > 0,
      createInstance: (context) => createCollectionPaneInstance(context, "watchlist"),
    },
  ],
};
