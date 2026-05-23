import type { AppSessionSnapshot } from "../../../core/state/session-persistence";
import type { DesktopDockPreviewState, DesktopSharedStateSnapshot, DesktopThemePreviewState } from "../../../types/desktop-window";
import type { DesktopApplicationMenuCommand } from "../../../types/desktop-menu";
import type { AppConfig } from "../../../types/config";
import type { UpdateProgress } from "../../../updater";
import type { CapabilityManifest } from "../../../capabilities";

export const ELECTROBUN_CONTEXT_MENU_ACTION = "gloom.context-menu.select";

export interface ElectrobunBackendInit {
  config: AppConfig;
  sessionSnapshot: AppSessionSnapshot | null;
  desktopSnapshot: DesktopSharedStateSnapshot | null;
  desktopThemePreview: DesktopThemePreviewState;
  pluginState: Record<string, Record<string, unknown>>;
  capabilityManifests: CapabilityManifest[];
  windowKind: "main" | "detached";
  paneId?: string;
}

interface BackendRequestPayload {
  method: string;
  payload?: unknown;
}

export interface ContextMenuSelectMessage {
  requestId: string;
  itemId: string;
}

export interface ApplicationMenuSelectMessage {
  command: DesktopApplicationMenuCommand;
}

export interface DesktopStateMessage {
  snapshot: DesktopSharedStateSnapshot;
}

export interface DesktopDockPreviewMessage {
  preview: DesktopDockPreviewState;
}

export interface DesktopThemePreviewMessage {
  preview: DesktopThemePreviewState;
}

export interface UpdateProgressMessage {
  progress: UpdateProgress;
}

export interface CapabilityEventMessage {
  subscriptionId: string;
  event: unknown;
}

export interface DesktopRestartMessage {
  reason?: string;
  source?: string;
}

export interface ElectrobunDesktopRpcSchema {
  bun: {
    requests: {
      "backend.request": {
        params: BackendRequestPayload;
        response: unknown;
      };
    };
    messages: {
      "host.restart": DesktopRestartMessage;
    };
  };
  webview: {
    requests: {};
    messages: {
      "context-menu.select": ContextMenuSelectMessage;
      "application-menu.select": ApplicationMenuSelectMessage;
      "desktop.state": DesktopStateMessage;
      "desktop.dockPreview": DesktopDockPreviewMessage;
      "desktop.themePreview": DesktopThemePreviewMessage;
      "update.progress": UpdateProgressMessage;
      "capability.event": CapabilityEventMessage;
    };
  };
}
