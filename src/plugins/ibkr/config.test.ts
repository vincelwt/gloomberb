import { describe, expect, test } from "bun:test";
import { buildIbkrConfigFromValues, normalizeIbkrConfig } from "./config";

describe("ibkr config helpers", () => {
  test("builds nested gateway config from flat wizard values", () => {
    const config = buildIbkrConfigFromValues({
      connectionMode: "gateway",
      host: "127.0.0.1",
      port: "4002",
      clientId: "7",
    });

    expect(config.connectionMode).toBe("gateway");
    expect(config.gateway).toEqual({
      host: "127.0.0.1",
      port: 4002,
      clientId: 7,
      marketDataType: "auto",
    });
  });

  test("normalizes flat flex wizard values", () => {
    const config = normalizeIbkrConfig({
      token: "abc",
      queryId: "123",
    });

    expect(config.connectionMode).toBe("flex");
    expect(config.flex.token).toBe("abc");
    expect(config.flex.queryId).toBe("123");
    expect(config.flex.endpoint).toContain("FlexStatementService.SendRequest");
  });
});
