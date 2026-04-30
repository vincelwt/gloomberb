import { describe, expect, test } from "bun:test";
import type { BrokerAdapter } from "../../../types/broker";
import { createDefaultConfig, type BrokerInstanceConfig } from "../../../types/config";
import { ibkrBroker } from "../../ibkr/broker-adapter";
import { buildBrokerProfileRows, formatBrokerUpdatedAt } from "./model";

function createInstance(patch: Partial<BrokerInstanceConfig> = {}): BrokerInstanceConfig {
  return {
    id: "demo-live",
    brokerType: "demo",
    label: "Demo Live",
    connectionMode: "gateway",
    config: { connectionMode: "gateway" },
    enabled: true,
    ...patch,
  };
}

function createAdapter(state: "connected" | "error" = "connected"): BrokerAdapter {
  return {
    id: "demo",
    name: "Demo Broker",
    configSchema: [],
    validate: async () => true,
    importPositions: async () => [],
    getStatus: () => ({ state, updatedAt: 1_000_000, message: state === "error" ? "No route" : "Ready" }),
  };
}

describe("broker manager rows", () => {
  test("derives live status and account summary", () => {
    const config = {
      ...createDefaultConfig("/tmp/gloomberb-broker-manager"),
      brokerInstances: [createInstance()],
    };
    const rows = buildBrokerProfileRows(
      config,
      new Map([["demo", createAdapter()]]),
      {
        "demo-live": [
          { accountId: "DU1", name: "DU1", currency: "USD", netLiquidation: 100 },
          { accountId: "DU2", name: "DU2", currency: "USD", netLiquidation: 50 },
        ],
      },
    );

    expect(rows[0]).toMatchObject({
      id: "demo-live",
      brokerName: "Demo Broker",
      state: "connected",
      stateLabel: "Connected",
      accountSummary: "$150.00",
    });
  });

  test("handles disabled and unavailable profiles before adapter status", () => {
    const config = {
      ...createDefaultConfig("/tmp/gloomberb-broker-manager"),
      brokerInstances: [
        createInstance({ id: "disabled", enabled: false }),
        createInstance({ id: "missing", brokerType: "missing" }),
      ],
    };
    const rows = buildBrokerProfileRows(config, new Map([["demo", createAdapter("error")]]), {});

    expect(rows.map((row) => row.state)).toEqual(["disabled", "unavailable"]);
  });

  test("labels Flex profiles as sync-only", () => {
    const config = {
      ...createDefaultConfig("/tmp/gloomberb-broker-manager"),
      brokerInstances: [createInstance({ id: "flex", connectionMode: "flex", config: { connectionMode: "flex" } })],
    };
    const rows = buildBrokerProfileRows(config, new Map([["demo", createAdapter()]]), {});

    expect(rows[0]?.mode).toBe("Flex");
    expect(rows[0]?.stateLabel).toBe("Sync only");
  });

  test("keeps real IBKR Flex profiles out of gateway status", () => {
    const config = {
      ...createDefaultConfig("/tmp/gloomberb-broker-manager"),
      brokerInstances: [{
        id: "ibkr-flex",
        brokerType: "ibkr",
        label: "IBKR Flex",
        connectionMode: "flex",
        config: {
          connectionMode: "flex",
          flex: { token: "token", queryId: "123", endpoint: "" },
          gateway: { host: "127.0.0.1" },
        },
        enabled: true,
      }],
    };
    const rows = buildBrokerProfileRows(config, new Map([["ibkr", ibkrBroker]]), {});

    expect(rows[0]?.mode).toBe("Flex");
    expect(rows[0]?.stateLabel).toBe("Sync only");
  });

  test("formats relative status timestamps", () => {
    expect(formatBrokerUpdatedAt(undefined, 10_000)).toBe("never");
    expect(formatBrokerUpdatedAt(9_000, 10_000)).toBe("just now");
    expect(formatBrokerUpdatedAt(10_000 - 5 * 60_000, 10_000)).toBe("5m ago");
  });
});
