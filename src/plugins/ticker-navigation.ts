import { findPaneInstance, type LayoutConfig, type PaneInstanceConfig } from "../types/config";
import { isPaneInLayout } from "./pane-manager";

export function resolveTickerNavigationReplacementPane(
  layout: LayoutConfig,
  sourcePaneId: string | null,
): PaneInstanceConfig | null {
  const sourceInstance = sourcePaneId ? findPaneInstance(layout, sourcePaneId) : null;
  return sourceInstance?.paneId === "ticker-detail" && isPaneInLayout(layout, sourceInstance.instanceId)
    ? sourceInstance
    : null;
}

export function findFixedTickerPaneForSymbol(
  layout: LayoutConfig,
  paneId: string,
  symbol: string,
): PaneInstanceConfig | null {
  return layout.instances.find((instance) =>
    instance.paneId === paneId
    && instance.binding?.kind === "fixed"
    && instance.binding.symbol === symbol
    && isPaneInLayout(layout, instance.instanceId)
  ) ?? null;
}

export function shouldFocusTickerNavigationTarget({
  sourcePaneId,
  currentFocusedPaneId,
  targetPaneId,
}: {
  sourcePaneId: string | null;
  currentFocusedPaneId: string | null;
  targetPaneId: string | null;
}): boolean {
  if (!sourcePaneId) return true;
  return currentFocusedPaneId === sourcePaneId || currentFocusedPaneId === targetPaneId;
}
