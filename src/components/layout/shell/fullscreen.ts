import { isPaneInLayout } from "../../../plugins/pane-manager";
import { cloneLayout, type LayoutConfig } from "../../../types/config";

export function resolvePaneFocusSourceLayout(
  layout: LayoutConfig,
  paneId: string | null,
): LayoutConfig | null {
  if (!paneId || !isPaneInLayout(layout, paneId)) return null;
  return cloneLayout(layout);
}
