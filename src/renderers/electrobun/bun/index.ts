import Electrobun, { ApplicationMenu, BrowserView, BrowserWindow, Utils } from "electrobun/bun";
import {
  APP_SESSION_ID,
  APP_SESSION_SCHEMA_VERSION,
  reconcileAppSessionSnapshot,
} from "../../../core/state/session-persistence";
import type { AppServices } from "../../../core/app-services";
import { saveConfig, setConfigStoreHost } from "../../../data/config/store";
import * as nodeConfigStoreHost from "../../../data/config/store/node";
import type { AppConfig } from "../../../types/config";
import type { AppSessionSnapshot } from "../../../core/state/session-persistence";
import { syncConfigActiveLayoutState, type PaneRuntimeState } from "../../../core/state/app/state";
import type { DesktopSharedStateSnapshot, DesktopThemePreviewState } from "../../../types/desktop-window";
import type { UpdateProgress } from "../../../updater";
import { ELECTROBUN_CONTEXT_MENU_ACTION, type DesktopRestartMessage, type ElectrobunDesktopRpcSchema } from "../shared/protocol";
import { decodeRpcValue, encodeRpcValue } from "../view/rpc-codec";
import { contextMenuSelectionMessage } from "./context-menu/click";
import type { DesktopWorkspace } from "./desktop/workspace";
import { buildDesktopApplicationMenu } from "./application-menu";
import { applicationMenuCommand } from "./application-menu/click";
import { registerElectrobunCoreCapabilities } from "./core-capabilities";
import { setNativeIbkrGatewayModuleLoader } from "../../../plugins/ibkr/gateway/service";
import {
  runElectrobunDesktopUpdate,
} from "./desktop/update";
import { DesktopCapabilityBridge } from "./desktop/capability-bridge";
import {
  MAIN_WINDOW_MIN_SIZE,
  defaultMainWindowFrame,
  normalizeWindowFrameWithMinimum,
} from "./window/frame";
import { MAIN_WINDOW_RPC_KEY } from "./window/focus";
import { handleHttpFetch } from "./desktop/http-fetch";
import { handleDesktopPluginStateRequest } from "./desktop/plugin-state";
import { scheduleDesktopRelaunch } from "./desktop/relaunch";
import {
  applyWindowMoveEvent,
  applyWindowResizeEvent,
  updateWindowFrameCache,
  type WindowMoveEvent,
  type WindowResizeEvent,
} from "./desktop/window-events";
import { createDesktopRpcRegistry } from "./desktop/rpc-registry";
import { DesktopStateBroadcaster } from "./desktop/state-broadcaster";
import { DesktopDetachedWindowManager } from "./desktop/detached-windows";
import { handleDesktopHostRequest } from "./desktop/host-requests";
import { handleDesktopWorkspaceRequest } from "./desktop/workspace/requests";
import { handleDesktopBackendRequest } from "./desktop/backend-requests";
import { initializeDesktopBackend } from "./desktop/initialization";
import { applyWindowsWindowIcon } from "./desktop/windows-icons";
import { applyDesktopWindowButtonOffset, desktopTitleBarStyle, desktopWindowButtonOffset, desktopWindowStyleMask } from "./desktop/window-style";
import { applyDesktopWindowControl, type DesktopWindowControlAction } from "./desktop/window-controls";

type DesktopRpc = ReturnType<typeof BrowserView.defineRPC<ElectrobunDesktopRpcSchema>>;

console.log = (...args) => console.error(...args);
console.info = (...args) => console.error(...args);
console.warn = (...args) => console.error(...args);

setConfigStoreHost(nodeConfigStoreHost);
setNativeIbkrGatewayModuleLoader(() => import("../../../plugins/ibkr/gateway/service/native"));

let currentConfig: AppConfig | null = null;
let services: AppServices | null = null;
let mainWindow: BrowserWindow | null = null;
let desktopWorkspace: DesktopWorkspace | null = null;
let desktopRestartInProgress = false;

const windowRpcRegistry = createDesktopRpcRegistry<DesktopRpc>();
const contextMenuRequestRpcs = new Map<string, DesktopRpc>();

