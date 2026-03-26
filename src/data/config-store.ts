import { readFile, writeFile, mkdir, rm } from "fs/promises";
import { join, dirname } from "path";
import { existsSync } from "fs";
import type { AppConfig } from "../types/config";
import { createDefaultConfig } from "../types/config";

const GLOBAL_CONFIG_DIR = join(process.env.HOME || "~", ".gloomberb");
const GLOBAL_CONFIG_FILE = join(GLOBAL_CONFIG_DIR, "config.json");

/** Get the data directory from global config, or null if not set */
export async function getDataDir(): Promise<string | null> {
  try {
    const raw = await readFile(GLOBAL_CONFIG_FILE, "utf-8");
    const config = JSON.parse(raw);
    return config.dataDir || null;
  } catch {
    return null;
  }
}

/** Save the data directory to global config */
export async function setDataDir(dataDir: string): Promise<void> {
  await mkdir(GLOBAL_CONFIG_DIR, { recursive: true });
  await writeFile(GLOBAL_CONFIG_FILE, JSON.stringify({ dataDir }, null, 2), "utf-8");
}

/** Load the app config from the data directory */
export async function loadConfig(dataDir: string): Promise<AppConfig> {
  const configPath = join(dataDir, "config.json");
  try {
    const raw = await readFile(configPath, "utf-8");
    const saved = JSON.parse(raw);
    const defaults = createDefaultConfig(dataDir);
    const config = { ...defaults, ...saved, dataDir };
    // Migration: ext_hours is now merged into change_pct
    if (config.columns) {
      config.columns = config.columns.filter((c: { id: string }) => c.id !== "ext_hours");
    }
    return config;
  } catch {
    return createDefaultConfig(dataDir);
  }
}

/** Save the app config to the data directory */
export async function saveConfig(config: AppConfig): Promise<void> {
  const configPath = join(config.dataDir, "config.json");
  await mkdir(dirname(configPath), { recursive: true });
  const { dataDir, ...rest } = config;
  await writeFile(configPath, JSON.stringify(rest, null, 2), "utf-8");
}

/** Ensure the data directory exists and has a config */
export async function initDataDir(dataDir: string): Promise<AppConfig> {
  await mkdir(dataDir, { recursive: true });
  const config = await loadConfig(dataDir);
  await saveConfig(config);
  await setDataDir(dataDir);
  return config;
}

/** Delete all data (data dir contents + global config) and exit so the app restarts fresh */
export async function resetAllData(dataDir: string): Promise<void> {
  // Remove the data directory
  await rm(dataDir, { recursive: true, force: true });
  // Remove the global config so first-run detection triggers
  await rm(GLOBAL_CONFIG_DIR, { recursive: true, force: true });
}

/** Export the full config to a JSON file at the given path */
export async function exportConfig(config: AppConfig, destPath: string): Promise<void> {
  const { dataDir, ...rest } = config;
  await writeFile(destPath, JSON.stringify(rest, null, 2), "utf-8");
}

/** Import config from a JSON file, merging with defaults for the given data dir */
export async function importConfig(dataDir: string, srcPath: string): Promise<AppConfig> {
  const raw = await readFile(srcPath, "utf-8");
  const imported = JSON.parse(raw);
  const defaults = createDefaultConfig(dataDir);
  const config: AppConfig = { ...defaults, ...imported, dataDir };
  await saveConfig(config);
  return config;
}
