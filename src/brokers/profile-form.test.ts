import { describe, expect, test } from "bun:test";
import type { BrokerAdapter } from "../types/broker";
import type { BrokerInstanceConfig } from "../types/config";
import { ibkrBroker } from "../plugins/ibkr/broker-adapter";
import {
  buildBrokerProfileConfig,
  createBrokerProfileDraft,
  validateBrokerProfileValues,
} from "./profile-form";

function createFlexInstance(): BrokerInstanceConfig {
  return {
    id: "ibkr-flex",
    brokerType: "ibkr",
    label: "IBKR Flex",
    connectionMode: "flex",
    config: {
      connectionMode: "flex",
      gatewaySetupMode: "auto",
      flex: { token: "saved-token", queryId: "123", endpoint: "https://example.test/flex" },
      gateway: { host: "127.0.0.1", marketDataType: "auto" },
    },
    enabled: true,
  };
}

describe("broker profile form helpers", () => {
  test("builds canonical IBKR Flex config from flat values", () => {
    const config = buildBrokerProfileConfig(ibkrBroker, {
      connectionMode: "flex",
      token: "token",
      queryId: "456",
      endpoint: "",
      gatewaySetupMode: "auto",
    });

    expect(config).toMatchObject({
      connectionMode: "flex",
      flex: { token: "token", queryId: "456" },
    });
  });

  test("preserves saved password fields when editing leaves them blank", () => {
    const previous = createFlexInstance();
    const draft = createBrokerProfileDraft(ibkrBroker, previous);
    draft.values.token = "";

    expect(validateBrokerProfileValues(ibkrBroker, draft.values, previous)).toBeNull();
    expect(buildBrokerProfileConfig(ibkrBroker, draft.values, previous)).toMatchObject({
      flex: { token: "saved-token" },
    });
  });

  test("requires password fields for new profiles", () => {
    expect(validateBrokerProfileValues(ibkrBroker, {
      connectionMode: "flex",
      token: "",
      queryId: "123",
    })).toBe("Flex Token is required.");
  });

  test("falls back to raw values for generic brokers", () => {
    const adapter: BrokerAdapter = {
      id: "demo",
      name: "Demo",
      configSchema: [{ key: "apiKey", label: "API Key", type: "password", required: true }],
      validate: async () => true,
      importPositions: async () => [],
    };

    expect(buildBrokerProfileConfig(adapter, { apiKey: "secret" })).toEqual({ apiKey: "secret" });
  });
});
