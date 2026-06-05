import type { KeyEventLike } from "../../../react/input";

export const PANE_MANAGEMENT_ACCELERATORS = {
  settings: "CmdOrCtrl+,",
  toggleFloating: "CmdOrCtrl+Shift+D",
  popOut: "CmdOrCtrl+Shift+O",
  copyScreenshot: "CmdOrCtrl+Shift+C",
  close: "CmdOrCtrl+W",
  closeAllFloating: "CmdOrCtrl+Alt+W",
  layoutActions: "CmdOrCtrl+Shift+L",
  gridlockAll: "CmdOrCtrl+Shift+G",
  windowMode: "CmdOrCtrl+Shift+M",
  windowResizeMode: "CmdOrCtrl+Shift+R",
} as const;

export type PaneManagementShortcut =
  | "settings"
  | "toggle-floating"
  | "pop-out"
  | "copy-screenshot"
  | "close"
  | "close-all-floating"
  | "layout-actions"
  | "gridlock-all"
  | "window-mode"
  | "window-resize-mode";

export function resolvePaneManagementShortcut(
  event: Pick<KeyEventLike, "name" | "key" | "ctrl" | "meta" | "super" | "shift" | "alt">,
): PaneManagementShortcut | null {
  if (!event.ctrl && !event.meta && !event.super) return null;
  const rawName = event.name ?? event.key ?? "";
  const name = rawName.toLowerCase();
  const shifted = event.shift || rawName !== name;
  if (!shifted && event.alt && name === "w") return "close-all-floating";
  if (!shifted && name === "w") return "close";
  if (!shifted && name === ",") return "settings";
  if (!shifted || event.alt) return null;
  if (name === "c") return "copy-screenshot";
  if (name === "d") return "toggle-floating";
  if (name === "o") return "pop-out";
  if (name === "l") return "layout-actions";
  if (name === "g") return "gridlock-all";
  if (name === "m") return "window-mode";
  if (name === "r") return "window-resize-mode";
  return null;
}

export function inputCaptureAllowsPaneManagementShortcut(
  shortcut: PaneManagementShortcut,
  event: Pick<KeyEventLike, "meta" | "super" | "targetEditable">,
): boolean {
  if (shortcut !== "close" && shortcut !== "close-all-floating") return false;
  return event.meta || event.super || event.targetEditable !== true;
}
