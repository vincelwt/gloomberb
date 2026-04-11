import { describe, expect, test } from "bun:test";
import { correlationPlugin } from "./index";

describe("correlationPlugin", () => {
  test("creates a configured pane from CMP-style ticker-list options", async () => {
    const template = correlationPlugin.paneTemplates?.find((entry) => entry.id === "correlation-pane");
    const instance = await template?.createInstance?.({} as any, { symbols: ["AAPL", "MSFT", "NVDA"] });

    expect(instance).toMatchObject({
      title: "AAPL · MSFT · NVDA 1Y",
      placement: "floating",
      settings: {
        rangePreset: "1Y",
        symbols: ["AAPL", "MSFT", "NVDA"],
        symbolsText: "AAPL, MSFT, NVDA",
      },
    });
  });

  test("uses the default CORR preset without explicit tickers", async () => {
    const template = correlationPlugin.paneTemplates?.find((entry) => entry.id === "correlation-pane");
    const instance = await template?.createInstance?.({} as any, undefined);

    expect(instance).toMatchObject({
      title: "AAPL · MSFT +2 1Y",
      settings: {
        symbols: ["AAPL", "MSFT", "NVDA", "AMD"],
        symbolsText: "AAPL, MSFT, NVDA, AMD",
      },
    });
  });

  test("uses the default CORR preset when the inferred ticker list is too small", async () => {
    const template = correlationPlugin.paneTemplates?.find((entry) => entry.id === "correlation-pane");
    const instance = await template?.createInstance?.({} as any, { symbols: ["AAPL"] });

    expect(instance).toMatchObject({
      title: "AAPL · MSFT +2 1Y",
      settings: {
        symbols: ["AAPL", "MSFT", "NVDA", "AMD"],
      },
    });
  });
});
