import {
  gridlockAllPanes,
} from "../../../plugins/pane-manager";
import {
  DEFAULT_LAYOUT,
  cloneLayout,
} from "../../../types/config";
import type { ResultItem } from "../list-model";
import type { LayoutItemsContext } from "./types";

export function buildCurrentLayoutItems({
  closeAll,
  confirmDangerousActions,
  currentLayout,
  dispatch,
  notifyGridlockRevert,
  openBuiltInWorkflow,
  openInlineConfirm,
  persistLayoutChange,
  pluginRegistry,
  state,
}: LayoutItemsContext): ResultItem[] {
  const layoutHistory = state.layoutHistory[state.config.activeLayoutIndex];

  return [
    {
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
    },
    {
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
    },
    {
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
    },
    {
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
    },
    {
      id: "layout-rename",
      label: "Rename Layout",
      detail: "Change the current saved layout name",
      category: "Current Layout",
      kind: "action",
      action: () => openBuiltInWorkflow("rename-layout"),
    },
    {
      id: "layout-duplicate-layout",
      label: "Duplicate Layout",
      detail: "Create a copy of the current layout",
      category: "Current Layout",
      kind: "action",
      action: () => {
        dispatch({ type: "DUPLICATE_LAYOUT", index: state.config.activeLayoutIndex });
        closeAll({ revertThemePreview: false });
      },
    },
    {
      id: "layout-new",
      label: "New Layout",
      detail: "Create a fresh saved layout",
      category: "Current Layout",
      kind: "action",
      action: () => openBuiltInWorkflow("new-layout"),
    },
  ];
}
