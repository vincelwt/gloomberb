import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { AppPersistence } from "../data/app-persistence";
import { TickerRepository } from "../data/ticker-repository";
import { createDefaultConfig, type BrokerInstanceConfig } from "../types/config";
import type { AppAction } from "./app-context";
import { initializeAppState } from "./app-bootstrap";

const tempPaths: string[] = [];

function createTempDbPath(name: string): string {
  const path = join(tmpdir(), `gloomberb-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  tempPaths.push(path);
  return path;
}

afterEach(() => {
  for (const path of tempPaths.splice(0)) {
    if (existsSync(path)) rmSync(path, { force: true });
  }
});

describe("initializeAppState", () => {
  test("hydrates persisted broker account snapshots into app state before broker sync", async () => {
    const dbPath = createTempDbPath("app-bootstrap");
    const persistence = new AppPersistence(dbPath);
    const tickerRepository = new TickerRepository(persistence.tickers);
    const brokerInstance: BrokerInstanceConfig = {
      id: "ibkr-live",
      brokerType: "ibkr",
      label: "Interactive Brokers",
      connectionMode: "gateway",
      config: { connectionMode: "gateway", gateway: { host: "127.0.0.1", port: 4002, clientId: 1 } },
      enabled: true,
    };
    const config = {
      ...createDefaultConfig(dbPath),
      brokerInstances: [brokerInstance],
    };

    const actions: AppAction[] = [];

    await initializeAppState({
      config,
      tickerRepository,
      dataProvider: {} as any,
      sessionSnapshot: null,
      dispatch: (action) => { actions.push(action); },
      refreshTicker: () => {},
      autoImportBrokerPositions: async () => {},
      persistedBrokerAccounts: {
        "ibkr-live": [{
          accountId: "DU12345",
          name: "DU12345",
          currency: "USD",
          source: "gateway",
          updatedAt: 1_717_000_000_000,
          totalCashValue: 125000,
        }],
      },
    });

    expect(actions).toContainEqual({
      type: "SET_BROKER_ACCOUNTS",
      instanceId: "ibkr-live",
      accounts: [{
        accountId: "DU12345",
        name: "DU12345",
        currency: "USD",
        source: "gateway",
        updatedAt: 1_717_000_000_000,
        totalCashValue: 125000,
      }],
    });

    const initializedIndex = actions.findIndex((action) => action.type === "SET_INITIALIZED");
    const brokerAccountsIndex = actions.findIndex((action) =>
      action.type === "SET_BROKER_ACCOUNTS" && action.instanceId === "ibkr-live"
    );
    expect(brokerAccountsIndex).toBeGreaterThan(-1);
    expect(initializedIndex).toBeGreaterThan(brokerAccountsIndex);

    persistence.close();
  });
});
