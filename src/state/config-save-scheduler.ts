import { saveConfig } from "../data/config-store";
import type { AppConfig } from "../types/config";
import { debugLog } from "../utils/debug-log";
import { measurePerfAsync } from "../utils/perf-marks";
import {
  CONFIG_SAVE_DEBOUNCE_MS,
  createPersistScheduler,
} from "./persist-scheduler";

const log = debugLog.createLogger("persist");

const configSaveScheduler = createPersistScheduler<AppConfig>({
  delayMs: CONFIG_SAVE_DEBOUNCE_MS,
  save: (config) => measurePerfAsync("persist.config.save", () => saveConfig(config)),
  onError: (error) => {
    log.warn("config.save.failed", { error: error instanceof Error ? error.message : String(error) });
  },
});

export function scheduleConfigSave(config: AppConfig): void {
  configSaveScheduler.schedule(config);
}

export function flushScheduledConfigSave(): Promise<void> {
  return configSaveScheduler.flush();
}

export function cancelScheduledConfigSave(): void {
  configSaveScheduler.cancel();
}

export async function saveConfigImmediately(config: AppConfig): Promise<void> {
  cancelScheduledConfigSave();
  await measurePerfAsync("persist.config.save", () => saveConfig(config));
}
