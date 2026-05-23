import type { KeyEventLike } from "../../react/input";

export const PANE_MANAGEMENT_ACCELERATORS = {
  settings: "CmdOrCtrl+,",
  toggleFloating: "CmdOrCtrl+Shift+D",
  popOut: "CmdOrCtrl+Shift+O",
  copyScreenshot: "CmdOrCtrl+Shift+C",
  close: "CmdOrCtrl+W",
  layoutActions: "CmdOrCtrl+Shift+L",
  gridlockAll: "CmdOrCtrl+Shift+G",
  windowMode: "CmdOrCtrl+Shift+M",
} as const;

export type PaneManagementShortcut =
  | "settings"
  | "toggle-floating"
  | "pop-out"
  | "copy-screenshot"
  | "close"
  | "layout-actions"
  | "gridlock-all"
  | "window-mode";

export function resolvePaneManagementShortcut(
  event: Pick<KeyEventLike, "name" | "key" | "ctrl" | "meta" | "super" | "shift" | "alt">,
): PaneManagementShortcut | null {
  if (!event.ctrl && !event.meta && !event.super) return null;
  const name = (event.name ?? event.key ?? "").toLowerCase();
  if (name === "w") return "close";
  if (!event.shift && name === ",") return "settings";
  if (!event.shift || event.alt) return null;
  if (name === "c") return "copy-screenshot";
  if (name === "d") return "toggle-floating";
  if (name === "o") return "pop-out";
  if (name === "l") return "layout-actions";
  if (name === "g") return "gridlock-all";
  if (name === "m") return "window-mode";
  return null;
}

export function inputCaptureAllowsPaneManagementShortcut(
  shortcut: PaneManagementShortcut,
  event: Pick<KeyEventLike, "meta" | "super" | "targetEditable">,
): boolean {
  if (shortcut !== "close") return false;
  return event.meta || event.super || event.targetEditable !== true;
}
