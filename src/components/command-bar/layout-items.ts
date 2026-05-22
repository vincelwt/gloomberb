import type { Dispatch } from "react";
import type { PluginRegistry, WindowEditMode } from "../../plugins/registry";
import {
  dockPane,
  floatPane,
  getDockedPaneIds,
  getLayoutPreview,
  gridlockAllPanes,
  removePane,
} from "../../plugins/pane-manager";
import type { AppAction, AppState } from "../../state/app-context";
import {
  DEFAULT_LAYOUT,
  cloneLayout,
  findPaneInstance,
  type LayoutConfig,
} from "../../types/config";
import { fuzzyFilter } from "../../utils/fuzzy-search";
import type { ResultItem } from "./list-model";
import type { CommandBarRoute } from "./workflow-types";

const WINDOW_MODE_COMMAND_OPTIONS: Array<{
  mode: WindowEditMode;
  label: string;
  detail: string;
  query: string;
  searchText: string;
}> = [
  {
    mode: "move",
    label: "Move Window",
    detail: "Enter window edit mode with Tab cycling windows",
    query: "WIN move",
    searchText: "window mode move reposition",
  },
  {
    mode: "resize",
    label: "Resize Window",
    detail: "Enter window edit mode with Tab cycling resize handles",
    query: "WIN resize",
    searchText: "window mode resize size corner divider",
  },
];

type CloseAll = (options?: { revertThemePreview?: boolean }) => void;

type OpenInlineConfirm = (options: {
  confirmId: string;
  title: string;
  body: string[];
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  onConfirm: () => void | Promise<void>;
  successBehavior?: "close" | "back" | "stay";
}) => void;

export function parseWindowModeCommandArg(arg: string): WindowEditMode | null {
  const normalized = arg.trim().toLowerCase();
  if (!normalized) return null;
  if ("move".startsWith(normalized) || normalized === "m") return "move";
  if ("resize".startsWith(normalized) || normalized === "r") return "resize";
  return null;
}

export function buildWindowModeResultItems({
  arg,
  closeAll,
  focusedPaneId,
  pluginRegistry,
}: {
  arg: string;
  closeAll: CloseAll;
  focusedPaneId: string | null;
  pluginRegistry: PluginRegistry;
}): ResultItem[] {
  const normalized = arg.trim().toLowerCase();
  const exactMode = parseWindowModeCommandArg(arg);
  const options = normalized
    ? WINDOW_MODE_COMMAND_OPTIONS.filter((option) => (
      option.mode === exactMode
      || option.mode.startsWith(normalized)
      || fuzzyFilter([option], normalized, (item) => `${item.label} ${item.detail} ${item.searchText}`).length > 0
    ))
    : WINDOW_MODE_COMMAND_OPTIONS;

  const visibleOptions = options.length > 0 ? options : WINDOW_MODE_COMMAND_OPTIONS;
  return visibleOptions.map((option) => ({
    id: `window-mode:${option.mode}`,
    label: option.label,
    detail: option.detail,
    category: "Config",
    kind: "action" as const,
    right: option.query,
    shortcutQuery: option.query,
    action: () => {
      closeAll({ revertThemePreview: false });
      pluginRegistry.openWindowMode(focusedPaneId ?? undefined, option.mode);
    },
  }));
}

