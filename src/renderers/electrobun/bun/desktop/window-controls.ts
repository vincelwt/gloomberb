export type DesktopWindowControlAction = "minimize" | "toggle-maximize" | "close";

export interface ControllableDesktopWindow {
  close?: () => void;
  minimize?: () => void;
  maximize?: () => void;
  unmaximize?: () => void;
  isMaximized?: () => boolean;
}

export function applyDesktopWindowControl(
  window: ControllableDesktopWindow,
  action: DesktopWindowControlAction,
): void {
  if (action === "close") {
    window.close?.();
    return;
  }

  if (action === "minimize") {
    window.minimize?.();
    return;
  }

  if (window.isMaximized?.()) {
    window.unmaximize?.();
    return;
  }
  window.maximize?.();
}
