import type {
  ApplicationMenuSelectMessage,
  CapabilityEventMessage,
  ContextMenuSelectMessage,
  DesktopDockPreviewMessage,
  DesktopRestartMessage,
  DesktopStateMessage,
  DesktopThemePreviewMessage,
  ElectrobunBackendInit,
  UpdateProgressMessage,
} from "../../shared/protocol";

type Listener<T> = (message: T) => void;

function unsubscribe(): () => void {
  return () => {};
}

export async function backendRequest<T = unknown>(): Promise<T> {
  throw new Error("Electrobun backend requests are unavailable in the CLI screenshot renderer.");
}

export async function initElectrobunBackend(): Promise<ElectrobunBackendInit> {
  throw new Error("Electrobun backend initialization is unavailable in the CLI screenshot renderer.");
}

export function requestElectrobunRestart(_message: DesktopRestartMessage = {}): void {}

export function getElectrobunBackendInitSnapshot(): ElectrobunBackendInit | null {
  return null;
}

export function onCapabilityEvent(_subscriptionId: string, _listener: Listener<CapabilityEventMessage>): () => void {
  return unsubscribe();
}

export function onContextMenuSelect(_requestId: string, _listener: Listener<ContextMenuSelectMessage>): () => void {
  return unsubscribe();
}

export function onApplicationMenuSelect(_listener: Listener<ApplicationMenuSelectMessage>): () => void {
  return unsubscribe();
}

export function onDesktopState(_listener: Listener<DesktopStateMessage>): () => void {
  return unsubscribe();
}

export function onDesktopDockPreview(_listener: Listener<DesktopDockPreviewMessage>): () => void {
  return unsubscribe();
}

export function onDesktopThemePreview(_listener: Listener<DesktopThemePreviewMessage>): () => void {
  return unsubscribe();
}

export function onUpdateProgress(_listener: Listener<UpdateProgressMessage>): () => void {
  return unsubscribe();
}
