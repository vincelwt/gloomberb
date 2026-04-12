import type { AppConfig } from "../../types/config";

export const FRED_API_KEY_CONFIG_PLUGIN_ID = "econ-calendar";
export const FRED_API_KEY_CONFIG_KEY = "fredApiKey";
export const FRED_API_KEY_COMMAND_LABEL = "Set FRED API Key";

export function getSharedFredApiKey(config: Pick<AppConfig, "pluginConfig">): string {
  const value = config.pluginConfig?.[FRED_API_KEY_CONFIG_PLUGIN_ID]?.[FRED_API_KEY_CONFIG_KEY];
  return typeof value === "string" ? value.trim() : "";
}
