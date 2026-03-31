import type { GloomPlugin } from "../../../types/plugin";
import { PortfolioListPane } from "./pane";
import { shouldToggleCashMarginDrawer } from "./header";
import {
  buildPortfolioPaneSettingsDef,
  createPortfolioPaneSettings,
  getPortfolioPaneSettings,
  resolveCollectionPaneId,
} from "./settings";

export { shouldToggleCashMarginDrawer };

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
  paneTemplates: [
    {
      id: "new-collection-pane",
      paneId: "portfolio-list",
      label: "Collection Pane",
      description: "Open another pane for the current portfolio or watchlist",
      keywords: ["portfolio", "watchlist", "collection", "pane", "list"],
      shortcut: { prefix: "PF" },
      canCreate: (context) => resolveCollectionPaneId(context) !== null,
      createInstance: (context) => {
        const collectionId = resolveCollectionPaneId(context);
        return collectionId
          ? {
            params: { collectionId },
            settings: createPortfolioPaneSettings({
              collectionScope: "custom",
              visibleCollectionIds: [collectionId],
              hideTabs: true,
              lockedCollectionId: collectionId,
            }) as unknown as Record<string, unknown>,
          }
          : null;
      },
    },
    {
      id: "new-portfolio-pane",
      paneId: "portfolio-list",
      label: "New Portfolio Pane",
      description: "Open another portfolio list pane",
      keywords: ["new", "portfolio", "pane", "list"],
      canCreate: (context) => context.config.portfolios.length > 0,
      createInstance: (context) => {
        const collectionId = context.activeCollectionId && context.config.portfolios.some((portfolio) => portfolio.id === context.activeCollectionId)
          ? context.activeCollectionId
          : (context.config.portfolios[0]?.id ?? null);
        if (!collectionId) return null;
        return {
          params: { collectionId },
          settings: createPortfolioPaneSettings({
            collectionScope: "portfolios",
            lockedCollectionId: collectionId,
          }) as unknown as Record<string, unknown>,
        };
      },
    },
    {
      id: "new-watchlist-pane",
      paneId: "portfolio-list",
      label: "New Watchlist Pane",
      description: "Open another watchlist pane",
      keywords: ["new", "watchlist", "pane", "list"],
      canCreate: (context) => context.config.watchlists.length > 0,
      createInstance: (context) => {
        const collectionId = context.activeCollectionId && context.config.watchlists.some((watchlist) => watchlist.id === context.activeCollectionId)
          ? context.activeCollectionId
          : (context.config.watchlists[0]?.id ?? null);
        if (!collectionId) return null;
        return {
          params: { collectionId },
          settings: createPortfolioPaneSettings({
            collectionScope: "watchlists",
            lockedCollectionId: collectionId,
          }) as unknown as Record<string, unknown>,
        };
      },
    },
  ],
};
