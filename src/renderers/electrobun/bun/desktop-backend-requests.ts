import { createAppServices, type AppServices } from "../../../core/app-services";
import type { AppSessionSnapshot } from "../../../core/state/session-persistence";
import {
  exportConfig,
  importConfig,
  resetAllData,
  saveConfig,
} from "../../../data/config-store";
import type { AppConfig } from "../../../types/config";
import type { DesktopSharedStateSnapshot } from "../../../types/desktop-window";
import type { ReleaseInfo } from "../../../updater";
import {
  checkElectrobunDesktopUpdate,
} from "./desktop-update";
import {
  createDesktopWorkspace,
  type DesktopWorkspace,
} from "./desktop-workspace";

const UNHANDLED_BACKEND_REQUEST = Symbol("unhandled backend request");

interface DesktopBackendRequestHandled {
  handled: true;
  value: unknown;
}

interface DesktopBackendRequestUnhandled {
  handled: false;
  value: typeof UNHANDLED_BACKEND_REQUEST;
}

export type DesktopBackendRequestResult =
  | DesktopBackendRequestHandled
  | DesktopBackendRequestUnhandled;

interface DesktopBackendRequestOptions {
  clearCurrentConfig: () => void;
  closeAllDetachedWindows: () => void;
  commitDesktopSnapshot: (snapshot: DesktopSharedStateSnapshot) => Promise<DesktopSharedStateSnapshot>;
  getConfig: () => AppConfig;
  getDesktopWorkspace: () => DesktopWorkspace | null;
  getServices: () => AppServices;
  getSessionSnapshot: () => AppSessionSnapshot | null;
  method: string;
  payload: Record<string, unknown>;
  reconcileDetachedWindows: () => void;
  registerCoreCapabilities: () => void;
  sendDesktopState: (snapshot: DesktopSharedStateSnapshot) => void;
  setCurrentConfig: (config: AppConfig) => void;
  setDesktopWorkspace: (workspace: DesktopWorkspace | null) => void;
  setServices: (services: AppServices) => void;
  startUpdate: (currentVersion: string) => void;
  syncConfigAccessors: () => void;
  teardownServices: () => void;
}

function handled(value: unknown): DesktopBackendRequestHandled {
  return { handled: true, value };
}

function unhandled(): DesktopBackendRequestUnhandled {
  return { handled: false, value: UNHANDLED_BACKEND_REQUEST };
}

async function importDesktopConfig({
  closeAllDetachedWindows,
  getConfig,
  getSessionSnapshot,
  payload,
  reconcileDetachedWindows,
  registerCoreCapabilities,
  sendDesktopState,
  setCurrentConfig,
  setDesktopWorkspace,
  setServices,
  syncConfigAccessors,
  teardownServices,
}: DesktopBackendRequestOptions): Promise<AppConfig> {
  closeAllDetachedWindows();
  setDesktopWorkspace(null);
  teardownServices();
  setCurrentConfig(await importConfig(payload.dataDir as string, payload.srcPath as string));
  setServices(createAppServices({ config: getConfig(), externalPlugins: [] }));
  syncConfigAccessors();
  registerCoreCapabilities();
  const desktopWorkspace = createDesktopWorkspace(getConfig(), getSessionSnapshot());
  setDesktopWorkspace(desktopWorkspace);
  reconcileDetachedWindows();
  sendDesktopState(desktopWorkspace.getSnapshot());
  return getConfig();
}

export async function handleDesktopBackendRequest(
  options: DesktopBackendRequestOptions,
): Promise<DesktopBackendRequestResult> {
  const {
    clearCurrentConfig,
    closeAllDetachedWindows,
    commitDesktopSnapshot,
    getConfig,
    getDesktopWorkspace,
    getServices,
    method,
    payload,
    setCurrentConfig,
    setDesktopWorkspace,
    startUpdate,
    teardownServices,
  } = options;

  switch (method) {
    case "update.check":
      return handled(checkElectrobunDesktopUpdate(
        typeof payload.currentVersion === "string" ? payload.currentVersion : "",
      ));
    case "update.start": {
      const release = payload.release && typeof payload.release === "object"
        ? payload.release as Partial<ReleaseInfo>
        : null;
      startUpdate(typeof payload.currentVersion === "string" ? payload.currentVersion : release?.version ?? "");
      return handled(null);
    }
    case "ticker.loadAll":
      return handled(getServices().tickerRepository.loadAllTickers());
    case "ticker.load":
      return handled(getServices().tickerRepository.loadTicker(payload.symbol as string));
    case "ticker.save":
      return handled(getServices().tickerRepository.saveTicker(payload.ticker as never));
    case "ticker.delete":
      return handled(getServices().tickerRepository.deleteTicker(payload.symbol as string));
    case "config.save": {
      setCurrentConfig(payload.config as AppConfig);
      const desktopWorkspace = getDesktopWorkspace();
      if (desktopWorkspace) {
        await commitDesktopSnapshot(desktopWorkspace.replaceConfig(getConfig(), { layoutChanged: true }));
        return handled(null);
      }
      return handled(saveConfig(getConfig()));
    }
    case "config.resetAllData":
      closeAllDetachedWindows();
      setDesktopWorkspace(null);
      teardownServices();
      clearCurrentConfig();
      return handled(resetAllData(payload.dataDir as string));
    case "config.export":
      return handled(exportConfig(payload.config as AppConfig, payload.destPath as string));
    case "config.import":
      return handled(await importDesktopConfig(options));
    case "session.set":
      getServices().persistence.sessions.set(
        payload.sessionId as string,
        payload.value,
        payload.schemaVersion as number | undefined,
      );
      return handled(null);
    case "session.delete":
      getServices().persistence.sessions.delete(payload.sessionId as string);
      return handled(null);
    default:
      return unhandled();
  }
}
