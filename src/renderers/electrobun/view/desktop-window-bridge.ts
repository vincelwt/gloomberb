import type { PaneRuntimeState } from "../../../core/state/app-state";
import type {
  DesktopDockPreviewState,
  DesktopSharedStateSnapshot,
  DesktopWindowBridge,
} from "../../../types/desktop-window";
import { backendRequest, onDesktopDockPreview, onDesktopState } from "./backend-rpc";

export function createDesktopWindowBridge(kind: "main" | "detached", paneId?: string): DesktopWindowBridge {
  return {
    kind,
    paneId,
    syncMainState: kind === "main"
      ? async (snapshot: DesktopSharedStateSnapshot) => {
        await backendRequest("desktop.syncMainState", { snapshot });
      }
      : undefined,
    replaceDetachedPaneState: kind === "detached"
      ? async (targetPaneId: string, paneState: PaneRuntimeState) => {
        await backendRequest("desktop.replaceDetachedPaneState", { paneId: targetPaneId, paneState });
      }
      : undefined,
    popOutPane: async (targetPaneId: string) => {
      await backendRequest("desktop.popOutPane", { paneId: targetPaneId });
    },
    dockDetachedPane: async (targetPaneId: string) => {
      await backendRequest("desktop.dockDetachedPane", { paneId: targetPaneId });
    },
    closeDetachedPane: async (targetPaneId: string) => {
      await backendRequest("desktop.closeDetachedPane", { paneId: targetPaneId });
    },
    focusDetachedPane: async (targetPaneId: string) => {
      await backendRequest("desktop.focusDetachedPane", { paneId: targetPaneId });
    },
    subscribeState(listener: (snapshot: DesktopSharedStateSnapshot) => void) {
      return onDesktopState((message) => {
        listener(message.snapshot);
      });
    },
    subscribeDockPreview(listener: (preview: DesktopDockPreviewState) => void) {
      return onDesktopDockPreview((message) => {
        listener(message.preview);
      });
    },
  };
}
