import type { AppSessionSnapshot } from "../../../core/state/session-persistence";
import type { DesktopDockPreviewState, DesktopSharedStateSnapshot } from "../../../types/desktop-window";
import type { AppConfig } from "../../../types/config";

export interface ElectrobunBackendInit {
  config: AppConfig;
  sessionSnapshot: AppSessionSnapshot | null;
  desktopSnapshot: DesktopSharedStateSnapshot | null;
  pluginState: Record<string, Record<string, unknown>>;
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

export interface DesktopStateMessage {
  snapshot: DesktopSharedStateSnapshot;
}

export interface DesktopDockPreviewMessage {
  preview: DesktopDockPreviewState;
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
      "quote.update": QuoteUpdateMessage;
      "ibkr.snapshot": IbkrSnapshotMessage;
      "ibkr.resolved": IbkrResolvedMessage;
      "ibkr.quote.update": QuoteUpdateMessage;
      "ai.chunk": AiChunkMessage;
      "desktop.state": DesktopStateMessage;
      "desktop.dockPreview": DesktopDockPreviewMessage;
    };
  };
}