export function buildLayoutResultItems({
  closeAll,
  confirmDangerousActions,
  dispatch,
  duplicatePane,
  notifyGridlockRevert,
  openBuiltInWorkflow,
  openInlineConfirm,
  persistLayoutChange,
  pluginRegistry,
  pushRoute,
  query,
  state,
}: {
  closeAll: CloseAll;
  confirmDangerousActions?: boolean;
  dispatch: Dispatch<AppAction>;
  duplicatePane: (paneId: string) => void;
  notifyGridlockRevert: () => void;
  openBuiltInWorkflow: (actionId: string) => void;
  openInlineConfirm: OpenInlineConfirm;
  persistLayoutChange: (layout: LayoutConfig) => void;
  pluginRegistry: PluginRegistry;
  pushRoute: (route: CommandBarRoute) => void;
  query: string;
  state: AppState;
}): ResultItem[] {
  const currentLayout = state.config.layout;
  const focusedPane = state.focusedPaneId ? findPaneInstance(currentLayout, state.focusedPaneId) : null;
  const focusedPaneDef = focusedPane ? pluginRegistry.panes.get(focusedPane.paneId) : null;
  const dockedPaneIds = getDockedPaneIds(currentLayout);
  const layoutHistory = state.layoutHistory[state.config.activeLayoutIndex];
  const layoutItems: ResultItem[] = [];

  if (focusedPane && focusedPaneDef) {
    const focusedFloating = currentLayout.floating.find((entry) => entry.instanceId === focusedPane.instanceId);
    layoutItems.push({
      id: "layout-toggle-mode",
      label: focusedFloating ? "Dock Pane" : "Float Pane",
      detail: focusedFloating ? "Return the focused window to the layout" : "Detach the focused pane into a floating window",
      category: "Focused Pane",
      kind: "action",
      action: () => {
        const { width, height } = pluginRegistry.getTermSizeFn();
        const nextLayout = focusedFloating
          ? dockPane(currentLayout, focusedPane.instanceId)
          : floatPane(currentLayout, focusedPane.instanceId, width, height, focusedPaneDef);
        persistLayoutChange(nextLayout);
        closeAll({ revertThemePreview: false });
      },
    });

    layoutItems.push(...WINDOW_MODE_COMMAND_OPTIONS.map((option) => ({
      id: `layout-window-mode:${option.mode}`,
      label: option.label,
      detail: option.detail,
      category: "Focused Pane",
      kind: "action" as const,
      right: option.query,
      action: () => {
        closeAll({ revertThemePreview: false });
        pluginRegistry.openWindowMode(focusedPane.instanceId, option.mode);
      },
    })));

    layoutItems.push({
      id: "layout-swap",
      label: "Swap With…",
      detail: dockedPaneIds.length + currentLayout.floating.length > 1
        ? "Choose another pane to swap positions"
        : "Need at least two panes",
      category: "Focused Pane",
      kind: "action",
      disabled: dockedPaneIds.length + currentLayout.floating.length <= 1,
      action: () => {
        const pickerOptions = [
          ...dockedPaneIds,
          ...currentLayout.floating.map((entry) => entry.instanceId),
        ]
          .filter((paneId) => paneId !== focusedPane.instanceId)
          .map((paneId) => {
            const instance = findPaneInstance(currentLayout, paneId)!;
            const isFloating = currentLayout.floating.some((entry) => entry.instanceId === paneId);
            return {
              id: paneId,
              label: instance.title || pluginRegistry.panes.get(instance.paneId)?.name || instance.paneId,
              detail: isFloating ? "Floating window" : "Docked pane",
              description: isFloating ? "Floating window" : "Docked pane",
            };
          });
        if (pickerOptions.length === 0) return;
        pushRoute({
          kind: "picker",
          pickerId: "layout-swap",
          title: "Swap With…",
          query: "",
          selectedIdx: 0,
          hoveredIdx: null,
          options: pickerOptions,
          payload: { sourcePaneId: focusedPane.instanceId },
        });
      },
    });

    layoutItems.push({
      id: "layout-duplicate",
      label: "Duplicate Pane",
      detail: "Create another instance next to the focused pane",
      category: "Focused Pane",
      kind: "action",
      action: () => {
        duplicatePane(focusedPane.instanceId);
        closeAll({ revertThemePreview: false });
      },
    });

    layoutItems.push({
      id: "layout-close-pane",
      label: "Close Pane",
      detail: "Remove the focused pane from the layout",
      category: "Focused Pane",
      kind: "action",
      action: confirmDangerousActions
        ? () => {
          openInlineConfirm({
            confirmId: "layout-close-pane",
            title: "Close Pane",
            body: [`Close "${focusedPane.title || focusedPaneDef.name || focusedPane.instanceId}"?`],
            confirmLabel: "Close Pane",
            cancelLabel: "Back",
            tone: "danger",
            onConfirm: () => {
              persistLayoutChange(removePane(currentLayout, focusedPane.instanceId));
            },
          });
        }
        : () => {
          persistLayoutChange(removePane(currentLayout, focusedPane.instanceId));
          closeAll({ revertThemePreview: false });
        },
    });
  } else {
    layoutItems.push({
      id: "layout-no-focused-pane",
      label: "No focused pane",
      detail: "Focus a pane to show pane-specific layout actions",
      category: "Focused Pane",
      kind: "info",
      action: () => {},
    });
  }

  layoutItems.push({
    id: "layout-undo",
    label: "Undo Layout Change",
    detail: (layoutHistory?.past.length ?? 0) > 0 ? "Restore the previous layout state" : "No previous layout state",
    category: "Current Layout",
    kind: "action",
    disabled: (layoutHistory?.past.length ?? 0) === 0,
    action: () => {
      if ((layoutHistory?.past.length ?? 0) === 0) return;
      dispatch({ type: "UNDO_LAYOUT" });
      closeAll({ revertThemePreview: false });
    },
  });
  layoutItems.push({
    id: "layout-redo",
    label: "Redo Layout Change",
    detail: (layoutHistory?.future.length ?? 0) > 0 ? "Reapply the next layout state" : "No later layout state",
    category: "Current Layout",
    kind: "action",
    disabled: (layoutHistory?.future.length ?? 0) === 0,
    action: () => {
      if ((layoutHistory?.future.length ?? 0) === 0) return;
      dispatch({ type: "REDO_LAYOUT" });
      closeAll({ revertThemePreview: false });
    },
  });
  layoutItems.push({
    id: "layout-reset",
    label: "Reset Current Layout",
    detail: "Restore the default two-pane layout",
    category: "Current Layout",
    kind: "action",
    action: confirmDangerousActions
      ? () => {
        openInlineConfirm({
          confirmId: "layout-reset",
          title: "Reset Current Layout",
          body: ["Reset the current layout to the default two-pane arrangement?"],
          confirmLabel: "Reset Layout",
          cancelLabel: "Back",
          tone: "danger",
          onConfirm: () => {
            persistLayoutChange(cloneLayout(DEFAULT_LAYOUT));
          },
        });
      }
      : () => {
        persistLayoutChange(cloneLayout(DEFAULT_LAYOUT));
        closeAll({ revertThemePreview: false });
      },
  });
  layoutItems.push({
    id: "layout-gridlock",
    label: "Gridlock All Windows",
    detail: currentLayout.floating.length > 0
      ? "Infer a tiled layout from the current window positions"
      : "Retile all panes from their current arrangement",
    category: "Current Layout",
    kind: "action",
    action: () => {
      const { width, height } = pluginRegistry.getTermSizeFn();
      persistLayoutChange(gridlockAllPanes(currentLayout, { x: 0, y: 0, width, height }));
      notifyGridlockRevert();
      closeAll({ revertThemePreview: false });
    },
  });
  layoutItems.push({
    id: "layout-rename",
    label: "Rename Layout",
    detail: "Change the current saved layout name",
    category: "Current Layout",
    kind: "action",
    action: () => openBuiltInWorkflow("rename-layout"),
  });
  layoutItems.push({
    id: "layout-duplicate-layout",
    label: "Duplicate Layout",
    detail: "Create a copy of the current layout",
    category: "Current Layout",
    kind: "action",
    action: () => {
      dispatch({ type: "DUPLICATE_LAYOUT", index: state.config.activeLayoutIndex });
      closeAll({ revertThemePreview: false });
    },
  });
  layoutItems.push({
    id: "layout-new",
    label: "New Layout",
    detail: "Create a fresh saved layout",
    category: "Current Layout",
    kind: "action",
    action: () => openBuiltInWorkflow("new-layout"),
  });

  state.config.layouts.forEach((savedLayout, index) => {
    layoutItems.push({
      id: `layout-switch:${index}`,
      label: savedLayout.name,
      detail: index === state.config.activeLayoutIndex ? "Current layout" : "Switch to this saved layout",
      right: getLayoutPreview(savedLayout.layout),
      category: "Saved Layouts",
      kind: "action",
      current: index === state.config.activeLayoutIndex,
      action: () => {
        dispatch({ type: "SWITCH_LAYOUT", index });
        closeAll({ revertThemePreview: false });
      },
    });
  });

  return query
    ? fuzzyFilter(layoutItems, query, (item) => `${item.label} ${item.detail} ${item.right || ""}`)
    : layoutItems;
}
