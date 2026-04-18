import { resolveCollectionForPane, resolveTickerForPane, type AppState } from "../../state/app-context";
import type { PaneInstanceConfig } from "../../types/config";
import type { PaneDef } from "../../types/plugin";

export function getPaneDisplayTitle(
  state: Pick<AppState, "config" | "paneState">,
  instance: PaneInstanceConfig,
  paneDef: PaneDef,
): string {
  if (instance.paneId === "ticker-detail") {
    const ticker = resolveTickerForPane(state as AppState, instance.instanceId);
    if (ticker) return ticker;
    const collectionId = resolveCollectionForPane(state as AppState, instance.instanceId);
    return state.config.portfolios.find((portfolio) => portfolio.id === collectionId)?.name
      ?? state.config.watchlists.find((watchlist) => watchlist.id === collectionId)?.name
      ?? instance.title
      ?? paneDef.name;
  }

  if (instance.title) return instance.title;

  if (instance.paneId === "portfolio-list") {
    const collectionId = resolveCollectionForPane(state as AppState, instance.instanceId);
    return state.config.portfolios.find((portfolio) => portfolio.id === collectionId)?.name
      ?? state.config.watchlists.find((watchlist) => watchlist.id === collectionId)?.name
      ?? paneDef.name;
  }

  const ticker = resolveTickerForPane(state as AppState, instance.instanceId);
  return ticker ? `${paneDef.name}: ${ticker}` : paneDef.name;
}