function summarizeError(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function requireServices(): AppServices {
  if (!services) throw new Error("Backend services have not been initialized.");
  return services;
}

function requireConfig(): AppConfig {
  if (!currentConfig) throw new Error("Backend config has not been initialized.");
  return currentConfig;
}

function registerCoreCapabilities(): void {
  registerElectrobunCoreCapabilities({
    getConfig: requireConfig,
    getServices: requireServices,
  });
}

function requireDesktopWorkspace(): DesktopWorkspace {
  if (!desktopWorkspace) throw new Error("Desktop workspace has not been initialized.");
  return desktopWorkspace;
}

const {
  forEachReadyWindowRpc,
  getRpcWindowKey,
  getWindowRpc,
  isWindowRpcReady,
  markWindowRpcReady,
  registerWindowRpc,
  unregisterWindowRpc,
} = windowRpcRegistry;

const capabilityBridge = new DesktopCapabilityBridge<DesktopRpc>({
  getRegistry: () => requireServices().pluginRegistry.capabilities,
  getWindowKey: getRpcWindowKey,
});
const desktopStateBroadcaster = new DesktopStateBroadcaster<DesktopRpc>({
  forEachReadyWindowRpc,
});
const detachedWindowManager = new DesktopDetachedWindowManager<DesktopRpc>({
  createRpc: createWindowRpc,
  getConfig: requireConfig,
  getCurrentConfig: () => currentConfig,
  getDesktopWorkspace: requireDesktopWorkspace,
  getDesktopWorkspaceOrNull: () => desktopWorkspace,
  getMainWindow: () => mainWindow,
  commitDesktopSnapshot,
  disposeWindowScopedResources,
  unregisterWindowRpc,
  stateBroadcaster: desktopStateBroadcaster,
});

function openMainWindowDevTools(): void {
  mainWindow?.webview.openDevTools();
}

function syncActiveLayout(
  config: AppConfig,
  paneState: Record<string, PaneRuntimeState> = config.layouts[config.activeLayoutIndex]?.paneState ?? {},
  focusedPaneId: string | null = config.layouts[config.activeLayoutIndex]?.focusedPaneId ?? null,
  activePanel: "left" | "right" = config.layouts[config.activeLayoutIndex]?.activePanel ?? "left",
): AppConfig {
  return syncConfigActiveLayoutState(config, paneState, focusedPaneId, activePanel);
}

function setCurrentConfig(nextConfig: AppConfig): void {
  currentConfig = syncActiveLayout(nextConfig);
  syncConfigAccessors();
}

function sendUpdateProgress(rpc: DesktopRpc, progress: UpdateProgress): void {
  try {
    rpc.send["update.progress"]({
      progress: encodeRpcValue(progress) as UpdateProgress,
    });
  } catch (error) {
    console.warn("update progress send failed", summarizeError(error));
  }
}

async function runDesktopUpdate(rpc: DesktopRpc, currentVersion: string): Promise<void> {
  await runElectrobunDesktopUpdate(currentVersion, (progress) => sendUpdateProgress(rpc, progress));
}


function syncConfigAccessors() {
  if (!services || !currentConfig) return;
  services.pluginRegistry.getConfigFn = () => currentConfig!;
  services.pluginRegistry.getLayoutFn = () => currentConfig!.layout;
  services.pluginRegistry.updateBrokerInstanceFn = async (instanceId, values, options = {}) => {
    const config = requireConfig();
    let found = false;
    const brokerInstances = config.brokerInstances.map((instance) => {
      if (instance.id !== instanceId) return instance;
      found = true;
      const nextValues = options.replaceConfig ? values : { ...instance.config, ...values };
      return {
        ...instance,
        label: options.label ?? instance.label,
        enabled: options.enabled ?? instance.enabled,
        connectionMode: typeof nextValues.connectionMode === "string" ? nextValues.connectionMode : instance.connectionMode,
        config: nextValues,
      };
    });
    if (!found) return;

    const nextConfig = {
      ...config,
      brokerInstances,
    };
    if (desktopWorkspace) {
      await commitDesktopSnapshot(desktopWorkspace.replaceConfig(nextConfig, { layoutChanged: false }));
      return;
    }
    setCurrentConfig(nextConfig);
    await saveConfig(requireConfig());
  };
  const configurableProvider = services.providerRouter as {
    setConfigAccessor?: (accessor: () => AppConfig) => void;
  };
  configurableProvider.setConfigAccessor?.(() => currentConfig!);
}

function getSessionSnapshot(): AppSessionSnapshot | null {
  if (!currentConfig || !services) return null;
  const persisted = services.persistence.sessions.get<AppSessionSnapshot>(APP_SESSION_ID, APP_SESSION_SCHEMA_VERSION)?.value ?? null;
  return reconcileAppSessionSnapshot(currentConfig, persisted);
}

function getDesktopSnapshot(): DesktopSharedStateSnapshot | null {
  return desktopWorkspace?.getSnapshot() ?? null;
}

function sendDesktopState(snapshot: DesktopSharedStateSnapshot | null = getDesktopSnapshot()): void {
  desktopStateBroadcaster.sendDesktopState(snapshot);
}

function sendThemePreview(preview: DesktopThemePreviewState): void {
  desktopStateBroadcaster.sendThemePreview(preview);
}

function clearDockPreview(paneId?: string): void {
  desktopStateBroadcaster.clearDockPreview(paneId);
}

function disposeWindowScopedResources(windowKey: string): void {
  capabilityBridge.disposeWindow(windowKey);
}

function teardownServices(): void {
  capabilityBridge.disposeAll();
  services?.destroy();
  services = null;
}

function restartDesktopApp(message: DesktopRestartMessage = {}): void {
  if (desktopRestartInProgress) return;
  desktopRestartInProgress = true;
  console.error("[desktop-recovery] restart requested", {
    reason: message.reason,
    source: message.source,
    pid: process.pid,
    execPath: process.execPath,
    argv: process.argv,
  });
  try {
    scheduleDesktopRelaunch();
  } catch (error) {
    desktopRestartInProgress = false;
    console.error("[desktop-recovery] failed to schedule restart", summarizeError(error));
    throw error;
  }
  closeAllDetachedWindows();
  teardownServices();
  Utils.quit();
}

async function commitDesktopSnapshot(
  snapshot: DesktopSharedStateSnapshot,
  options: { persistConfig?: boolean; reconcileWindows?: boolean } = {},
): Promise<DesktopSharedStateSnapshot> {
  const nextConfig = syncActiveLayout(snapshot.config, snapshot.paneState, snapshot.focusedPaneId, snapshot.activePanel);
  setCurrentConfig(nextConfig);
  desktopWorkspace = requireDesktopWorkspace();
  desktopWorkspace.replaceConfig(nextConfig, { layoutChanged: snapshot.layoutChanged });
  if (options.persistConfig !== false) {
    await saveConfig(nextConfig);
  }
  if (options.reconcileWindows !== false) {
    reconcileDetachedWindows();
  }
  sendDesktopState(requireDesktopWorkspace().getSnapshot());
  return requireDesktopWorkspace().getSnapshot();
}

function reconcileDetachedWindows(): void {
  detachedWindowManager.reconcile();
}

function closeAllDetachedWindows(): void {
  detachedWindowManager.closeAll();
}

function controlWindowForRpcKey(windowKey: string | undefined, action: DesktopWindowControlAction): boolean {
  const targetWindow = windowKey === MAIN_WINDOW_RPC_KEY
    ? mainWindow
    : detachedWindowManager.getWindowForRpcKey(windowKey);
  if (!targetWindow) return false;
  if (action !== "close") {
    detachedWindowManager.suppressAutoDockForRpcKey(windowKey);
  }
  applyDesktopWindowControl(targetWindow, action);
  return true;
}

async function initialize(
  rpc: DesktopRpc,
  payload: Record<string, unknown>,
) {
  return initializeDesktopBackend({
    getCurrentConfig: () => currentConfig,
    getCurrentServices: () => services,
    getDesktopSnapshot,
    getDesktopWorkspace: () => desktopWorkspace,
    getRpcWindowKey,
    getSessionSnapshot,
    getThemePreview: () => desktopStateBroadcaster.currentThemePreview,
    markWindowRpcReady,
    payload,
    reconcileDetachedWindows,
    registerCoreCapabilities,
    rpc,
    setCurrentConfig,
    setDesktopWorkspace: (workspace) => {
      desktopWorkspace = workspace;
    },
    setServices: (nextServices) => {
      services = nextServices;
    },
    syncConfigAccessors,
  });
}

async function handleBackendRequest(
  rpc: DesktopRpc,
  method: string,
  rawPayload: unknown,
) {
  const payload = decodeRpcValue<Record<string, unknown>>(rawPayload ?? {});

  if (method === "init") return initialize(rpc, payload);
  if (method === "http.fetch") return handleHttpFetch(payload);
  if (method.startsWith("capability.")) return capabilityBridge.handle(rpc, method, payload);
  if (method.startsWith("desktop.")) {
    return handleDesktopWorkspaceRequest({
      workspace: requireDesktopWorkspace(),
      method,
      payload,
      setCurrentConfig,
      sendThemePreview,
      clearDockPreview,
      sendDesktopState,
      reconcileDetachedWindows,
      commitDesktopSnapshot,
      resolveDetachedFrame: (paneId) => detachedWindowManager.resolveFrame(paneId),
      focusDetachedPane: (paneId) => detachedWindowManager.focusDetachedPane(paneId),
    });
  }
  if (method.startsWith("pluginState.")) {
    return handleDesktopPluginStateRequest(requireServices().persistence.pluginState, method, payload);
  }
  if (method.startsWith("host.")) {
    return handleDesktopHostRequest({
      clearMainWindow: () => {
        mainWindow = null;
      },
      closeAllDetachedWindows,
      focusWindowForRpcKey: (windowKey) => detachedWindowManager.focusWindowForRpcKey(windowKey),
      getMainWindow: () => mainWindow,
      getRpcWindowKey,
      method,
      payload,
      restartDesktopApp,
      rpc,
      teardownServices,
      controlWindowForRpcKey,
      trackContextMenuRequest: (requestId, targetRpc) => {
        contextMenuRequestRpcs.clear();
        contextMenuRequestRpcs.set(requestId, targetRpc);
      },
    });
  }

  const backendResult = await handleDesktopBackendRequest({
    clearCurrentConfig: () => {
      currentConfig = null;
    },
    closeAllDetachedWindows,
    commitDesktopSnapshot,
    getConfig: requireConfig,
    getDesktopWorkspace: () => desktopWorkspace,
    getServices: requireServices,
    getSessionSnapshot,
    method,
    payload,
    reconcileDetachedWindows,
    registerCoreCapabilities,
    sendDesktopState,
    setCurrentConfig,
    setDesktopWorkspace: (workspace) => {
      desktopWorkspace = workspace;
    },
    setServices: (nextServices) => {
      services = nextServices;
    },
    startUpdate: (currentVersion) => {
      void runDesktopUpdate(rpc, currentVersion);
    },
    syncConfigAccessors,
    teardownServices,
  });
  if (backendResult.handled) return backendResult.value;
  throw new Error(`Unknown backend method: ${method}`);
}

function installApplicationMenu() {
  ApplicationMenu.setApplicationMenu(buildDesktopApplicationMenu());
}

function createWindowRpc(key: string): DesktopRpc {
  let rpc!: DesktopRpc;
  rpc = BrowserView.defineRPC<ElectrobunDesktopRpcSchema>({
    handlers: {
      requests: {
        "backend.request": async ({ method, payload }) => encodeRpcValue(await handleBackendRequest(rpc, method, payload)),
      },
      messages: {
        "host.restart": (message) => {
          restartDesktopApp(message);
        },
      },
    },
  });
  registerWindowRpc(key, rpc);
  return rpc;
}

Electrobun.events.on("context-menu-clicked", (event: unknown) => {
  const message = contextMenuSelectionMessage(event, ELECTROBUN_CONTEXT_MENU_ACTION);
  if (!message) return;
  const targetRpc = contextMenuRequestRpcs.get(message.requestId);
  contextMenuRequestRpcs.delete(message.requestId);
  if (targetRpc) {
    targetRpc.send["context-menu.select"](message);
    return;
  }
  forEachReadyWindowRpc((windowRpc) => {
    windowRpc.send["context-menu.select"](message);
  });
});

ApplicationMenu.on("application-menu-clicked", (event: unknown) => {
  const command = applicationMenuCommand(event);
  if (!command) return;
  if (command.type === "open-devtools") {
    openMainWindowDevTools();
    return;
  }
  if (!isWindowRpcReady(MAIN_WINDOW_RPC_KEY)) return;
  getWindowRpc(MAIN_WINDOW_RPC_KEY)?.send["application-menu.select"]({ command });
});

installApplicationMenu();

const mainRpc = createWindowRpc(MAIN_WINDOW_RPC_KEY);
const initialMainWindowFrame = normalizeWindowFrameWithMinimum(
  defaultMainWindowFrame(),
  defaultMainWindowFrame(),
  MAIN_WINDOW_MIN_SIZE,
);

mainWindow = new BrowserWindow({
  title: "Gloomberb",
  frame: initialMainWindowFrame,
  url: "views://mainview/index.html",
  renderer: "native",
  rpc: mainRpc,
  styleMask: desktopWindowStyleMask(),
  titleBarStyle: desktopTitleBarStyle(),
  trafficLightOffset: desktopWindowButtonOffset("main"),
  navigationRules: JSON.stringify(["views://*"]),
  sandbox: false,
});
applyDesktopWindowButtonOffset(mainWindow, "main");
applyWindowsWindowIcon("Gloomberb");
updateWindowFrameCache(mainWindow, initialMainWindowFrame, MAIN_WINDOW_MIN_SIZE);
detachedWindowManager.focusWindowForRpcKey(MAIN_WINDOW_RPC_KEY);
(mainWindow as any).on?.("move", (event: WindowMoveEvent) => {
  applyWindowMoveEvent(mainWindow, event);
});
(mainWindow as any).on?.("resize", (event: WindowResizeEvent) => {
  applyWindowResizeEvent(mainWindow, event, MAIN_WINDOW_MIN_SIZE);
});
