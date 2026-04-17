import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { createInterface } from "readline";
import { getDataDir, initDataDir, saveConfig, resetAllData, exportConfig, importConfig, setConfigStoreHost } from "../../../data/config-store";
import * as nodeConfigStoreHost from "../../../data/config-store-node";
import { createAppServices, type AppServices } from "../../../core/app-services";
import type { AppConfig } from "../../../types/config";
import type { AppSessionSnapshot } from "../../../core/state/session-persistence";
import {
  APP_SESSION_ID,
  APP_SESSION_SCHEMA_VERSION,
  reconcileAppSessionSnapshot,
} from "../../../core/state/session-persistence";
import { encodeRpcValue, decodeRpcValue } from "../web/rpc-codec";
import { startMainThreadMonitor } from "../../../utils/main-thread-monitor";

console.log = (...args) => console.error(...args);
console.info = (...args) => console.error(...args);
console.warn = (...args) => console.error(...args);
startMainThreadMonitor("tauri.backend", { mirrorToConsole: true });

setConfigStoreHost(nodeConfigStoreHost);

interface RpcRequest {
  id: number;
  method: string;
  payload?: unknown;
}

let currentConfig: AppConfig | null = null;
let services: AppServices | null = null;

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

async function initialize() {
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

  return {
    config: currentConfig,
    sessionSnapshot: getSessionSnapshot(),
    pluginState: loadPluginState(),
  };
}

function getSessionSnapshot(): AppSessionSnapshot | null {
  if (!currentConfig || !services) return null;
  const persisted = services.persistence.sessions.get<AppSessionSnapshot>(APP_SESSION_ID, APP_SESSION_SCHEMA_VERSION)?.value ?? null;
  return reconcileAppSessionSnapshot(currentConfig, persisted);
}

async function handleDataProvider(method: string, payload: Record<string, unknown>) {
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
  }
}

async function handleRequest(method: string, rawPayload: unknown) {
  const payload = decodeRpcValue<Record<string, unknown>>(rawPayload ?? {});

  if (method === "init") return initialize();

  if (method === "http.fetch") return handleHttpFetch(payload);

  if (method.startsWith("data.")) {
    return handleDataProvider(method, payload);
  }

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
      return resetAllData(payload.dataDir as string);
    case "config.export":
      return exportConfig(payload.config as AppConfig, payload.destPath as string);
    case "config.import":
      currentConfig = await importConfig(payload.dataDir as string, payload.srcPath as string);
      syncConfigAccessors();
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
    default:
      throw new Error(`Unknown backend method: ${method}`);
  }
}

const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });

reader.on("line", (line) => {
  void (async () => {
    const request = JSON.parse(line) as RpcRequest;
    try {
      const result = await handleRequest(request.method, request.payload);
      process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, result: encodeRpcValue(result) })}\n`);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ id: request.id, ok: false, error: summarizeError(error) })}\n`);
    }
  })();
});

process.once("SIGTERM", () => {
  services?.destroy();
  process.exit(0);
});
