import { saveConfig } from "../../data/config-store";
import { createPaneInstance, findPaneInstance, type LayoutConfig } from "../../types/config";
import type { GloomPlugin, GloomPluginContext } from "../../types/plugin";
import type { AppAction } from "../../state/app-context";
import { getSharedRegistry } from "../registry";
import {
  addPaneFloating,
  dockPane,
  floatPane,
  isPaneInLayout,
  removePane,
} from "../pane-manager";

const MAX_COLUMNS = 4;

let dispatchRef: ((action: AppAction) => void) | null = null;
let getStateRef: (() => { layout: LayoutConfig; termWidth: number; termHeight: number }) | null = null;

export function setLayoutManagerDispatch(
  dispatch: (action: AppAction) => void,
  getState: () => { layout: LayoutConfig; termWidth: number; termHeight: number },
) {
  dispatchRef = dispatch;
  getStateRef = getState;
}

function persistLayout(layout: LayoutConfig) {
  if (!dispatchRef) return;
  dispatchRef({ type: "UPDATE_LAYOUT", layout });
  const registry = getSharedRegistry();
  if (!registry) return;
  const config = registry.getConfigFn();
  const layouts = config.layouts.map((savedLayout, index) => (
    index === config.activeLayoutIndex ? { ...savedLayout, layout } : savedLayout
  ));
  saveConfig({ ...config, layout, layouts }).catch(() => {});
}

