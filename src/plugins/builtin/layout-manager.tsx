import type { GloomPlugin, GloomPluginContext } from "../../types/plugin";
import { getSharedRegistry } from "../registry";
import {
  floatPane, dockPane, addPaneFloating,
  removePane, isPaneInLayout,
} from "../pane-manager";
import type { LayoutConfig } from "../../types/config";
import { saveConfig } from "../../data/config-store";

const MAX_COLUMNS = 4;

let _ctx: GloomPluginContext | null = null;
let _dispatchFn: ((action: any) => void) | null = null;
let _getStateFn: (() => { layout: LayoutConfig; termWidth: number; termHeight: number }) | null = null;

/** Set the dispatch/state functions from the app (called after mount) */
export function setLayoutManagerDispatch(
  dispatch: (action: any) => void,
  getState: () => { layout: LayoutConfig; termWidth: number; termHeight: number },
) {
  _dispatchFn = dispatch;
  _getStateFn = getState;
}

function persistLayout(layout: LayoutConfig) {
  if (!_dispatchFn) return;
  _dispatchFn({ type: "UPDATE_LAYOUT", layout });
  const registry = getSharedRegistry();
  if (registry) {
    const config = registry.getConfigFn();
    saveConfig({ ...config, layout }).catch(() => {});
  }
}

export const layoutManagerPlugin: GloomPlugin = {
  id: "layout-manager",
  name: "Layout Manager",
  version: "1.0.0",
  description: "Pane layout management commands",

  setup(ctx) {
    _ctx = ctx;

    // Float Pane — detach a docked pane to a floating window
    ctx.registerCommand({
      id: "float-pane",
      label: "Float Pane",
      description: "Detach a docked pane into a floating window",
      keywords: ["float", "detach", "undock", "window", "pane"],
      category: "config",
      execute: async () => {
        if (!_getStateFn) return;
        const registry = getSharedRegistry();
        if (!registry) return;

        const { layout, termWidth, termHeight } = _getStateFn();
        const dockedPanes = layout.docked.map((d) => {
          const def = registry.panes.get(d.paneId);
          return def ? { id: d.paneId, name: def.name } : null;
        }).filter(Boolean) as { id: string; name: string }[];

        if (dockedPanes.length === 0) {
          ctx.showToast("No docked panes to float", { type: "info" });
          return;
        }

        // Use command bar to pick — for now, float the first non-focused one
        // TODO: integrate with wizard for selection
        const paneId = dockedPanes[0]!.id;
        const def = registry.panes.get(paneId);
        const newLayout = floatPane(layout, paneId, termWidth, termHeight, def);
        persistLayout(newLayout);
        if (_dispatchFn) _dispatchFn({ type: "FOCUS_PANE", paneId });
      },
    });

    // Dock Pane — dock a floating pane back
    ctx.registerCommand({
      id: "dock-pane",
      label: "Dock Pane",
      description: "Dock a floating pane back into the layout",
      keywords: ["dock", "attach", "pin", "pane"],
      category: "config",
      execute: async () => {
        if (!_getStateFn) return;
        const registry = getSharedRegistry();
        if (!registry) return;

        const { layout } = _getStateFn();
        const floatingPanes = layout.floating.map((f) => {
          const def = registry.panes.get(f.paneId);
          return def ? { id: f.paneId, name: def.name } : null;
        }).filter(Boolean) as { id: string; name: string }[];

        if (floatingPanes.length === 0) {
          ctx.showToast("No floating panes to dock", { type: "info" });
          return;
        }

        const paneId = floatingPanes[0]!.id;

        // Dock to the right of the last column's first pane
        const lastDockedPane = layout.docked[layout.docked.length - 1];
        if (lastDockedPane) {
          const colCount = layout.columns.length + 1;
          if (colCount > MAX_COLUMNS) {
            // Stack below instead of creating a new column
            const newLayout = dockPane(layout, paneId, {
              relativeTo: lastDockedPane.paneId,
              position: "below",
            });
            persistLayout(newLayout);
          } else {
            const newLayout = dockPane(layout, paneId, {
              relativeTo: lastDockedPane.paneId,
              position: "right",
            });
            persistLayout(newLayout);
          }
        } else {
          // No docked panes — create first column
          const newLayout: LayoutConfig = {
            columns: [{}],
            docked: [{ paneId, columnIndex: 0 }],
            floating: layout.floating.filter((f) => f.paneId !== paneId),
          };
          persistLayout(newLayout);
        }

        if (_dispatchFn) _dispatchFn({ type: "FOCUS_PANE", paneId });
      },
    });

    // Add Pane — add a registered pane that's not in the layout
    ctx.registerCommand({
      id: "add-pane",
      label: "Add Pane",
      description: "Add a pane to the layout",
      keywords: ["add", "pane", "panel", "show"],
      category: "config",
      execute: async () => {
        if (!_getStateFn) return;
        const registry = getSharedRegistry();
        if (!registry) return;

        const { layout, termWidth, termHeight } = _getStateFn();
        const availablePanes = [...registry.panes.values()].filter(
          (def) => !isPaneInLayout(layout, def.id)
        );

        if (availablePanes.length === 0) {
          ctx.showToast("All panes are already in the layout", { type: "info" });
          return;
        }

        // Add first available as floating
        const def = availablePanes[0]!;
        const newLayout = addPaneFloating(layout, def.id, termWidth, termHeight, def);
        persistLayout(newLayout);
        if (_dispatchFn) _dispatchFn({ type: "FOCUS_PANE", paneId: def.id });
      },
    });

    // Remove Pane — remove a pane from the layout
    ctx.registerCommand({
      id: "remove-pane",
      label: "Remove Pane",
      description: "Remove a pane from the layout",
      keywords: ["remove", "pane", "close", "hide", "panel"],
      category: "config",
      execute: async () => {
        if (!_getStateFn) return;
        const registry = getSharedRegistry();
        if (!registry) return;

        const { layout } = _getStateFn();
        // Get all visible panes
        const allPanes = [
          ...layout.docked.map((d) => d.paneId),
          ...layout.floating.map((f) => f.paneId),
        ];

        if (allPanes.length === 0) {
          ctx.showToast("No panes to remove", { type: "info" });
          return;
        }

        // Remove the last one (TODO: wizard selection)
        const paneId = allPanes[allPanes.length - 1]!;
        const newLayout = removePane(layout, paneId);
        persistLayout(newLayout);
      },
    });

    // Swap Panes
    ctx.registerCommand({
      id: "swap-panes",
      label: "Swap Panes",
      description: "Swap two pane positions",
      keywords: ["swap", "switch", "pane", "panel"],
      category: "config",
      execute: async () => {
        if (!_getStateFn) return;
        const { layout } = _getStateFn();

        if (layout.docked.length < 2) {
          ctx.showToast("Need at least 2 docked panes to swap", { type: "info" });
          return;
        }

        // Swap first two docked panes
        const [a, b] = layout.docked;
        const newDocked = layout.docked.map((d) => {
          if (d.paneId === a!.paneId) return { ...d, columnIndex: b!.columnIndex, order: b!.order };
          if (d.paneId === b!.paneId) return { ...d, columnIndex: a!.columnIndex, order: a!.order };
          return d;
        });

        persistLayout({ ...layout, docked: newDocked });
      },
    });
  },
};
