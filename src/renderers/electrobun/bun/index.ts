import { existsSync, mkdirSync } from "fs";
import { mkdir, readFile, rm, unlink, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { ApplicationMenu, BrowserView, BrowserWindow, Utils } from "electrobun/bun";
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
import type { AppConfig } from "../../../types/config";
import type { AppSessionSnapshot } from "../../../core/state/session-persistence";
import type { QuoteSubscriptionTarget } from "../../../types/data-provider";
import type { BrokerOrderRequest } from "../../../types/trading";
import { type ElectrobunDesktopRpcSchema } from "../shared/protocol";
import { decodeRpcValue, encodeRpcValue } from "../view/rpc-codec";
import { startMainThreadMonitor } from "../../../utils/main-thread-monitor";

const DEFAULT_WINDOW_FRAME = { x: 64, y: 48, width: 1440, height: 920 };
const NOTES_INDEX_FILE = "__quick-notes-index__.json";

console.log = (...args) => console.error(...args);
console.info = (...args) => console.error(...args);
console.warn = (...args) => console.error(...args);

startMainThreadMonitor("electrobun.bun", { mirrorToConsole: true });
setConfigStoreHost(nodeConfigStoreHost);

let currentConfig: AppConfig | null = null;
let services: AppServices | null = null;
let mainWindow: BrowserWindow | null = null;

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

  return {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
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

function disposeAiRuns(): void {
  for (const controller of aiRuns.values()) {
    controller.cancel();
  }
  aiRuns.clear();
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

async function initialize(rpc: ReturnType<typeof BrowserView.defineRPC<ElectrobunDesktopRpcSchema>>) {
  if (services && currentConfig) {
    return {
      config: currentConfig,
      sessionSnapshot: getSessionSnapshot(),
      pluginState: loadPluginState(),
    };
  }

  let dataDir = await getDataDir();
  if (!dataDir) {
    dataDir = join(process.env.HOME || "~", ".gloomberb");
  }
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  currentConfig = await initDataDir(dataDir);
  services = createAppServices({ config: currentConfig, externalPlugins: [] });
  syncConfigAccessors();

  setResolvedIbkrGatewayListener((instanceId, connection) => {
    rpc.send["ibkr.resolved"]({
      instanceId,
      connection: encodeRpcValue(connection),
    });
  });

  return {
    config: currentConfig,
    sessionSnapshot: getSessionSnapshot(),
    pluginState: loadPluginState(),
  };
}

async function handleDataProvider(
  rpc: ReturnType<typeof BrowserView.defineRPC<ElectrobunDesktopRpcSchema>>,
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
      return provider.getNews(payload.ticker as string, payload.count as number | undefined, payload.exchange as string | undefined, payload.context as never);
    case "data.getSecFilings":
      return provider.getSecFilings?.(payload.ticker as string, payload.count as number | undefined, payload.exchange as string | undefined, payload.context as never) ?? [];
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
      dataQuoteSubscriptions.get(subscriptionId)?.();
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
      dataQuoteSubscriptions.set(subscriptionId, unsubscribe);
      return null;
    }
    case "data.unsubscribeQuotes": {
      const subscriptionId = payload.subscriptionId as string;
      dataQuoteSubscriptions.get(subscriptionId)?.();
      dataQuoteSubscriptions.delete(subscriptionId);
      return null;
    }
    default:
      throw new Error(`Unknown data method: ${method}`);
  }
}

async function handleIbkr(
  rpc: ReturnType<typeof BrowserView.defineRPC<ElectrobunDesktopRpcSchema>>,
  method: string,
  payload: Record<string, unknown>,
) {
  const instanceId = payload.instanceId as string | undefined;
  const service = instanceId ? ibkrGatewayManager.getService(instanceId) : null;
  const config = payload.config as IbkrGatewayConfig | undefined;

  switch (method) {
    case "ibkr.subscribeSnapshot": {
      const subscriptionId = payload.subscriptionId as string;
      if (!instanceId || !service) return null;
      ibkrSnapshotSubscriptions.get(subscriptionId)?.();
      const pushSnapshot = () => {
        rpc.send["ibkr.snapshot"]({
          subscriptionId,
          instanceId,
          snapshot: encodeRpcValue(service.getSnapshot()),
          resolvedConnection: encodeRpcValue(service.getResolvedConnection()),
        });
      };
      const unsubscribe = service.subscribe(pushSnapshot);
      ibkrSnapshotSubscriptions.set(subscriptionId, unsubscribe);
      pushSnapshot();
      return null;
    }
    case "ibkr.unsubscribeSnapshot": {
      const subscriptionId = payload.subscriptionId as string;
      ibkrSnapshotSubscriptions.get(subscriptionId)?.();
      ibkrSnapshotSubscriptions.delete(subscriptionId);
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
      ibkrQuoteSubscriptions.get(subscriptionId)?.();
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
      ibkrQuoteSubscriptions.set(subscriptionId, unsubscribe);
      return null;
    }
    case "ibkr.unsubscribeQuotes": {
      const subscriptionId = payload.subscriptionId as string;
      ibkrQuoteSubscriptions.get(subscriptionId)?.();
      ibkrQuoteSubscriptions.delete(subscriptionId);
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
  rpc: ReturnType<typeof BrowserView.defineRPC<ElectrobunDesktopRpcSchema>>,
  method: string,
  payload: Record<string, unknown>,
) {
  switch (method) {
    case "ai.getProviderAvailability":
      return getAiProviderAvailability();
    case "ai.run": {
      const runId = payload.runId as string;
      const providerId = payload.providerId as string;
      const prompt = payload.prompt as string;
      const providerDefinition = getAiProviderDefinitions().find((entry) => entry.id === providerId);
      if (!providerDefinition) {
        throw new Error(`Unknown AI provider: ${providerId}`);
      }
      if (typeof Bun.which !== "function" || !Bun.which(providerDefinition.command)) {
        throw new Error(`${providerDefinition.name} is not installed on this system.`);
      }

      aiRuns.get(runId)?.cancel();
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
      aiRuns.set(runId, controller);
      return controller.done.finally(() => {
        aiRuns.delete(runId);
      });
    }
    case "ai.cancel": {
      const runId = payload.runId as string;
      aiRuns.get(runId)?.cancel();
      aiRuns.delete(runId);
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

async function handleBackendRequest(
  rpc: ReturnType<typeof BrowserView.defineRPC<ElectrobunDesktopRpcSchema>>,
  method: string,
  rawPayload: unknown,
) {
  const payload = decodeRpcValue<Record<string, unknown>>(rawPayload ?? {});

  if (method === "init") return initialize(rpc);
  if (method === "http.fetch") return handleHttpFetch(payload);
  if (method.startsWith("data.")) return handleDataProvider(rpc, method, payload);
  if (method.startsWith("ibkr.")) return handleIbkr(rpc, method, payload);
  if (method.startsWith("ai.")) return handleAi(rpc, method, payload);
  if (method.startsWith("notes.")) return handleNotes(method, payload);

  switch (method) {
    case "ticker.loadAll":
      return requireServices().tickerRepository.loadAllTickers();
    case "ticker.load":
      return requireServices().tickerRepository.loadTicker(payload.symbol as string);
    case "ticker.save":
      return requireServices().tickerRepository.saveTicker(payload.ticker as never);
    case "ticker.delete":
      return requireServices().tickerRepository.deleteTicker(payload.symbol as string);
    case "config.save":
      currentConfig = payload.config as AppConfig;
      syncConfigAccessors();
      return saveConfig(currentConfig);
    case "config.resetAllData":
      teardownServices();
      currentConfig = null;
      return resetAllData(payload.dataDir as string);
    case "config.export":
      return exportConfig(payload.config as AppConfig, payload.destPath as string);
    case "config.import":
      teardownServices();
      currentConfig = await importConfig(payload.dataDir as string, payload.srcPath as string);
      services = createAppServices({ config: currentConfig, externalPlugins: [] });
      syncConfigAccessors();
      setResolvedIbkrGatewayListener((instanceId, connection) => {
        rpc.send["ibkr.resolved"]({
          instanceId,
          connection: encodeRpcValue(connection),
        });
      });
      return currentConfig;
    case "session.set":
      requireServices().persistence.sessions.set(payload.sessionId as string, payload.value, payload.schemaVersion as number | undefined);
      return null;
    case "session.delete":
      requireServices().persistence.sessions.delete(payload.sessionId as string);
      return null;
    case "pluginState.set":
      requireServices().persistence.pluginState.set(payload.pluginId as string, payload.key as string, payload.value, payload.schemaVersion as number | undefined);
      return null;
    case "pluginState.delete":
      requireServices().persistence.pluginState.delete(payload.pluginId as string, payload.key as string);
      return null;
    case "host.exit":
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
    case "host.readText":
      return Utils.clipboardReadText() ?? "";
    case "host.notify":
      Utils.showNotification({
        title: normalizeText(payload.title) ?? "Gloomberb",
        body: normalizeText(payload.body),
      });
      return null;
    default:
      throw new Error(`Unknown backend method: ${method}`);
  }
}

function installApplicationMenu() {
  ApplicationMenu.setApplicationMenu([
    {
      label: "Gloomberb",
      submenu: [
        { role: "about" },
        { type: "divider" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "showAll" },
        { type: "divider" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "divider" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "divider" },
        { role: "toggleFullScreen" },
        { type: "divider" },
        { role: "close" },
      ],
    },
  ]);
}

const rpc = BrowserView.defineRPC<ElectrobunDesktopRpcSchema>({
  handlers: {
    requests: {
      "backend.request": async ({ method, payload }) => encodeRpcValue(await handleBackendRequest(rpc, method, payload)),
    },
    messages: {},
  },
});

installApplicationMenu();

mainWindow = new BrowserWindow({
  title: "Gloomberb",
  frame: DEFAULT_WINDOW_FRAME,
  url: "views://mainview/index.html",
  renderer: "native",
  rpc,
  titleBarStyle: "hiddenInset",
  navigationRules: JSON.stringify(["views://*"]),
  sandbox: false,
});
