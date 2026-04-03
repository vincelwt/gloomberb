import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { OnboardingWizard } from "./onboarding-wizard";
import { createDefaultConfig, type AppConfig } from "../../types/config";
import type { BrokerAdapter } from "../../types/broker";
import type { TickerRecord } from "../../types/ticker";
import type { PluginRegistry } from "../../plugins/registry";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;
let tempDataDir: string | null = null;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function createTickerRepository(initial: TickerRecord[] = []) {
  const tickers = new Map(initial.map((ticker) => [ticker.metadata.ticker, ticker] as const));

  return {
    async loadAllTickers() {
      return [...tickers.values()];
    },
    async loadTicker(symbol: string) {
      return tickers.get(symbol) ?? null;
    },
    async saveTicker(ticker: TickerRecord) {
      tickers.set(ticker.metadata.ticker, ticker);
    },
    async createTicker(metadata: TickerRecord["metadata"]) {
      const ticker = { metadata };
      tickers.set(metadata.ticker, ticker);
      return ticker;
    },
    async deleteTicker(symbol: string) {
      tickers.delete(symbol);
    },
  };
}

async function emitKeypress(
  renderer: Awaited<ReturnType<typeof testRender>>,
  event: { name?: string; sequence?: string },
) {
  await act(async () => {
    renderer.renderer.keyInput.emit("keypress", {
      ctrl: false,
      meta: false,
      option: false,
      shift: false,
      eventType: "press",
      repeated: false,
      ...event,
    } as any);
    await renderer.renderOnce();
  });
}

afterEach(async () => {
  if (testSetup) {
    await act(async () => {
      testSetup!.renderer.destroy();
    });
    testSetup = undefined;
  }
  if (tempDataDir) {
    await rm(tempDataDir, { recursive: true, force: true });
    tempDataDir = null;
  }
});

describe("OnboardingWizard", () => {
  test("waits for broker positions to import before completing onboarding", async () => {
    tempDataDir = await mkdtemp(join(tmpdir(), "gloomberb-onboarding-"));
    const importDeferred = createDeferred<any[]>();
    const tickerRepository = createTickerRepository();
    const broker: BrokerAdapter = {
      id: "demo",
      name: "Demo Broker",
      configSchema: [{ key: "host", label: "Host", type: "text", required: true, defaultValue: "paper" }],
      validate: async () => true,
      listAccounts: async () => [{ accountId: "ACC-1", name: "Primary", currency: "USD" }],
      importPositions: async () => importDeferred.promise,
    };
    const pluginRegistry = {
      allPlugins: new Map(),
      brokers: new Map([["demo", broker]]),
      paneTemplates: new Map(),
      getPaneTemplatePluginId: () => undefined,
      tickerRepository,
      persistence: { resources: undefined },
    } as unknown as PluginRegistry;

    let completedConfig: AppConfig | null = null;

    testSetup = await testRender(
      <OnboardingWizard
        config={createDefaultConfig(tempDataDir)}
        pluginRegistry={pluginRegistry}
        onComplete={(nextConfig) => {
          completedConfig = nextConfig;
        }}
      />,
      { width: 90, height: 28 },
    );
    await testSetup.renderOnce();

    await emitKeypress(testSetup, { name: "return", sequence: "\r" });
    await emitKeypress(testSetup, { name: "return", sequence: "\r" });
    await emitKeypress(testSetup, { name: "down", sequence: "\u001b[B" });
    await emitKeypress(testSetup, { name: "return", sequence: "\r" });
    await emitKeypress(testSetup, { name: "return", sequence: "\r" });

    let frame = testSetup.captureCharFrame();
    for (let index = 0; index < 10 && !frame.includes("Connecting to Demo Broker and importing"); index += 1) {
      await act(async () => {
        await Promise.resolve();
        await testSetup!.renderOnce();
      });
      frame = testSetup.captureCharFrame();
    }
    expect(frame).toContain("Connecting to Demo Broker and importing");
    expect(completedConfig).toBeNull();

    importDeferred.resolve([{
      ticker: "AAPL",
      exchange: "NASDAQ",
      shares: 7,
      avgCost: 180,
      currency: "USD",
      accountId: "ACC-1",
      name: "Apple Inc.",
      assetCategory: "STK",
    }]);

    for (let index = 0; index < 20 && !completedConfig; index += 1) {
      await act(async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await testSetup!.renderOnce();
      });
    }

    frame = testSetup.captureCharFrame();
    expect(frame).toContain("Select plugins to enable");

    for (let index = 0; index < 3 && !frame.includes("Imported 1 position"); index += 1) {
      await emitKeypress(testSetup, { name: "return", sequence: "\r" });
      frame = testSetup.captureCharFrame();
    }

    expect(frame).toContain("Imported 1 position");
    expect(completedConfig).toBeNull();

    await emitKeypress(testSetup, { name: "return", sequence: "\r" });

    for (let index = 0; index < 20 && !completedConfig; index += 1) {
      await act(async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await testSetup!.renderOnce();
      });
    }

    expect(completedConfig).not.toBeNull();
    if (!completedConfig) {
      throw new Error("Onboarding did not complete.");
    }
    const finalConfig: AppConfig = completedConfig;
    expect(finalConfig.portfolios.some((portfolio) => portfolio.id === "broker:demo-demo-broker:ACC-1")).toBe(true);
    expect(finalConfig.layout.instances.find((instance) => instance.paneId === "portfolio-list")?.params?.collectionId)
      .toBe("broker:demo-demo-broker:ACC-1");
    expect((await tickerRepository.loadAllTickers()).map((ticker) => ticker.metadata.ticker)).toContain("AAPL");
  });
});
