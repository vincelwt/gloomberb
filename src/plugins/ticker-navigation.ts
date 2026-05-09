import { findPaneInstance, type LayoutConfig, type PaneInstanceConfig } from "../types/config";
import { isPaneInLayout } from "./pane-manager";

export function resolveTickerNavigationDetailPane(
  layout: LayoutConfig,
  sourcePaneId: string | null,
): PaneInstanceConfig | null {
  const sourceInstance = sourcePaneId ? findPaneInstance(layout, sourcePaneId) : null;

  return (
    sourceInstance?.paneId === "ticker-detail" && isPaneInLayout(layout, sourceInstance.instanceId)
      ? sourceInstance
      : null
  )
    ?? layout.instances.find((instance) =>
      instance.paneId === "ticker-detail"
      && instance.binding?.kind === "follow"
      && instance.binding.sourceInstanceId === sourcePaneId
      && isPaneInLayout(layout, instance.instanceId)
    )
    ?? layout.instances.find((instance) =>
      instance.paneId === "ticker-detail"
      && instance.binding?.kind === "follow"
      && isPaneInLayout(layout, instance.instanceId)
    )
    ?? layout.instances.find((instance) =>
      instance.paneId === "ticker-detail"
      && isPaneInLayout(layout, instance.instanceId)
    )
    ?? null;
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
