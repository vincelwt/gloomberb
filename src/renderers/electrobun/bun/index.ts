import { existsSync, mkdirSync } from "fs";
import { mkdir, readFile, rm, unlink, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { Buffer } from "node:buffer";
import Electrobun, { ApplicationMenu, BrowserView, BrowserWindow, Utils, ContextMenu, type UpdateStatusEntry } from "electrobun/bun";
import { getAiProviderDefinitions } from "../../../plugins/builtin/ai/providers";
import { runAiPrompt, type AiRunController } from "../../../plugins/builtin/ai/runner";
import {
  APP_SESSION_ID,
  APP_SESSION_SCHEMA_VERSION,
  reconcileAppSessionSnapshot,
} from "../../../core/state/session-persistence";
import { createAppServices, type AppServices } from "../../../core/app-services";
import { getDataDir, initDataDir, saveConfig, resetAllData, exportConfig, importConfig, setConfigStoreHost } from "../../../data/config-store";
import * as nodeConfigStoreHost from "../../../data/config-store-node";
import {
  ibkrGatewayManager,
  setResolvedIbkrGatewayListener,
  type IbkrGatewayConfig,
} from "../../../plugins/ibkr/gateway-service";
import { type BrokerContractRef } from "../../../types/instrument";
import { cloneLayout, findPaneInstance, type AppConfig } from "../../../types/config";
import type { AppSessionSnapshot } from "../../../core/state/session-persistence";
import type { PaneRuntimeState } from "../../../core/state/app-state";
import type { QuoteSubscriptionTarget } from "../../../types/data-provider";
import type { DesktopDockPreviewState, DesktopSharedStateSnapshot } from "../../../types/desktop-window";
import type { BrokerOrderRequest } from "../../../types/trading";
import type { ReleaseInfo, UpdateCheckResult, UpdateProgress } from "../../../updater";
import { buildSoundCommand } from "../../../notifications/app-notifier";
import { isPaneDetached } from "../../../plugins/pane-manager";
import { ELECTROBUN_CONTEXT_MENU_ACTION, type ElectrobunDesktopRpcSchema } from "../shared/protocol";
import { decodeRpcValue, encodeRpcValue } from "../view/rpc-codec";
import { startMainThreadMonitor } from "../../../utils/main-thread-monitor";
import { contextMenuSelectionMessage } from "./context-menu-click";
import { getContextMenuRequestId, normalizeContextMenuItems } from "./context-menu-normalize";
import { createDesktopWorkspace, type DesktopWorkspace } from "./desktop-workspace";
import { buildApplicationMenu } from "./application-menu";
import { applicationMenuCommand } from "./application-menu-click";
import { apiClient, type PersistedAuthUser } from "../../../utils/api-client";
import {
  DEFAULT_WINDOW_FRAME,
  DETACHED_WINDOW_MIN_SIZE,
  MAIN_WINDOW_MIN_SIZE,
  normalizeWindowFrame,
  normalizeWindowFrameWithMinimum,
  type WindowFrame,
  type WindowMinimumSize,
} from "./window-frame";

const NOTES_INDEX_FILE = "__quick-notes-index__.json";
const MAIN_WINDOW_RPC_KEY = "main";

type DesktopRpc = ReturnType<typeof BrowserView.defineRPC<ElectrobunDesktopRpcSchema>>;
type WindowMoveEvent = { data?: { x?: number; y?: number } };
type WindowResizeEvent = { data?: Partial<WindowFrame> };
type PersistedCloudSession = {
  sessionToken?: string | null;
  user?: PersistedAuthUser | null;
};

console.log = (...args) => console.error(...args);
console.info = (...args) => console.error(...args);
console.warn = (...args) => console.error(...args);

startMainThreadMonitor("electrobun.bun", { mirrorToConsole: true });
setConfigStoreHost(nodeConfigStoreHost);

let currentConfig: AppConfig | null = null;
let services: AppServices | null = null;
let mainWindow: BrowserWindow | null = null;
let desktopWorkspace: DesktopWorkspace | null = null;
let currentDockPreview: DesktopDockPreviewState = { paneId: null, edge: null };
let desktopUpdateInProgress = false;

const detachedWindows = new Map<string, BrowserWindow>();
const detachedFrameTimers = new Map<string, ReturnType<typeof setTimeout>>();
const detachedDockTimers = new Map<string, ReturnType<typeof setTimeout>>();
const detachedClosingPanes = new Set<string>();
const pendingDetachedMoveFlush = new Set<string>();
const windowRpcs = new Map<string, DesktopRpc>();
const readyWindowRpcs = new Set<string>();
const rpcWindowKeys = new Map<DesktopRpc, string>();
const contextMenuRequestRpcs = new Map<string, DesktopRpc>();

const dataQuoteSubscriptions = new Map<string, () => void>();
const ibkrSnapshotSubscriptions = new Map<string, () => void>();
const ibkrQuoteSubscriptions = new Map<string, () => void>();
const aiRuns = new Map<string, AiRunController>();

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

function requireDesktopWorkspace(): DesktopWorkspace {
  if (!desktopWorkspace) throw new Error("Desktop workspace has not been initialized.");
  return desktopWorkspace;
}

function detachedRpcKey(instanceId: string): string {
  return `detached:${instanceId}`;
}

function registerWindowRpc(key: string, rpc: DesktopRpc): void {
  windowRpcs.set(key, rpc);
  rpcWindowKeys.set(rpc, key);
}

function unregisterWindowRpc(key: string): void {
  const rpc = windowRpcs.get(key);
  if (rpc) {
    rpcWindowKeys.delete(rpc);
  }
  windowRpcs.delete(key);
  readyWindowRpcs.delete(key);
}

function getRpcWindowKey(rpc: DesktopRpc): string | undefined {
  return rpcWindowKeys.get(rpc);
}

function markWindowRpcReady(rpc: DesktopRpc): void {
  const key = getRpcWindowKey(rpc);
  if (key) readyWindowRpcs.add(key);
}

function forEachReadyWindowRpc(callback: (rpc: DesktopRpc) => void): void {
  for (const key of readyWindowRpcs) {
    const rpc = windowRpcs.get(key);
    if (rpc) callback(rpc);
  }
}

function scopeClientId(rpc: DesktopRpc, id: string): string {
  return `${getRpcWindowKey(rpc) ?? "window"}:${id}`;
}

function syncActiveLayout(config: AppConfig): AppConfig {
  return {
    ...config,
    layouts: config.layouts.map((entry, index) => (
      index === config.activeLayoutIndex ? { ...entry, layout: cloneLayout(config.layout) } : entry
    )),
  };
}

function normalizeInitWindowTarget(
  rpc: DesktopRpc,
  payload: Record<string, unknown>,
): { kind: "main" | "detached"; paneId?: string } {
  const rpcKey = getRpcWindowKey(rpc);
  if (rpcKey === MAIN_WINDOW_RPC_KEY) {
    return { kind: "main" };
  }
  if (rpcKey?.startsWith("detached:")) {
    return {
      kind: "detached",
      paneId: rpcKey.slice("detached:".length) || undefined,
    };
  }
  const kind = payload.kind === "detached" ? "detached" : "main";
  return {
    kind,
    paneId: kind === "detached" && typeof payload.paneId === "string" && payload.paneId.length > 0
      ? payload.paneId
      : undefined,
  };
}

function clearTimer(
  timers: Map<string, ReturnType<typeof setTimeout>>,
  key: string,
): void {
  const timer = timers.get(key);
  if (timer) {
    clearTimeout(timer);
    timers.delete(key);
  }
}

function getWindowFrame(window: BrowserWindow | null): WindowFrame | null {
  if (!window) return null;
  return normalizeWindowFrame(window.frame);
}

function updateWindowFrameCache(
  window: BrowserWindow | null,
  patch: Partial<WindowFrame>,
  minimumSize?: WindowMinimumSize,
): WindowFrame | null {
  if (!window) return null;
  const nextFrame = normalizeWindowFrameWithMinimum(patch, getWindowFrame(window) ?? DEFAULT_WINDOW_FRAME, minimumSize);
  window.frame = nextFrame;
  return nextFrame;
}

function applyWindowMoveEvent(window: BrowserWindow | null, event: WindowMoveEvent): WindowFrame | null {
  return updateWindowFrameCache(window, {
    x: event.data?.x,
    y: event.data?.y,
  });
}

function applyWindowResizeEvent(
  window: BrowserWindow | null,
  event: WindowResizeEvent,
  minimumSize?: WindowMinimumSize,
): WindowFrame | null {
  if (!window) return null;
  const previousFrame = getWindowFrame(window) ?? DEFAULT_WINDOW_FRAME;
  const rawFrame = normalizeWindowFrame(event.data ?? {}, previousFrame);
  const nextFrame = updateWindowFrameCache(window, rawFrame, minimumSize);
  if (nextFrame && (nextFrame.width !== rawFrame.width || nextFrame.height !== rawFrame.height)) {
    window.setFrame(nextFrame.x, nextFrame.y, nextFrame.width, nextFrame.height);
  }
  return nextFrame;
}

function setCurrentConfig(nextConfig: AppConfig): void {
  currentConfig = syncActiveLayout(nextConfig);
  syncConfigAccessors();
}

function normalizeHttpFetchHeaders(headers: unknown): Record<string, string> {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(headers as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function playNotificationSound(sound: string | undefined): void {
  if (!sound) return;
  const command = buildSoundCommand(sound);
  if (!command) return;
  try {
    const child = Bun.spawn([command.command, ...command.args], { stdio: ["ignore", "ignore", "ignore"] });
    child.unref();
  } catch (error) {
    console.warn("notification sound failed", {
      command: command.command,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function desktopReleasePlatformPrefix(channel: string): string {
  const os = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "win" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `${channel}-${os}-${arch}`;
}

async function desktopReleaseInfo(updateInfo: {
  version?: string;
  hash?: string;
}, currentVersion: string): Promise<ReleaseInfo> {
  const [channel, baseUrl] = await Promise.all([
    Electrobun.Updater.localInfo.channel(),
    Electrobun.Updater.localInfo.baseUrl(),
  ]);
  const version = updateInfo.version || currentVersion;
  return {
    version,
    tagName: `v${version}`,
    downloadUrl: `${baseUrl.replace(/\/+$/, "")}/${desktopReleasePlatformPrefix(channel)}-update.json`,
    publishedAt: "",
    updateAction: { kind: "desktop" },
  };
}

function mapDesktopUpdateStatus(entry: UpdateStatusEntry): UpdateProgress | null {
  const progress = entry.details?.progress;
  switch (entry.status) {
    case "downloading":
    case "download-starting":
    case "checking-local-tar":
    case "local-tar-found":
    case "local-tar-missing":
    case "fetching-patch":
    case "patch-found":
    case "patch-not-found":
    case "downloading-patch":
    case "downloading-full-bundle":
    case "download-progress":
      return {
        phase: "downloading",
        percent: typeof progress === "number" ? progress : undefined,
      };
    case "applying-patch":
    case "patch-applied":
    case "extracting-version":
    case "patch-chain-complete":
    case "decompressing":
    case "download-complete":
    case "applying":
    case "extracting":
    case "replacing-app":
    case "launching-new-version":
      return { phase: "replacing" };
    case "complete":
      return { phase: "done", message: "Update installed, restarting..." };
    case "error":
      return {
        phase: "error",
        error: entry.details?.errorMessage || entry.message,
      };
    default:
      return null;
  }
}

function sendUpdateProgress(rpc: DesktopRpc, progress: UpdateProgress): void {
  try {
    rpc.send["update.progress"]({
      progress: encodeRpcValue(progress),
    });
  } catch (error) {
    console.warn("update progress send failed", summarizeError(error));
  }
}

async function checkDesktopUpdate(currentVersion: string): Promise<UpdateCheckResult> {
  try {
    const [channel, baseUrl] = await Promise.all([
      Electrobun.Updater.localInfo.channel(),
      Electrobun.Updater.localInfo.baseUrl(),
    ]);
    if (channel === "dev" || !baseUrl) {
      return { kind: "disabled" };
    }

    const info = await Electrobun.Updater.checkForUpdate();
    if (info.error) {
      return { kind: "error", error: info.error };
    }
    if (!info.updateAvailable) {
      return { kind: "current" };
    }

    return {
      kind: "available",
      release: await desktopReleaseInfo(info, currentVersion),
    };
  } catch (error) {
    return {
      kind: "error",
      error: error instanceof Error ? error.message : "Desktop update check failed",
    };
  }
}

async function runDesktopUpdate(rpc: DesktopRpc, currentVersion: string): Promise<void> {
  if (desktopUpdateInProgress) {
    sendUpdateProgress(rpc, {
      phase: "error",
      error: "A desktop update is already in progress.",
    });
    return;
  }

  desktopUpdateInProgress = true;
  Electrobun.Updater.clearStatusHistory();
  Electrobun.Updater.onStatusChange((entry) => {
    const progress = mapDesktopUpdateStatus(entry);
    if (progress) sendUpdateProgress(rpc, progress);
  });

  try {
    sendUpdateProgress(rpc, { phase: "downloading", percent: 0 });
    const result = await checkDesktopUpdate(currentVersion);
    if (result.kind === "error") {
      sendUpdateProgress(rpc, { phase: "error", error: result.error });
      return;
    }
    if (result.kind !== "available") {
      sendUpdateProgress(rpc, {
        phase: "done",
        message: result.kind === "disabled" ? "Desktop updates are unavailable in this build" : "Already on the latest version",
      });
      return;
    }

    await Electrobun.Updater.downloadUpdate();
    const updateInfo = Electrobun.Updater.updateInfo();
    if (updateInfo?.error) {
      sendUpdateProgress(rpc, { phase: "error", error: updateInfo.error });
      return;
    }
    if (!updateInfo?.updateReady) {
      sendUpdateProgress(rpc, { phase: "error", error: "Desktop update did not finish downloading." });
      return;
    }

    sendUpdateProgress(rpc, { phase: "replacing" });
    await Electrobun.Updater.applyUpdate();
  } catch (error) {
    sendUpdateProgress(rpc, {
      phase: "error",
      error: error instanceof Error ? error.message : "Desktop update failed",
    });
  } finally {
    desktopUpdateInProgress = false;
    Electrobun.Updater.onStatusChange(null);
  }
}

function syncBackendCloudAuthState(pluginId: string, key: string, value: unknown): void {
  if (pluginId !== "gloomberb-cloud" || (key !== "session" && key !== "resume:session")) return;

  const session = value && typeof value === "object" ? value as PersistedCloudSession : null;
  const token = typeof session?.sessionToken === "string" && session.sessionToken.length > 0
    ? session.sessionToken
    : null;

  apiClient.setSessionToken(token);
  apiClient.setWebSocketToken(null);
  apiClient.restoreCachedUser(token ? session?.user ?? null : null);
}

function notePath(dataDir: string, symbol: string): string {
  return join(dataDir, `${symbol}.md`);
}

function notesIndexPath(dataDir: string): string {
  return join(dataDir, NOTES_INDEX_FILE);
}

async function readTextOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}

async function writeTextEnsuringParent(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf-8");
}

async function deleteFileIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // ignore missing files
  }
}

async function handleHttpFetch(payload: Record<string, unknown>) {
  if (typeof payload.url !== "string") {
    throw new Error("http.fetch requires a URL.");
  }

  const url = new URL(payload.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported http.fetch protocol: ${url.protocol}`);
  }

  const init =
    payload.init && typeof payload.init === "object" && !Array.isArray(payload.init)
      ? payload.init as Record<string, unknown>
      : {};
  const method =
    typeof init.method === "string" && init.method.trim().length > 0
      ? init.method.trim().toUpperCase()
      : "GET";
  const body =
    typeof init.body === "string" && method !== "GET" && method !== "HEAD"
      ? init.body
      : undefined;

  const response = await fetch(url, {
    method,
    headers: normalizeHttpFetchHeaders(init.headers),
    body,
  });
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  const setCookieHeaders = [...(response.headers.getSetCookie?.() ?? [])];
  const fallbackSetCookie = response.headers.get("set-cookie");
  if (fallbackSetCookie && setCookieHeaders.length === 0) {
    setCookieHeaders.push(fallbackSetCookie);
  }

  return {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    setCookie: setCookieHeaders,
    body: await response.text(),
  };
}

function syncConfigAccessors() {
  if (!services || !currentConfig) return;
  services.pluginRegistry.getConfigFn = () => currentConfig!;
  services.pluginRegistry.getLayoutFn = () => currentConfig!.layout;
  const configurableProvider = services.providerRouter as {
    setConfigAccessor?: (accessor: () => AppConfig) => void;
  };
  configurableProvider.setConfigAccessor?.(() => currentConfig!);
}

function loadPluginState() {
  const registry = requireServices().pluginRegistry;
  const state: Record<string, Record<string, unknown>> = {};
  for (const pluginId of registry.allPlugins.keys()) {
    const keys = registry.persistence.pluginState.keys(pluginId);
    if (keys.length === 0) continue;
    state[pluginId] = {};
    for (const key of keys) {
      const record = registry.persistence.pluginState.get(pluginId, key);
      if (record) state[pluginId]![key] = record.value;
    }
  }
  return state;
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
  if (!snapshot) return;
  const encodedSnapshot = encodeRpcValue(snapshot);
  forEachReadyWindowRpc((rpc) => {
    rpc.send["desktop.state"]({
      snapshot: encodedSnapshot,
    });
  });
}

function sendDockPreview(preview: DesktopDockPreviewState): void {
  if (currentDockPreview.paneId === preview.paneId && currentDockPreview.edge === preview.edge) {
    return;
  }
  currentDockPreview = preview;
  const encodedPreview = encodeRpcValue(preview);
  forEachReadyWindowRpc((rpc) => {
    rpc.send["desktop.dockPreview"]({
      preview: encodedPreview,
    });
  });
}

function clearDockPreview(paneId?: string): void {
  if (paneId && currentDockPreview.paneId && currentDockPreview.paneId !== paneId) return;
  sendDockPreview({ paneId: null, edge: null });
}

function disposeSubscriptionMap(map: Map<string, () => void>): void {
  for (const unsubscribe of map.values()) {
    try {
      unsubscribe();
    } catch {
      // ignore teardown failures
    }
  }
  map.clear();
}

function disposeScopedSubscriptionMap(map: Map<string, () => void>, windowKey: string): void {
  const scopedPrefix = `${windowKey}:`;
  for (const [id, unsubscribe] of map) {
    if (!id.startsWith(scopedPrefix)) continue;
    try {
      unsubscribe();
    } catch {
      // ignore teardown failures
    }
    map.delete(id);
  }
}

function disposeAiRuns(): void {
  for (const controller of aiRuns.values()) {
    controller.cancel();
  }
  aiRuns.clear();
}

function disposeScopedAiRuns(windowKey: string): void {
  const scopedPrefix = `${windowKey}:`;
  for (const [id, controller] of aiRuns) {
    if (!id.startsWith(scopedPrefix)) continue;
    controller.cancel();
    aiRuns.delete(id);
  }
}

function disposeWindowScopedResources(windowKey: string): void {
  disposeScopedSubscriptionMap(dataQuoteSubscriptions, windowKey);
  disposeScopedSubscriptionMap(ibkrSnapshotSubscriptions, windowKey);
  disposeScopedSubscriptionMap(ibkrQuoteSubscriptions, windowKey);
  disposeScopedAiRuns(windowKey);
}

function teardownServices(): void {
  disposeSubscriptionMap(dataQuoteSubscriptions);
  disposeSubscriptionMap(ibkrSnapshotSubscriptions);
  disposeSubscriptionMap(ibkrQuoteSubscriptions);
  disposeAiRuns();
  void ibkrGatewayManager.destroyAll().catch(() => {});
  setResolvedIbkrGatewayListener(null);
  services?.destroy();
  services = null;
}

function resolveDetachedWindowTitle(instanceId: string): string {
  const instance = currentConfig ? findPaneInstance(currentConfig.layout, instanceId) : null;
  if (!instance) return "Gloomberb";
  return instance.title?.trim() || instance.paneId;
}

function resolveDetachedWindowFrame(instanceId: string): { x: number; y: number; width: number; height: number } {
  const detachedEntry = requireConfig().layout.detached.find((entry) => entry.instanceId === instanceId);
  if (detachedEntry) {
    return normalizeWindowFrameWithMinimum({
      x: detachedEntry.x,
      y: detachedEntry.y,
      width: detachedEntry.width,
      height: detachedEntry.height,
    }, DEFAULT_WINDOW_FRAME, DETACHED_WINDOW_MIN_SIZE);
  }
  const remembered = findPaneInstance(requireConfig().layout, instanceId)?.placementMemory?.detached;
  if (remembered) {
    return normalizeWindowFrameWithMinimum(remembered, DEFAULT_WINDOW_FRAME, DETACHED_WINDOW_MIN_SIZE);
  }
  const mainFrame = getWindowFrame(mainWindow) ?? DEFAULT_WINDOW_FRAME;
  return normalizeWindowFrameWithMinimum({
    x: mainFrame.x + 72,
    y: mainFrame.y + 72,
    width: Math.max(720, Math.floor(mainFrame.width * 0.45)),
    height: Math.max(420, Math.floor(mainFrame.height * 0.5)),
  }, DEFAULT_WINDOW_FRAME, DETACHED_WINDOW_MIN_SIZE);
}

function resolveDetachedDockEdge(frame: { x: number; y: number; width: number; height: number }): "left" | "right" | "top" | "bottom" | null {
  const mainFrame = getWindowFrame(mainWindow);
  if (!mainFrame) return null;
  const threshold = 72;
  const headerMidX = frame.x + (frame.width / 2);
  const headerMidY = frame.y + 16;
  const overlapsVertically = headerMidY >= mainFrame.y - 32 && headerMidY <= mainFrame.y + mainFrame.height + 32;
  const overlapsHorizontally = headerMidX >= mainFrame.x - 32 && headerMidX <= mainFrame.x + mainFrame.width + 32;

  if (overlapsVertically && Math.abs(headerMidX - mainFrame.x) <= threshold) return "left";
  if (overlapsVertically && Math.abs(headerMidX - (mainFrame.x + mainFrame.width)) <= threshold) return "right";
  if (overlapsHorizontally && Math.abs(headerMidY - mainFrame.y) <= threshold) return "top";
  if (overlapsHorizontally && Math.abs(headerMidY - (mainFrame.y + mainFrame.height)) <= threshold) return "bottom";
  return null;
}

function cleanupDetachedWindowState(instanceId: string): void {
  disposeWindowScopedResources(detachedRpcKey(instanceId));
  detachedWindows.delete(instanceId);
  clearTimer(detachedFrameTimers, instanceId);
  clearTimer(detachedDockTimers, instanceId);
  pendingDetachedMoveFlush.delete(instanceId);
  unregisterWindowRpc(detachedRpcKey(instanceId));
}

async function commitDesktopSnapshot(
  snapshot: DesktopSharedStateSnapshot,
  options: { persistConfig?: boolean; reconcileWindows?: boolean } = {},
): Promise<DesktopSharedStateSnapshot> {
  const nextConfig = syncActiveLayout(snapshot.config);
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

function createDetachedWindow(
  instanceId: string,
  frame: { x: number; y: number; width: number; height: number },
): BrowserWindow {
  const rpc = createWindowRpc(detachedRpcKey(instanceId));
  const initialFrame = normalizeWindowFrameWithMinimum(frame, DEFAULT_WINDOW_FRAME, DETACHED_WINDOW_MIN_SIZE);
  const window = new BrowserWindow({
    title: resolveDetachedWindowTitle(instanceId),
    frame: initialFrame,
    url: "views://mainview/index.html",
    renderer: "native",
    rpc,
    titleBarStyle: "hiddenInset",
    navigationRules: JSON.stringify(["views://*"]),
    sandbox: false,
  });
  updateWindowFrameCache(window, initialFrame, DETACHED_WINDOW_MIN_SIZE);
  detachedWindows.set(instanceId, window);

  (window as any).on?.("close", () => {
    const shouldIgnore = detachedClosingPanes.delete(instanceId);
    cleanupDetachedWindowState(instanceId);
    if (shouldIgnore || !desktopWorkspace || !currentConfig || !isPaneDetached(currentConfig.layout, instanceId)) {
      return;
    }
    void commitDesktopSnapshot(requireDesktopWorkspace().closeDetachedPane(instanceId));
  });

  (window as any).on?.("move", (event: WindowMoveEvent) => {
    applyWindowMoveEvent(window, event);
    scheduleDetachedWindowMove(instanceId);
  });
  (window as any).on?.("resize", (event: WindowResizeEvent) => {
    applyWindowResizeEvent(window, event, DETACHED_WINDOW_MIN_SIZE);
    scheduleDetachedWindowMove(instanceId);
  });

  return window;
}

function scheduleDetachedWindowMove(instanceId: string): void {
  if (pendingDetachedMoveFlush.has(instanceId)) return;
  pendingDetachedMoveFlush.add(instanceId);
  setTimeout(() => {
    pendingDetachedMoveFlush.delete(instanceId);
    handleDetachedWindowMove(instanceId);
  }, 0);
}

function reconcileDetachedWindows(): void {
  const config = currentConfig;
  if (!config) return;

  const desiredEntries = new Map(config.layout.detached.map((entry) => [entry.instanceId, entry] as const));
  for (const [instanceId, entry] of desiredEntries) {
    const existingWindow = detachedWindows.get(instanceId);
    if (!existingWindow) {
      createDetachedWindow(instanceId, entry);
      continue;
    }

    const currentFrame = getWindowFrame(existingWindow);
    const hasLiveFrameUpdate = pendingDetachedMoveFlush.has(instanceId)
      || detachedFrameTimers.has(instanceId)
      || detachedDockTimers.has(instanceId);
    const nextFrame = currentFrame
      ? normalizeWindowFrameWithMinimum(entry, currentFrame, DETACHED_WINDOW_MIN_SIZE)
      : null;
    if (!hasLiveFrameUpdate
      && currentFrame
      && nextFrame
      && (currentFrame.x !== nextFrame.x
        || currentFrame.y !== nextFrame.y
        || currentFrame.width !== nextFrame.width
        || currentFrame.height !== nextFrame.height)) {
      existingWindow.setFrame(nextFrame.x, nextFrame.y, nextFrame.width, nextFrame.height);
    }
    (existingWindow as any).setTitle?.(resolveDetachedWindowTitle(instanceId));
  }

  for (const [instanceId, window] of detachedWindows) {
    if (desiredEntries.has(instanceId)) continue;
    detachedClosingPanes.add(instanceId);
    cleanupDetachedWindowState(instanceId);
    (window as any).close?.();
  }
}

function closeAllDetachedWindows(): void {
  for (const [instanceId, window] of detachedWindows) {
    detachedClosingPanes.add(instanceId);
    cleanupDetachedWindowState(instanceId);
    (window as any).close?.();
  }
  currentDockPreview = { paneId: null, edge: null };
}

function handleDetachedWindowMove(
  instanceId: string,
): void {
  const window = detachedWindows.get(instanceId);
  if (!window || !desktopWorkspace || !currentConfig || !isPaneDetached(currentConfig.layout, instanceId)) {
    return;
  }

  const frame = getWindowFrame(window);
  if (!frame) return;
  const edge = resolveDetachedDockEdge(frame);

  clearTimer(detachedFrameTimers, instanceId);
  detachedFrameTimers.set(instanceId, setTimeout(() => {
    detachedFrameTimers.delete(instanceId);
    if (!currentConfig || !desktopWorkspace || !isPaneDetached(currentConfig.layout, instanceId)) return;
    void commitDesktopSnapshot(
      requireDesktopWorkspace().updateDetachedFrame(instanceId, frame),
      { reconcileWindows: false },
    );
  }, 120));

  clearTimer(detachedDockTimers, instanceId);
  if (!edge) {
    clearDockPreview(instanceId);
    return;
  }

  sendDockPreview({ paneId: instanceId, edge });
  detachedDockTimers.set(instanceId, setTimeout(() => {
    detachedDockTimers.delete(instanceId);
    if (!currentConfig || !desktopWorkspace || !isPaneDetached(currentConfig.layout, instanceId)) return;
    if (currentDockPreview.paneId !== instanceId || currentDockPreview.edge !== edge) return;
    clearDockPreview(instanceId);
    void commitDesktopSnapshot(requireDesktopWorkspace().dockDetachedPane(instanceId, edge));
  }, 120));
}

async function initialize(
  rpc: DesktopRpc,
  payload: Record<string, unknown>,
) {
  const windowTarget = normalizeInitWindowTarget(rpc, payload);
  markWindowRpcReady(rpc);
  if (services && currentConfig) {
    if (!desktopWorkspace) {
      desktopWorkspace = createDesktopWorkspace(currentConfig, getSessionSnapshot());
      reconcileDetachedWindows();
    }
    return {
      config: currentConfig,
      sessionSnapshot: getSessionSnapshot(),
      desktopSnapshot: getDesktopSnapshot(),
      pluginState: loadPluginState(),
      windowKind: windowTarget.kind,
      paneId: windowTarget.paneId,
    };
  }

  let dataDir = await getDataDir();
  if (!dataDir) {
    dataDir = join(process.env.HOME || "~", ".gloomberb");
  }
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  setCurrentConfig(await initDataDir(dataDir));
  services = createAppServices({ config: requireConfig(), externalPlugins: [] });
  syncConfigAccessors();
  desktopWorkspace = createDesktopWorkspace(requireConfig(), getSessionSnapshot());

  setResolvedIbkrGatewayListener((instanceId, connection) => {
    const encodedConnection = encodeRpcValue(connection);
    forEachReadyWindowRpc((currentRpc) => {
      currentRpc.send["ibkr.resolved"]({
        instanceId,
        connection: encodedConnection,
      });
    });
  });

  reconcileDetachedWindows();

  return {
    config: requireConfig(),
    sessionSnapshot: getSessionSnapshot(),
    desktopSnapshot: getDesktopSnapshot(),
    pluginState: loadPluginState(),
    windowKind: windowTarget.kind,
    paneId: windowTarget.paneId,
  };
}

async function handleDataProvider(
  rpc: DesktopRpc,
  method: string,
  payload: Record<string, unknown>,
) {
  const provider = requireServices().dataProvider;
  switch (method) {
    case "data.getTickerFinancials":
      return provider.getTickerFinancials(payload.ticker as string, payload.exchange as string | undefined, payload.context as never);
    case "data.getQuote":
      return provider.getQuote(payload.ticker as string, payload.exchange as string | undefined, payload.context as never);
    case "data.getExchangeRate":
      return provider.getExchangeRate(payload.fromCurrency as string);
    case "data.search":
      return provider.search(payload.query as string, payload.context as never);
    case "data.getNews":
      return (provider as typeof provider & { getNews?: (query: never) => unknown }).getNews?.(payload.query as never) ?? [];
    case "data.getSecFilings":
      return provider.getSecFilings?.(payload.ticker as string, payload.count as number | undefined, payload.exchange as string | undefined, payload.context as never) ?? [];
    case "data.getHolders":
      if (!provider.getHolders) throw new Error("Holder data source unavailable");
      return provider.getHolders(payload.ticker as string, payload.exchange as string | undefined, payload.context as never);
    case "data.getAnalystResearch":
      if (!provider.getAnalystResearch) throw new Error("Analyst data source unavailable");
      return provider.getAnalystResearch(payload.ticker as string, payload.exchange as string | undefined, payload.context as never);
    case "data.getCorporateActions":
      if (!provider.getCorporateActions) throw new Error("Corporate actions source unavailable");
      return provider.getCorporateActions(payload.ticker as string, payload.exchange as string | undefined, payload.context as never);
    case "data.getSecFilingContent":
      return provider.getSecFilingContent?.(payload.filing as never) ?? null;
    case "data.getEarningsCalendar":
      return provider.getEarningsCalendar?.(payload.symbols as string[], payload.context as never) ?? [];
    case "data.getArticleSummary":
      return provider.getArticleSummary(payload.url as string);
    case "data.getPriceHistory":
      return provider.getPriceHistory(payload.ticker as string, payload.exchange as string, payload.range as never, payload.context as never);
    case "data.getPriceHistoryForResolution":
      return provider.getPriceHistoryForResolution?.(
        payload.ticker as string,
        payload.exchange as string,
        payload.bufferRange as never,
        payload.resolution as never,
        payload.context as never,
      ) ?? [];
    case "data.getDetailedPriceHistory":
      return provider.getDetailedPriceHistory?.(
        payload.ticker as string,
        payload.exchange as string,
        payload.startDate as Date,
        payload.endDate as Date,
        payload.barSize as string,
        payload.context as never,
      ) ?? [];
    case "data.getChartResolutionSupport":
      return provider.getChartResolutionSupport?.(payload.ticker as string, payload.exchange as string | undefined, payload.context as never) ?? [];
    case "data.getOptionsChain":
      return provider.getOptionsChain?.(payload.ticker as string, payload.exchange as string | undefined, payload.expirationDate as number | undefined, payload.context as never) ?? null;
    case "data.subscribeQuotes": {
      const subscriptionId = payload.subscriptionId as string;
      const scopedSubscriptionId = scopeClientId(rpc, subscriptionId);
      dataQuoteSubscriptions.get(scopedSubscriptionId)?.();
      const unsubscribe = provider.subscribeQuotes(
        payload.targets as QuoteSubscriptionTarget[],
        (target, quote) => {
          rpc.send["quote.update"]({
            subscriptionId,
            target: encodeRpcValue(target),
            quote: encodeRpcValue(quote),
          });
        },
      );
      dataQuoteSubscriptions.set(scopedSubscriptionId, unsubscribe);
      return null;
    }
    case "data.unsubscribeQuotes": {
      const scopedSubscriptionId = scopeClientId(rpc, payload.subscriptionId as string);
      dataQuoteSubscriptions.get(scopedSubscriptionId)?.();
      dataQuoteSubscriptions.delete(scopedSubscriptionId);
      return null;
    }
    default:
      throw new Error(`Unknown data method: ${method}`);
  }
}

async function handleIbkr(
  rpc: DesktopRpc,
  method: string,
  payload: Record<string, unknown>,
) {
  const instanceId = payload.instanceId as string | undefined;
  const service = instanceId ? ibkrGatewayManager.getService(instanceId) : null;
  const config = payload.config as IbkrGatewayConfig | undefined;

  switch (method) {
    case "ibkr.subscribeSnapshot": {
      const subscriptionId = payload.subscriptionId as string;
      const scopedSubscriptionId = scopeClientId(rpc, subscriptionId);
      if (!instanceId || !service) return null;
      ibkrSnapshotSubscriptions.get(scopedSubscriptionId)?.();
      const pushSnapshot = () => {
        rpc.send["ibkr.snapshot"]({
          subscriptionId,
          instanceId,
          snapshot: encodeRpcValue(service.getSnapshot()),
          resolvedConnection: encodeRpcValue(service.getResolvedConnection()),
        });
      };
      const unsubscribe = service.subscribe(pushSnapshot);
      ibkrSnapshotSubscriptions.set(scopedSubscriptionId, unsubscribe);
      pushSnapshot();
      return null;
    }
    case "ibkr.unsubscribeSnapshot": {
      const scopedSubscriptionId = scopeClientId(rpc, payload.subscriptionId as string);
      ibkrSnapshotSubscriptions.get(scopedSubscriptionId)?.();
      ibkrSnapshotSubscriptions.delete(scopedSubscriptionId);
      return null;
    }
    case "ibkr.connect":
      if (!service || !config) throw new Error("ibkr.connect requires an instance and config.");
      return service.connect(config);
    case "ibkr.disconnect":
      if (!service) throw new Error("ibkr.disconnect requires an instance.");
      return service.disconnect();
    case "ibkr.getAccounts":
      if (!service || !config) throw new Error("ibkr.getAccounts requires an instance and config.");
      return service.getAccounts(config);
    case "ibkr.getPositions":
      if (!service || !config) throw new Error("ibkr.getPositions requires an instance and config.");
      return service.getPositions(config);
    case "ibkr.listOpenOrders":
      if (!service || !config) throw new Error("ibkr.listOpenOrders requires an instance and config.");
      return service.listOpenOrders(config);
    case "ibkr.listExecutions":
      if (!service || !config) throw new Error("ibkr.listExecutions requires an instance and config.");
      return service.listExecutions(config);
    case "ibkr.searchInstruments":
      if (!service || !config) throw new Error("ibkr.searchInstruments requires an instance and config.");
      return service.searchInstruments(payload.query as string, config);
    case "ibkr.getTickerFinancials":
      if (!service || !config) throw new Error("ibkr.getTickerFinancials requires an instance and config.");
      return service.getTickerFinancials(
        payload.ticker as string,
        config,
        payload.exchange as string | undefined,
        payload.instrument as BrokerContractRef | null | undefined,
      );
    case "ibkr.getQuote":
      if (!service || !config) throw new Error("ibkr.getQuote requires an instance and config.");
      return service.getQuote(
        payload.ticker as string,
        config,
        payload.exchange as string | undefined,
        payload.instrument as BrokerContractRef | null | undefined,
      );
    case "ibkr.getPriceHistory":
      if (!service || !config) throw new Error("ibkr.getPriceHistory requires an instance and config.");
      return service.getPriceHistory(
        payload.ticker as string,
        config,
        payload.exchange as string,
        payload.range as never,
        payload.instrument as BrokerContractRef | null | undefined,
      );
    case "ibkr.getChartResolutionSupport":
      if (!service || !config) throw new Error("ibkr.getChartResolutionSupport requires an instance and config.");
      return service.getChartResolutionSupport(
        payload.ticker as string,
        config,
        payload.exchange as string | undefined,
        payload.instrument as BrokerContractRef | null | undefined,
      );
    case "ibkr.getPriceHistoryForResolution":
      if (!service || !config) throw new Error("ibkr.getPriceHistoryForResolution requires an instance and config.");
      return service.getPriceHistoryForResolution(
        payload.ticker as string,
        config,
        payload.exchange as string,
        payload.bufferRange as never,
        payload.resolution as never,
        payload.instrument as BrokerContractRef | null | undefined,
      );
    case "ibkr.getDetailedPriceHistory":
      if (!service || !config) throw new Error("ibkr.getDetailedPriceHistory requires an instance and config.");
      return service.getDetailedPriceHistory(
        payload.ticker as string,
        config,
        payload.exchange as string,
        payload.startDate as Date,
        payload.endDate as Date,
        payload.barSize as string,
        payload.instrument as BrokerContractRef | null | undefined,
      );
    case "ibkr.subscribeQuotes": {
      if (!service || !config) throw new Error("ibkr.subscribeQuotes requires an instance and config.");
      const subscriptionId = payload.subscriptionId as string;
      const scopedSubscriptionId = scopeClientId(rpc, subscriptionId);
      ibkrQuoteSubscriptions.get(scopedSubscriptionId)?.();
      const unsubscribe = service.subscribeQuotes(
        config,
        payload.targets as QuoteSubscriptionTarget[],
        (target, quote) => {
          rpc.send["ibkr.quote.update"]({
            subscriptionId,
            target: encodeRpcValue(target),
            quote: encodeRpcValue(quote),
          });
        },
      );
      ibkrQuoteSubscriptions.set(scopedSubscriptionId, unsubscribe);
      return null;
    }
    case "ibkr.unsubscribeQuotes": {
      const scopedSubscriptionId = scopeClientId(rpc, payload.subscriptionId as string);
      ibkrQuoteSubscriptions.get(scopedSubscriptionId)?.();
      ibkrQuoteSubscriptions.delete(scopedSubscriptionId);
      return null;
    }
    case "ibkr.previewOrder":
      if (!service || !config) throw new Error("ibkr.previewOrder requires an instance and config.");
      return service.previewOrder(config, payload.request as BrokerOrderRequest);
    case "ibkr.placeOrder":
      if (!service || !config) throw new Error("ibkr.placeOrder requires an instance and config.");
      return service.placeOrder(config, payload.request as BrokerOrderRequest);
    case "ibkr.modifyOrder":
      if (!service || !config) throw new Error("ibkr.modifyOrder requires an instance and config.");
      return service.modifyOrder(config, payload.orderId as number, payload.request as BrokerOrderRequest);
    case "ibkr.cancelOrder":
      if (!service || !config) throw new Error("ibkr.cancelOrder requires an instance and config.");
      return service.cancelOrder(config, payload.orderId as number);
    case "ibkr.removeInstance":
      if (!instanceId) throw new Error("ibkr.removeInstance requires an instance.");
      return ibkrGatewayManager.removeInstance(instanceId);
    case "ibkr.destroyAll":
      return ibkrGatewayManager.destroyAll();
    default:
      throw new Error(`Unknown IBKR method: ${method}`);
  }
}

function getAiProviderAvailability(): Record<string, boolean> {
  const availability: Record<string, boolean> = {};
  for (const definition of getAiProviderDefinitions()) {
    availability[definition.id] = typeof Bun.which === "function" ? !!Bun.which(definition.command) : false;
  }
  return availability;
}

async function handleAi(
  rpc: DesktopRpc,
  method: string,
  payload: Record<string, unknown>,
) {
  switch (method) {
    case "ai.getProviderAvailability":
      return getAiProviderAvailability();
    case "ai.run": {
      const runId = payload.runId as string;
      const scopedRunId = scopeClientId(rpc, runId);
      const providerId = payload.providerId as string;
      const prompt = payload.prompt as string;
      const providerDefinition = getAiProviderDefinitions().find((entry) => entry.id === providerId);
      if (!providerDefinition) {
        throw new Error(`Unknown AI provider: ${providerId}`);
      }
      if (typeof Bun.which !== "function" || !Bun.which(providerDefinition.command)) {
        throw new Error(`${providerDefinition.name} is not installed on this system.`);
      }

      aiRuns.get(scopedRunId)?.cancel();
      const controller = runAiPrompt({
        provider: {
          ...providerDefinition,
          available: true,
        },
        prompt,
        cwd: typeof payload.cwd === "string" && payload.cwd.length > 0 ? payload.cwd : requireConfig().dataDir,
        onChunk: (output) => {
          rpc.send["ai.chunk"]({ runId, output });
        },
      });
      aiRuns.set(scopedRunId, controller);
      return controller.done.finally(() => {
        aiRuns.delete(scopedRunId);
      });
    }
    case "ai.cancel": {
      const scopedRunId = scopeClientId(rpc, payload.runId as string);
      aiRuns.get(scopedRunId)?.cancel();
      aiRuns.delete(scopedRunId);
      return null;
    }
    default:
      throw new Error(`Unknown AI method: ${method}`);
  }
}

async function handleNotes(method: string, payload: Record<string, unknown>) {
  const dataDir = payload.dataDir as string;
  if (!dataDir) {
    throw new Error(`${method} requires a dataDir.`);
  }

  switch (method) {
    case "notes.load":
      return readTextOrEmpty(notePath(dataDir, payload.symbol as string));
    case "notes.save":
      await writeTextEnsuringParent(notePath(dataDir, payload.symbol as string), normalizeText(payload.notes) ?? "");
      return null;
    case "notes.delete":
      await deleteFileIfPresent(notePath(dataDir, payload.symbol as string));
      return null;
    case "notes.loadQuickNotesIndex": {
      const raw = await readTextOrEmpty(notesIndexPath(dataDir));
      if (!raw.trim()) return [];
      try {
        return JSON.parse(raw);
      } catch {
        return [];
      }
    }
    case "notes.saveQuickNotesIndex":
      await writeTextEnsuringParent(notesIndexPath(dataDir), JSON.stringify(payload.entries ?? []));
      return null;
    default:
      throw new Error(`Unknown notes method: ${method}`);
  }
}

async function handleDesktop(
  rpc: DesktopRpc,
  method: string,
  payload: Record<string, unknown>,
) {
  const workspace = requireDesktopWorkspace();
  switch (method) {
    case "desktop.syncMainState": {
      const snapshot = workspace.syncMainState(payload.snapshot as DesktopSharedStateSnapshot);
      setCurrentConfig(snapshot.config);
      reconcileDetachedWindows();
      sendDesktopState(snapshot);
      return null;
    }
    case "desktop.replaceDetachedPaneState":
      if (typeof payload.paneId !== "string") {
        throw new Error("desktop.replaceDetachedPaneState requires paneId.");
      }
      sendDesktopState(workspace.replaceDetachedPaneState(payload.paneId, payload.paneState as PaneRuntimeState));
      return null;
    case "desktop.popOutPane": {
      if (typeof payload.paneId !== "string") {
        throw new Error("desktop.popOutPane requires paneId.");
      }
      const snapshot = workspace.popOutPane(payload.paneId, resolveDetachedWindowFrame(payload.paneId));
      await commitDesktopSnapshot(snapshot);
      (detachedWindows.get(payload.paneId) as any)?.focus?.();
      return null;
    }
    case "desktop.dockDetachedPane": {
      if (typeof payload.paneId !== "string") {
        throw new Error("desktop.dockDetachedPane requires paneId.");
      }
      clearDockPreview(payload.paneId);
      await commitDesktopSnapshot(
        workspace.dockDetachedPane(
          payload.paneId,
          payload.edge === "left" || payload.edge === "right" || payload.edge === "top" || payload.edge === "bottom"
            ? payload.edge
            : undefined,
        ),
      );
      return null;
    }
    case "desktop.closeDetachedPane": {
      if (typeof payload.paneId !== "string") {
        throw new Error("desktop.closeDetachedPane requires paneId.");
      }
      clearDockPreview(payload.paneId);
      await commitDesktopSnapshot(workspace.closeDetachedPane(payload.paneId));
      return null;
    }
    case "desktop.focusDetachedPane":
      if (typeof payload.paneId !== "string") {
        throw new Error("desktop.focusDetachedPane requires paneId.");
      }
      (detachedWindows.get(payload.paneId) as any)?.focus?.();
      return null;
    default:
      throw new Error(`Unknown desktop method: ${method}`);
  }
}

async function handleBackendRequest(
  rpc: DesktopRpc,
  method: string,
  rawPayload: unknown,
) {
  const payload = decodeRpcValue<Record<string, unknown>>(rawPayload ?? {});

  if (method === "init") return initialize(rpc, payload);
  if (method === "http.fetch") return handleHttpFetch(payload);
  if (method.startsWith("data.")) return handleDataProvider(rpc, method, payload);
  if (method.startsWith("ibkr.")) return handleIbkr(rpc, method, payload);
  if (method.startsWith("ai.")) return handleAi(rpc, method, payload);
  if (method.startsWith("notes.")) return handleNotes(method, payload);
  if (method.startsWith("desktop.")) return handleDesktop(rpc, method, payload);

  switch (method) {
    case "update.check":
      return checkDesktopUpdate(typeof payload.currentVersion === "string" ? payload.currentVersion : "");
    case "update.start": {
      const release = payload.release && typeof payload.release === "object"
        ? payload.release as Partial<ReleaseInfo>
        : null;
      void runDesktopUpdate(
        rpc,
        typeof payload.currentVersion === "string" ? payload.currentVersion : release?.version ?? "",
      );
      return null;
    }
    case "ticker.loadAll":
      return requireServices().tickerRepository.loadAllTickers();
    case "ticker.load":
      return requireServices().tickerRepository.loadTicker(payload.symbol as string);
    case "ticker.save":
      return requireServices().tickerRepository.saveTicker(payload.ticker as never);
    case "ticker.delete":
      return requireServices().tickerRepository.deleteTicker(payload.symbol as string);
    case "config.save":
      setCurrentConfig(payload.config as AppConfig);
      if (desktopWorkspace) {
        await commitDesktopSnapshot(desktopWorkspace.replaceConfig(requireConfig(), { layoutChanged: true }));
        return null;
      }
      return saveConfig(requireConfig());
    case "config.resetAllData":
      closeAllDetachedWindows();
      desktopWorkspace = null;
      teardownServices();
      currentConfig = null;
      return resetAllData(payload.dataDir as string);
    case "config.export":
      return exportConfig(payload.config as AppConfig, payload.destPath as string);
    case "config.import":
      closeAllDetachedWindows();
      desktopWorkspace = null;
      teardownServices();
      setCurrentConfig(await importConfig(payload.dataDir as string, payload.srcPath as string));
      services = createAppServices({ config: requireConfig(), externalPlugins: [] });
      syncConfigAccessors();
      desktopWorkspace = createDesktopWorkspace(requireConfig(), getSessionSnapshot());
      setResolvedIbkrGatewayListener((instanceId, connection) => {
        const encodedConnection = encodeRpcValue(connection);
        forEachReadyWindowRpc((currentRpc) => {
          currentRpc.send["ibkr.resolved"]({
            instanceId,
            connection: encodedConnection,
          });
        });
      });
      reconcileDetachedWindows();
      sendDesktopState(requireDesktopWorkspace().getSnapshot());
      return requireConfig();
    case "session.set":
      requireServices().persistence.sessions.set(payload.sessionId as string, payload.value, payload.schemaVersion as number | undefined);
      return null;
    case "session.delete":
      requireServices().persistence.sessions.delete(payload.sessionId as string);
      return null;
    case "pluginState.set":
      requireServices().persistence.pluginState.set(payload.pluginId as string, payload.key as string, payload.value, payload.schemaVersion as number | undefined);
      syncBackendCloudAuthState(payload.pluginId as string, payload.key as string, payload.value);
      return null;
    case "pluginState.delete":
      requireServices().persistence.pluginState.delete(payload.pluginId as string, payload.key as string);
      syncBackendCloudAuthState(payload.pluginId as string, payload.key as string, null);
      return null;
    case "host.exit":
      closeAllDetachedWindows();
      teardownServices();
      if (mainWindow) {
        mainWindow.close();
        mainWindow = null;
        return null;
      }
      Utils.quit();
      return null;
    case "host.openExternal":
      if (typeof payload.url !== "string") {
        throw new Error("host.openExternal requires a URL.");
      }
      Utils.openExternal(payload.url);
      return null;
    case "host.copyText":
      Utils.clipboardWriteText(normalizeText(payload.text) ?? "");
      return null;
    case "host.copyPngImage": {
      const pngBase64 = normalizeText(payload.pngBase64);
      if (!pngBase64) throw new Error("host.copyPngImage requires PNG data.");
      Utils.clipboardWriteImage(new Uint8Array(Buffer.from(pngBase64, "base64")));
      return null;
    }
    case "host.readText":
      return Utils.clipboardReadText() ?? "";
    case "host.notify":
      playNotificationSound(normalizeText(payload.sound));
      Utils.showNotification({
        title: normalizeText(payload.title) ?? "Gloomberb",
        body: normalizeText(payload.body),
        subtitle: normalizeText(payload.subtitle),
        silent: true,
      });
      return null;
    case "host.showContextMenu": {
      const menu = normalizeContextMenuItems(payload.menu);
      if (menu.length === 0) return false;
      const requestId = getContextMenuRequestId(menu);
      if (requestId) {
        contextMenuRequestRpcs.clear();
        contextMenuRequestRpcs.set(requestId, rpc);
      }
      ContextMenu.showContextMenu(menu as never);
      return true;
    }
    default:
      throw new Error(`Unknown backend method: ${method}`);
  }
}

function installApplicationMenu() {
  ApplicationMenu.setApplicationMenu(buildApplicationMenu());
}

function createWindowRpc(key: string): DesktopRpc {
  let rpc!: DesktopRpc;
  rpc = BrowserView.defineRPC<ElectrobunDesktopRpcSchema>({
    handlers: {
      requests: {
        "backend.request": async ({ method, payload }) => encodeRpcValue(await handleBackendRequest(rpc, method, payload)),
      },
      messages: {},
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
  if (!command || !readyWindowRpcs.has(MAIN_WINDOW_RPC_KEY)) return;
  windowRpcs.get(MAIN_WINDOW_RPC_KEY)?.send["application-menu.select"]({ command });
});

installApplicationMenu();

const mainRpc = createWindowRpc(MAIN_WINDOW_RPC_KEY);

mainWindow = new BrowserWindow({
  title: "Gloomberb",
  frame: normalizeWindowFrameWithMinimum(DEFAULT_WINDOW_FRAME, DEFAULT_WINDOW_FRAME, MAIN_WINDOW_MIN_SIZE),
  url: "views://mainview/index.html",
  renderer: "native",
  rpc: mainRpc,
  titleBarStyle: "hiddenInset",
  navigationRules: JSON.stringify(["views://*"]),
  sandbox: false,
});
updateWindowFrameCache(mainWindow, DEFAULT_WINDOW_FRAME, MAIN_WINDOW_MIN_SIZE);
(mainWindow as any).on?.("move", (event: WindowMoveEvent) => {
  applyWindowMoveEvent(mainWindow, event);
});
(mainWindow as any).on?.("resize", (event: WindowResizeEvent) => {
  applyWindowResizeEvent(mainWindow, event, MAIN_WINDOW_MIN_SIZE);
});
