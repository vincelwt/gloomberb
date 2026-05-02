import type { AppConfig } from "../types/config";
import { AppPersistence } from "../data/app-persistence";
import { TickerRepository } from "../data/ticker-repository";
import { AssetDataRouter } from "../sources/provider-router";

export type ConfigContext = {
  config: AppConfig;
  persistence: AppPersistence;
  store: TickerRepository;
  dataDir: string;
};

export type MarketContext = ConfigContext & {
  dataProvider: AssetDataRouter;
};
