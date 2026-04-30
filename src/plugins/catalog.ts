import type { GloomPlugin } from "../types/plugin";
import type { LoadedExternalPlugin } from "./loader";
import { debugPlugin } from "./builtin/debug";
import { yahooPlugin } from "./builtin/yahoo";
import { uiBuiltinPlugins } from "./catalog-ui";

export interface PluginCatalogEntry {
  plugin: GloomPlugin;
  source: "builtin" | "external";
  path?: string;
  error?: string;
}

export const builtinPlugins: GloomPlugin[] = [
  yahooPlugin,
  ...uiBuiltinPlugins,
  debugPlugin,
];

export function getPluginCatalog(externalPlugins: LoadedExternalPlugin[] = []): PluginCatalogEntry[] {
  return [
    ...builtinPlugins.map((plugin) => ({
      plugin,
      source: "builtin" as const,
    })),
    ...externalPlugins.map((entry) => ({
      plugin: entry.plugin,
      source: "external" as const,
      path: entry.path,
      error: entry.error,
    })),
  ];
}

export function getLoadablePlugins(externalPlugins: LoadedExternalPlugin[] = []): GloomPlugin[] {
  return getPluginCatalog(externalPlugins)
    .filter((entry) => !entry.error)
    .map((entry) => entry.plugin);
}
