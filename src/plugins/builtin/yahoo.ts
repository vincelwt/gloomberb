import type { GloomPlugin } from "../../types/plugin";
import { YahooFinanceClient } from "../../sources/yahoo-finance";

class YahooPluginProvider extends YahooFinanceClient {
  readonly priority = 1000;
}

export function createYahooProvider() {
  return new YahooPluginProvider();
}

export const yahooPlugin: GloomPlugin = {
  id: "yahoo",
  name: "Yahoo Fallback",
  version: "1.0.0",
  description: "Built-in delayed fallback for quotes, fundamentals, charts, and unsupported cloud data.",
  dataProvider: createYahooProvider(),
};
