import { setConfigStoreHost, type ConfigStoreHost } from "../../../data/config-store";
import type { AppConfig } from "../../../types/config";
import { backendRequest, getTauriBackendInitSnapshot } from "./backend-rpc";

const tauriConfigStoreHost: ConfigStoreHost = {
  async getDataDir() {
    return getTauriBackendInitSnapshot()?.config.dataDir ?? null;
  },
  async loadConfig() {
    const config = getTauriBackendInitSnapshot()?.config;
    if (!config) throw new Error("Tauri backend has not initialized config.");
    return config;
  },
  async saveConfig(config: AppConfig) {
    await backendRequest("config.save", { config });
  },
  async initDataDir() {
    const config = getTauriBackendInitSnapshot()?.config;
    if (!config) throw new Error("Tauri backend has not initialized config.");
    return config;
  },
  async resetAllData(dataDir: string) {
    await backendRequest("config.resetAllData", { dataDir });
  },
  async exportConfig(config: AppConfig, destPath: string) {
    await backendRequest("config.export", { config, destPath });
  },
  async importConfig(dataDir: string, srcPath: string) {
    return backendRequest<AppConfig>("config.import", { dataDir, srcPath });
  },
};

export function installTauriConfigStoreHost(): void {
  setConfigStoreHost(tauriConfigStoreHost);
}
