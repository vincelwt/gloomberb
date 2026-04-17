import type { AppConfig } from "../types/config";

export { sanitizeLayout } from "./config-layout";

export interface ConfigStoreHost {
  getDataDir(): Promise<string | null>;
  loadConfig(dataDir: string): Promise<AppConfig>;
  saveConfig(config: AppConfig): Promise<void>;
  initDataDir(dataDir: string): Promise<AppConfig>;
  resetAllData(dataDir: string): Promise<void>;
  exportConfig(config: AppConfig, destPath: string): Promise<void>;
  importConfig(dataDir: string, srcPath: string): Promise<AppConfig>;
}

let configuredHost: ConfigStoreHost | null = null;
let nodeHostPromise: Promise<ConfigStoreHost> | null = null;

export function setConfigStoreHost(host: ConfigStoreHost | null): void {
  configuredHost = host;
}

async function loadNodeHost(): Promise<ConfigStoreHost> {
  if (!nodeHostPromise) {
    const modulePath = "./config-store-node";
    nodeHostPromise = import(modulePath) as Promise<ConfigStoreHost>;
  }
  return nodeHostPromise;
}

async function getHost(): Promise<ConfigStoreHost> {
  if (configuredHost) return configuredHost;
  if (typeof Bun === "undefined") {
    throw new Error("Config store host is not configured for this renderer.");
  }
  return loadNodeHost();
}

export async function getDataDir(): Promise<string | null> {
  return (await getHost()).getDataDir();
}

export async function loadConfig(dataDir: string): Promise<AppConfig> {
  return (await getHost()).loadConfig(dataDir);
}

export async function saveConfig(config: AppConfig): Promise<void> {
  return (await getHost()).saveConfig(config);
}

export async function initDataDir(dataDir: string): Promise<AppConfig> {
  return (await getHost()).initDataDir(dataDir);
}

export async function resetAllData(dataDir: string): Promise<void> {
  return (await getHost()).resetAllData(dataDir);
}

export async function exportConfig(config: AppConfig, destPath: string): Promise<void> {
  return (await getHost()).exportConfig(config, destPath);
}

export async function importConfig(dataDir: string, srcPath: string): Promise<AppConfig> {
  return (await getHost()).importConfig(dataDir, srcPath);
}
