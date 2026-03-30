import type { AppConfig } from "../../types/config";
import type { DataProvider } from "../../types/data-provider";
import { createGloomberbCloudProvider } from "../../sources/gloomberb-cloud";
import { createYahooProvider } from "./yahoo";

export function createBuiltinDataProviders(config?: Pick<AppConfig, "disabledPlugins">): DataProvider[] {
  const disabledPlugins = new Set(config?.disabledPlugins ?? []);
  const providers: DataProvider[] = [];

  if (!disabledPlugins.has("gloomberb-cloud")) {
    providers.push(createGloomberbCloudProvider());
  }

  providers.push(createYahooProvider());
  return providers;
}
