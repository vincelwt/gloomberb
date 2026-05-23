import type { Dispatch } from "react";
import type { PluginRegistry } from "../../../plugins/registry";
import type { AppAction, AppState } from "../../../state/app-context";
import type { LayoutConfig } from "../../../types/config";
import type { CommandBarRoute } from "../workflow/workflow-types";

export type CloseAll = (options?: { revertThemePreview?: boolean }) => void;

export type OpenInlineConfirm = (options: {
  confirmId: string;
  title: string;
  body: string[];
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  onConfirm: () => void | Promise<void>;
  successBehavior?: "close" | "back" | "stay";
}) => void;

export interface LayoutItemsContext {
  closeAll: CloseAll;
  confirmDangerousActions?: boolean;
  currentLayout: LayoutConfig;
  dispatch: Dispatch<AppAction>;
  duplicatePane: (paneId: string) => void;
  focusedPaneId: string | null;
  notifyGridlockRevert: () => void;
  openBuiltInWorkflow: (actionId: string) => void;
  openInlineConfirm: OpenInlineConfirm;
  persistLayoutChange: (layout: LayoutConfig) => void;
  pluginRegistry: PluginRegistry;
  pushRoute: (route: CommandBarRoute) => void;
  state: AppState;
}
