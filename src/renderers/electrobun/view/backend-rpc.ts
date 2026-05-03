/// <reference lib="dom" />
import { Electroview } from "electrobun/view";
import { measurePerfAsync } from "../../../utils/perf-marks";
import {
  type ApplicationMenuSelectMessage,
  type CapabilityEventMessage,
  type ContextMenuSelectMessage,
  type DesktopDockPreviewMessage,
  type DesktopStateMessage,
  type ElectrobunBackendInit,
  type ElectrobunDesktopRpcSchema,
  type UpdateProgressMessage,
} from "../shared/protocol";
import { decodeRpcValue, encodeRpcValue } from "./rpc-codec";

type ContextMenuSelectListener = (message: ContextMenuSelectMessage) => void;
type ApplicationMenuSelectListener = (message: ApplicationMenuSelectMessage) => void;
type DesktopStateListener = (message: DesktopStateMessage) => void;
type DesktopDockPreviewListener = (message: DesktopDockPreviewMessage) => void;
type UpdateProgressListener = (message: UpdateProgressMessage) => void;
type CapabilityEventListener = (message: CapabilityEventMessage) => void;

let initSnapshot: ElectrobunBackendInit | null = null;
const contextMenuSelectListeners = new Map<string, Set<ContextMenuSelectListener>>();
const applicationMenuSelectListeners = new Set<ApplicationMenuSelectListener>();
const desktopStateListeners = new Set<DesktopStateListener>();
const desktopDockPreviewListeners = new Set<DesktopDockPreviewListener>();
const updateProgressListeners = new Set<UpdateProgressListener>();
const capabilityEventListeners = new Map<string, Set<CapabilityEventListener>>();

function dispatch<T>(
  listeners: Map<string, Set<(value: T) => void>>,
  key: string,
  value: T,
): void {
  for (const listener of listeners.get(key) ?? []) {
    listener(value);
  }
}

function subscribe<T>(
  listeners: Map<string, Set<(value: T) => void>>,
  key: string,
  listener: (value: T) => void,
): () => void {
  if (!listeners.has(key)) {
    listeners.set(key, new Set());
  }
  listeners.get(key)!.add(listener);
  return () => {
    const bucket = listeners.get(key);
    if (!bucket) return;
    bucket.delete(listener);
    if (bucket.size === 0) {
      listeners.delete(key);
    }
  };
}

const rpc = Electroview.defineRPC<ElectrobunDesktopRpcSchema>({
  maxRequestTime: 120_000,
  handlers: {
    requests: {},
    messages: {
      "context-menu.select": (message) => {
        dispatch(contextMenuSelectListeners, message.requestId, message);
      },
      "application-menu.select": (message) => {
        const decoded = { command: decodeRpcValue<ApplicationMenuSelectMessage["command"]>(message.command) };
        for (const listener of applicationMenuSelectListeners) {
          listener(decoded);
        }
      },
      "desktop.state": (message) => {
        for (const listener of desktopStateListeners) {
          listener({ snapshot: decodeRpcValue(message.snapshot) });
        }
      },
      "desktop.dockPreview": (message) => {
        for (const listener of desktopDockPreviewListeners) {
          listener({ preview: decodeRpcValue(message.preview) });
        }
      },
      "update.progress": (message) => {
        const decoded = { progress: decodeRpcValue<UpdateProgressMessage["progress"]>(message.progress) };
        for (const listener of updateProgressListeners) {
          listener(decoded);
        }
      },
      "capability.event": (message) => {
        dispatch(capabilityEventListeners, message.subscriptionId, {
          subscriptionId: message.subscriptionId,
          event: decodeRpcValue(message.event),
        });
      },
    },
  },
});

const electroview = new Electroview({ rpc });

async function waitForBridgeReady(): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 5_000) {
    if (electroview.bunSocket?.readyState === WebSocket.OPEN) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Electrobun RPC socket did not open in time.");
}

export async function backendRequest<T = unknown>(method: string, payload: unknown = null): Promise<T> {
  const result = await measurePerfAsync("electrobun.rpc.request", async () => {
    await waitForBridgeReady();
    return rpc.request["backend.request"]({
      method,
      payload: encodeRpcValue(payload),
    });
  }, { method });
  return decodeRpcValue<T>(result);
}

export async function initElectrobunBackend(payload?: { kind?: "main" | "detached"; paneId?: string }): Promise<ElectrobunBackendInit> {
  initSnapshot = await backendRequest<ElectrobunBackendInit>("init", payload ?? null);
  return initSnapshot;
}

export function getElectrobunBackendInitSnapshot(): ElectrobunBackendInit | null {
  return initSnapshot;
}

export function onCapabilityEvent(
  subscriptionId: string,
  listener: (message: CapabilityEventMessage) => void,
): () => void {
  return subscribe(capabilityEventListeners, subscriptionId, listener);
}

export function onContextMenuSelect(
  requestId: string,
  listener: (message: ContextMenuSelectMessage) => void,
): () => void {
  return subscribe(contextMenuSelectListeners, requestId, listener);
}

export function onApplicationMenuSelect(listener: ApplicationMenuSelectListener): () => void {
  applicationMenuSelectListeners.add(listener);
  return () => {
    applicationMenuSelectListeners.delete(listener);
  };
}

export function onDesktopState(listener: DesktopStateListener): () => void {
  desktopStateListeners.add(listener);
  return () => {
    desktopStateListeners.delete(listener);
  };
}

export function onDesktopDockPreview(listener: DesktopDockPreviewListener): () => void {
  desktopDockPreviewListeners.add(listener);
  return () => {
    desktopDockPreviewListeners.delete(listener);
  };
}

export function onUpdateProgress(listener: UpdateProgressListener): () => void {
  updateProgressListeners.add(listener);
  return () => {
    updateProgressListeners.delete(listener);
  };
}
