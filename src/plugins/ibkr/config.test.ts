import { describe, expect, test } from "bun:test";
import { buildIbkrConfigFromValues, normalizeIbkrConfig } from "./config";

describe("ibkr config helpers", () => {
  test("builds nested manual gateway config from flat wizard values", () => {
    const config = buildIbkrConfigFromValues({
      connectionMode: "gateway",
      gatewaySetupMode: "manual",
      host: "127.0.0.1",
      port: "4002",
    });

    expect(config.connectionMode).toBe("gateway");
    expect(config.gatewaySetupMode).toBe("manual");
    expect(config.gateway).toEqual({
      host: "127.0.0.1",
      port: 4002,
      clientId: undefined,
      lastSuccessfulPort: undefined,
      lastSuccessfulClientId: undefined,
      marketDataType: "auto",
    });
  });

  test("defaults gateway profiles to automatic connection detection", () => {
    const config = buildIbkrConfigFromValues({
      connectionMode: "gateway",
      gatewaySetupMode: "auto",
    });

    expect(config.connectionMode).toBe("gateway");
    expect(config.gatewaySetupMode).toBe("auto");
    expect(config.gateway).toEqual({
      host: "127.0.0.1",
      port: undefined,
      clientId: undefined,
      lastSuccessfulPort: undefined,
      lastSuccessfulClientId: undefined,
      marketDataType: "auto",
    });
  });

  test("treats explicit port/client configs as manual at runtime", () => {
    const config = normalizeIbkrConfig({
      connectionMode: "gateway",
      host: "127.0.0.1",
      port: 4002,
      clientId: 1,
    });

    expect(config.gatewaySetupMode).toBe("manual");
    expect(config.gateway.port).toBe(4002);
    expect(config.gateway.clientId).toBe(1);
  });

  test("normalizes flat flex wizard values", () => {
    const config = normalizeIbkrConfig({
      token: "abc",
      queryId: "123",
    });

    expect(config.connectionMode).toBe("flex");
    expect(config.gatewaySetupMode).toBe("auto");
    expect(config.flex.token).toBe("abc");
    expect(config.flex.queryId).toBe("123");
    expect(config.flex.endpoint).toContain("FlexStatementService.SendRequest");
  });
});
