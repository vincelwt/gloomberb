import type { AppSessionSnapshot } from "../../../core/state/session-persistence";
import type { DesktopDockPreviewState, DesktopSharedStateSnapshot } from "../../../types/desktop-window";
import type { DesktopApplicationMenuCommand } from "../../../types/desktop-menu";
import type { AppConfig } from "../../../types/config";
import type { UpdateProgress } from "../../../updater";
import type { CapabilityManifest } from "../../../capabilities";

export const ELECTROBUN_CONTEXT_MENU_ACTION = "gloom.context-menu.select";

export interface ElectrobunBackendInit {
  config: AppConfig;
  sessionSnapshot: AppSessionSnapshot | null;
  desktopSnapshot: DesktopSharedStateSnapshot | null;
  pluginState: Record<string, Record<string, unknown>>;
  capabilityManifests: CapabilityManifest[];
  windowKind: "main" | "detached";
  paneId?: string;
}

export interface BackendRequestPayload {
  method: string;
  payload?: unknown;
}

export interface QuoteUpdateMessage {
  subscriptionId: string;
  target: unknown;
  quote: unknown;
}

export interface IbkrSnapshotMessage {
  subscriptionId: string;
  instanceId?: string;
  snapshot: unknown;
  resolvedConnection?: unknown;
}

export interface IbkrResolvedMessage {
  instanceId?: string;
  connection: unknown;
}

export interface AiChunkMessage {
  runId: string;
  output: string;
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

export interface UpdateProgressMessage {
  progress: UpdateProgress;
}

export interface CapabilityEventMessage {
  subscriptionId: string;
  event: unknown;
}

export interface ElectrobunDesktopRpcSchema {
  bun: {
    requests: {
      "backend.request": {
        params: BackendRequestPayload;
        response: unknown;
      };
    };
    messages: {};
  };
  webview: {
    requests: {};
    messages: {
      "ibkr.snapshot": IbkrSnapshotMessage;
      "ibkr.resolved": IbkrResolvedMessage;
      "ibkr.quote.update": QuoteUpdateMessage;
      "ai.chunk": AiChunkMessage;
      "context-menu.select": ContextMenuSelectMessage;
      "application-menu.select": ApplicationMenuSelectMessage;
      "desktop.state": DesktopStateMessage;
      "desktop.dockPreview": DesktopDockPreviewMessage;
      "update.progress": UpdateProgressMessage;
      "capability.event": CapabilityEventMessage;
    };
  };
}