export const layoutManagerPlugin: GloomPlugin = {
  id: "layout-manager",
  name: "Layout Manager",
  version: "1.0.0",
  description: "Pane layout management commands",

  setup(ctx) {
    ctx.registerCommand({
      id: "float-pane",
      label: "Float Pane",
      description: "Detach a docked pane into a floating window",
      keywords: ["float", "detach", "undock", "window", "pane"],
      category: "config",
      execute: async () => {
        if (!getStateRef) return;
        const registry = getSharedRegistry();
        if (!registry) return;

        const { layout, termWidth, termHeight } = getStateRef();
        const dockedPanes = layout.docked
          .map((entry) => {
            const instance = findPaneInstance(layout, entry.instanceId);
            const def = instance ? registry.panes.get(instance.paneId) : null;
            return def && instance ? { id: entry.instanceId, name: def.name } : null;
          })
          .filter(Boolean) as Array<{ id: string; name: string }>;

        if (dockedPanes.length === 0) {
          ctx.showToast("No docked panes to float", { type: "info" });
          return;
        }

        const paneId = dockedPanes[0]!.id;
        const instance = findPaneInstance(layout, paneId);
        const def = instance ? registry.panes.get(instance.paneId) : undefined;
        const nextLayout = floatPane(layout, paneId, termWidth, termHeight, def);
        persistLayout(nextLayout);
        dispatchRef?.({ type: "FOCUS_PANE", paneId });
      },
    });

    ctx.registerCommand({
      id: "dock-pane",
      label: "Dock Pane",
      description: "Dock a floating pane back into the layout",
      keywords: ["dock", "attach", "pin", "pane"],
      category: "config",
      execute: async () => {
        if (!getStateRef) return;
        const registry = getSharedRegistry();
        if (!registry) return;

        const { layout } = getStateRef();
        const floatingPanes = layout.floating
          .map((entry) => {
            const instance = findPaneInstance(layout, entry.instanceId);
            const def = instance ? registry.panes.get(instance.paneId) : null;
            return def && instance ? { id: entry.instanceId, name: def.name } : null;
          })
          .filter(Boolean) as Array<{ id: string; name: string }>;

        if (floatingPanes.length === 0) {
          ctx.showToast("No floating panes to dock", { type: "info" });
          return;
        }

        const paneId = floatingPanes[0]!.id;
        const lastDockedPane = layout.docked[layout.docked.length - 1];
        if (!lastDockedPane) {
          persistLayout({
            columns: [{}],
            instances: layout.instances,
            docked: [{ instanceId: paneId, columnIndex: 0 }],
            floating: layout.floating.filter((entry) => entry.instanceId !== paneId),
          });
          dispatchRef?.({ type: "FOCUS_PANE", paneId });
          return;
        }

        const nextLayout = dockPane(layout, paneId, {
          relativeTo: lastDockedPane.instanceId,
          position: layout.columns.length + 1 > MAX_COLUMNS ? "below" : "right",
        });
        persistLayout(nextLayout);
        dispatchRef?.({ type: "FOCUS_PANE", paneId });
      },
    });

    ctx.registerCommand({
      id: "add-pane",
      label: "Add Pane",
      description: "Add a pane to the layout",
      keywords: ["add", "pane", "panel", "show"],
      category: "config",
      execute: async () => {
        if (!getStateRef) return;
        const registry = getSharedRegistry();
        if (!registry) return;

        const { layout, termWidth, termHeight } = getStateRef();
        const pane = [...registry.panes.values()][0];
        if (!pane) return;
        const instance = createPaneInstance(pane.id);
        persistLayout(addPaneFloating(layout, instance, termWidth, termHeight, pane));
        dispatchRef?.({ type: "FOCUS_PANE", paneId: instance.instanceId });
      },
    });

    ctx.registerCommand({
      id: "remove-pane",
      label: "Remove Pane",
      description: "Remove a pane from the layout",
      keywords: ["remove", "pane", "close", "hide", "panel"],
      category: "config",
      execute: async () => {
        if (!getStateRef) return;
        const { layout } = getStateRef();
        const paneIds = [...layout.docked.map((entry) => entry.instanceId), ...layout.floating.map((entry) => entry.instanceId)];
        if (paneIds.length === 0) {
          ctx.showToast("No panes to remove", { type: "info" });
          return;
        }
        persistLayout(removePane(layout, paneIds[paneIds.length - 1]!));
      },
    });

    ctx.registerCommand({
      id: "new-layout",
      label: "New Layout",
      description: "Create a new layout",
      keywords: ["new", "create", "add", "layout", "workspace"],
      category: "config",
      wizard: [{ key: "name", label: "Layout name", placeholder: "e.g. Trading, Research, Overview" }],
      execute: async (values) => {
        const name = values?.name?.trim();
        if (!name) {
          ctx.showToast("Layout name is required", { type: "error" });
          return;
        }
        dispatchRef?.({ type: "NEW_LAYOUT", name });
        ctx.showToast(`Layout "${name}" created`, { type: "success" });
      },
    });

    ctx.registerCommand({
      id: "delete-layout",
      label: "Delete Layout",
      description: "Delete the current layout preset",
      keywords: ["delete", "remove", "layout", "preset"],
      category: "config",
      execute: async () => {
        const registry = getSharedRegistry();
        if (!registry) return;
        const config = registry.getConfigFn();
        if (config.layouts.length <= 1) {
          ctx.showToast("Can't delete the only layout", { type: "error" });
          return;
        }
        const index = config.activeLayoutIndex;
        const name = config.layouts[index]!.name;
        dispatchRef?.({ type: "DELETE_LAYOUT", index });
        ctx.showToast(`Layout "${name}" deleted`, { type: "success" });
      },
    });

    ctx.registerCommand({
      id: "rename-layout",
      label: "Rename Layout",
      description: "Rename the current layout preset",
      keywords: ["rename", "layout", "preset"],
      category: "config",
      wizard: [{ key: "name", label: "New name", placeholder: "Layout name" }],
      execute: async (values) => {
        const name = values?.name?.trim();
        if (!name) {
          ctx.showToast("Name is required", { type: "error" });
          return;
        }
        const registry = getSharedRegistry();
        if (!registry) return;
        dispatchRef?.({ type: "RENAME_LAYOUT", index: registry.getConfigFn().activeLayoutIndex, name });
        ctx.showToast(`Layout renamed to "${name}"`, { type: "success" });
      },
    });

    ctx.registerCommand({
      id: "duplicate-layout",
      label: "Duplicate Layout",
      description: "Create a copy of the current layout",
      keywords: ["duplicate", "copy", "clone", "layout"],
      category: "config",
      execute: async () => {
        const registry = getSharedRegistry();
        if (!registry) return;
        dispatchRef?.({ type: "DUPLICATE_LAYOUT", index: registry.getConfigFn().activeLayoutIndex });
        ctx.showToast("Layout duplicated", { type: "success" });
      },
    });

    ctx.registerCommand({
      id: "swap-panes",
      label: "Swap Panes",
      description: "Swap two pane positions",
      keywords: ["swap", "switch", "pane", "panel"],
      category: "config",
      execute: async () => {
        if (!getStateRef) return;
        const { layout } = getStateRef();
        if (layout.docked.length < 2) {
          ctx.showToast("Need at least 2 docked panes to swap", { type: "info" });
          return;
        }

        const [a, b] = layout.docked;
        const docked = layout.docked.map((entry) => {
          if (entry.instanceId === a!.instanceId) return { ...entry, columnIndex: b!.columnIndex, order: b!.order };
          if (entry.instanceId === b!.instanceId) return { ...entry, columnIndex: a!.columnIndex, order: a!.order };
          return entry;
        });
        persistLayout({ ...layout, docked });
      },
    });
  },
};
