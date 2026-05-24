import { useEffect, useRef } from "react";
import { useShortcut } from "../../../../react/input";
import {
  createDoubleEscapeCloseState,
  recordDoubleEscapeClose,
  resetDoubleEscapeClose,
} from "../../../../utils/double-escape-close";
import {
  inputCaptureAllowsPaneManagementShortcut,
  resolvePaneManagementShortcut,
} from "../shortcuts";

interface ShellPaneManagementShortcutOptions {
  cancelActiveDrag(): void;
  closeFocusedPane(): boolean;
  copyFocusedPaneScreenshot(): boolean;
  focusedPaneId: string | null;
  gridlockVisiblePanes(): boolean;
  hasActiveDrag(): boolean;
  inputCaptured: boolean;
  openFocusedPaneSettings(): boolean;
  openLayoutMenu(): void;
  overlayOpen: boolean;
  popOutFocusedPane(): boolean;
  startWindowMode(): void;
  toggleFocusedPaneFloating(): boolean;
}

export function useShellPaneManagementShortcuts({
  cancelActiveDrag,
  closeFocusedPane,
  copyFocusedPaneScreenshot,
  focusedPaneId,
  gridlockVisiblePanes,
  hasActiveDrag,
  inputCaptured,
  openFocusedPaneSettings,
  openLayoutMenu,
  overlayOpen,
  popOutFocusedPane,
  startWindowMode,
  toggleFocusedPaneFloating,
}: ShellPaneManagementShortcutOptions): void {
  const doubleEscapeCloseRef = useRef(createDoubleEscapeCloseState());

  useEffect(() => {
    if (overlayOpen) {
      resetDoubleEscapeClose(doubleEscapeCloseRef.current);
    }
  }, [overlayOpen]);

  useShortcut((event) => {
    const isEscape = event.name === "escape" || event.name === "esc";
    if (isEscape) {
      const doubleEscapeState = doubleEscapeCloseRef.current;
      if (!hasActiveDrag() && !overlayOpen) {
        if (recordDoubleEscapeClose(doubleEscapeState, focusedPaneId, Date.now()) && closeFocusedPane()) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      } else {
        resetDoubleEscapeClose(doubleEscapeState);
      }

      if (!hasActiveDrag()) return;
      cancelActiveDrag();
      event.preventDefault();
      event.stopPropagation();
    } else {
      resetDoubleEscapeClose(doubleEscapeCloseRef.current);
    }
  }, { phase: "before" });

  useShortcut((event) => {
    const shortcut = resolvePaneManagementShortcut(event);
    if (!shortcut || hasActiveDrag() || overlayOpen) return;
    if (inputCaptured && !inputCaptureAllowsPaneManagementShortcut(shortcut, event)) return;

    let handled = false;
    switch (shortcut) {
      case "close":
        handled = closeFocusedPane();
        break;
      case "settings":
        handled = openFocusedPaneSettings();
        break;
      case "toggle-floating":
        handled = toggleFocusedPaneFloating();
        break;
      case "pop-out":
        handled = popOutFocusedPane();
        break;
      case "copy-screenshot":
        handled = copyFocusedPaneScreenshot();
        break;
      case "layout-actions":
        openLayoutMenu();
        handled = true;
        break;
      case "gridlock-all":
        handled = gridlockVisiblePanes();
        break;
      case "window-mode":
        startWindowMode();
        handled = true;
        break;
    }

    if (!handled) return;
    event.preventDefault();
    event.stopPropagation();
  });
}
