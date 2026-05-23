import type { PaneRuntimeState } from "../../../core/state/app-state";
import type {
  DesktopSharedStateSnapshot,
  DesktopThemePreviewState,
} from "../../../types/desktop-window";
import type { DesktopWorkspace } from "./desktop-workspace";
import type { WindowFrame } from "./window-frame";

type DockEdge = "left" | "right" | "top" | "bottom";

interface DesktopWorkspaceRequestOptions {
  workspace: DesktopWorkspace;
  method: string;
  payload: Record<string, unknown>;
  setCurrentConfig: (config: DesktopSharedStateSnapshot["config"]) => void;
  sendThemePreview: (preview: DesktopThemePreviewState) => void;
  clearDockPreview: (paneId?: string) => void;
  sendDesktopState: (snapshot: DesktopSharedStateSnapshot) => void;
  reconcileDetachedWindows: () => void;
  commitDesktopSnapshot: (
    snapshot: DesktopSharedStateSnapshot,
    options?: { persistConfig?: boolean; reconcileWindows?: boolean },
  ) => Promise<DesktopSharedStateSnapshot>;
  resolveDetachedFrame: (paneId: string) => WindowFrame;
  focusDetachedPane: (paneId: string) => void;
}

function requirePaneId(payload: Record<string, unknown>, method: string): string {
  if (typeof payload.paneId !== "string") {
    throw new Error(`${method} requires paneId.`);
  }
  return payload.paneId;
}

function normalizeDockEdge(edge: unknown): DockEdge | undefined {
  return edge === "left" || edge === "right" || edge === "top" || edge === "bottom"
    ? edge
    : undefined;
}

export async function handleDesktopWorkspaceRequest({
  workspace,
  method,
  payload,
  setCurrentConfig,
  sendThemePreview,
  clearDockPreview,
  sendDesktopState,
  reconcileDetachedWindows,
  commitDesktopSnapshot,
  resolveDetachedFrame,
  focusDetachedPane,
}: DesktopWorkspaceRequestOptions): Promise<null> {
  switch (method) {
    case "desktop.syncMainState": {
      const snapshot = workspace.syncMainState(payload.snapshot as DesktopSharedStateSnapshot);
      setCurrentConfig(snapshot.config);
      reconcileDetachedWindows();
      sendDesktopState(snapshot);
      return null;
    }
    case "desktop.setThemePreview":
      sendThemePreview((payload.preview ?? { theme: null }) as DesktopThemePreviewState);
      return null;
    case "desktop.replaceDetachedPaneState": {
      const paneId = requirePaneId(payload, method);
      sendDesktopState(workspace.replaceDetachedPaneState(paneId, payload.paneState as PaneRuntimeState));
      return null;
    }
    case "desktop.popOutPane": {
      const paneId = requirePaneId(payload, method);
      const snapshot = workspace.popOutPane(paneId, resolveDetachedFrame(paneId));
      await commitDesktopSnapshot(snapshot);
      focusDetachedPane(paneId);
      return null;
    }
    case "desktop.dockDetachedPane": {
      const paneId = requirePaneId(payload, method);
      clearDockPreview(paneId);
      await commitDesktopSnapshot(workspace.dockDetachedPane(paneId, normalizeDockEdge(payload.edge)));
      return null;
    }
    case "desktop.closeDetachedPane": {
      const paneId = requirePaneId(payload, method);
      clearDockPreview(paneId);
      await commitDesktopSnapshot(workspace.closeDetachedPane(paneId));
      return null;
    }
    case "desktop.focusDetachedPane": {
      const paneId = requirePaneId(payload, method);
      focusDetachedPane(paneId);
      return null;
    }
    default:
      throw new Error(`Unknown desktop method: ${method}`);
  }
}
