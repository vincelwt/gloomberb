import { afterEach, describe, expect, test } from "bun:test";
import { act, useReducer, useState } from "react";
import { testRender } from "@opentui/react/test-utils";
import { DialogProvider } from "@opentui-ui/dialog/react";
import { AppContext, PaneInstanceProvider, appReducer, createInitialState } from "../../../state/app-context";
import { createDefaultConfig } from "../../../types/config";
import type { Quote, TickerFinancials } from "../../../types/financials";
import type { TickerRecord } from "../../../types/ticker";
import { createTestDataProvider } from "../../../test-support/data-provider";
import { PluginRenderProvider, type PluginRuntimeAccess } from "../../plugin-runtime";
import { setSharedDataProviderForTests, setSharedRegistryForTests } from "../../registry";
import { AiScreenerPane } from "./screener-pane";
import { __setDetectedProvidersForTests, type AiProvider } from "./providers";

const PANE_ID = "ai-screener:test";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

function makeRuntime(): PluginRuntimeAccess {
  const resumeState = new Map<string, unknown>();
  const listeners = new Map<string, Set<() => void>>();

  return {
    pinTicker() {},
    navigateTicker() {},
    subscribeResumeState(pluginId, key, listener) {
      const storeKey = `${pluginId}:${key}`;
      if (!listeners.has(storeKey)) listeners.set(storeKey, new Set());
      listeners.get(storeKey)!.add(listener);
      return () => listeners.get(storeKey)?.delete(listener);
    },
    getResumeState(pluginId, key) {
      return (resumeState.get(`${pluginId}:${key}`) as any) ?? null;
    },
    setResumeState(pluginId, key, value) {
      const storeKey = `${pluginId}:${key}`;
      resumeState.set(storeKey, value);
      for (const listener of listeners.get(storeKey) ?? []) listener();
    },
    deleteResumeState(pluginId, key) {
      const storeKey = `${pluginId}:${key}`;
      resumeState.delete(storeKey);
      for (const listener of listeners.get(storeKey) ?? []) listener();
    },
    getConfigState() {
      return null;
    },
    async setConfigState() {},
    async deleteConfigState() {},
    getConfigStateKeys() {
      return [];
    },
  };
}

function makeTicker(symbol: string, name: string): TickerRecord {
  return {
    metadata: {
      ticker: symbol,
      exchange: "NASDAQ",
      currency: "USD",
      name,
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
    },
  };
}

function makeFinancials(symbol: string, price: number, changePercent: number, marketCap: number): TickerFinancials {
  const quote: Quote = {
    symbol,
    price,
    currency: "USD",
    change: price * (changePercent / 100),
    changePercent,
    marketCap,
    lastUpdated: Date.now(),
  };

  return {
    quote,
    annualStatements: [],
    quarterlyStatements: [],
    priceHistory: [],
  };
}

function makePromptAwareProvider(initialOutput: string, rerunOutput: string): AiProvider {
  return {
    id: "shell",
    name: "Shell",
    command: "sh",
    available: true,
    buildArgs: (prompt) => [
      "-c",
      `
prompt="$1"
if printf '%s' "$prompt" | grep -q "These tickers were already found"; then
cat <<'EOF'
${rerunOutput}
EOF
else
cat <<'EOF'
${initialOutput}
EOF
fi
      `,
      "ai-screener-test",
      prompt,
    ],
  };
}

function ScreenerHarness({
  prompt,
  providerId,
}: {
  prompt: string;
  providerId: string;
}) {
  const config = createDefaultConfig("/tmp/gloomberb-ai-screener");
  config.layout.instances.push({
    instanceId: PANE_ID,
    paneId: "ai-screener",
    title: "AI Screener",
    params: {
      prompt,
      providerId,
    },
  });

  const [state, dispatch] = useReducer(appReducer, undefined, () => {
    const initial = createInitialState(config);
    initial.focusedPaneId = PANE_ID;
    initial.tickers = new Map([
      ["AAPL", makeTicker("AAPL", "Apple Inc.")],
      ["MSFT", makeTicker("MSFT", "Microsoft Corp.")],
    ]);
    initial.financials = new Map([
      ["AAPL", makeFinancials("AAPL", 210.12, 1.2, 3_000_000_000_000)],
      ["MSFT", makeFinancials("MSFT", 425.44, 0.8, 3_200_000_000_000)],
    ]);
    return initial;
  });
  const [runtime] = useState(() => makeRuntime());

  return (
    <AppContext value={{ state, dispatch }}>
      <DialogProvider dialogOptions={{ style: { backgroundColor: "#000000", borderColor: "#ffffff", borderStyle: "single" } }}>
        <PaneInstanceProvider paneId={PANE_ID}>
          <PluginRenderProvider pluginId="ai" runtime={runtime}>
            <AiScreenerPane paneId={PANE_ID} paneType="ai-screener" focused width={96} height={18} />
          </PluginRenderProvider>
        </PaneInstanceProvider>
      </DialogProvider>
    </AppContext>
  );
}

async function waitForFrameToContain(text: string, attempts = 30): Promise<string> {
  let lastFrame = "";
  for (let attempt = 0; attempt < attempts; attempt++) {
    await act(async () => {
      await Bun.sleep(50);
      await testSetup!.renderOnce();
    });
    const frame = testSetup!.captureCharFrame();
    lastFrame = frame;
    if (frame.includes(text)) return frame;
  }
  throw new Error(`Timed out waiting for "${text}"\n${lastFrame}`);
}

afterEach(() => {
  __setDetectedProvidersForTests(null);
  setSharedRegistryForTests(undefined);
  setSharedDataProviderForTests(undefined);
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
});

describe("AiScreenerPane", () => {
  test("seeds a screener from pane params and runs it immediately", async () => {
    const provider = makePromptAwareProvider(
      '{"title":"Compounders","summary":"Initial pass","tickers":[{"symbol":"AAPL","exchange":"NASDAQ","reason":"Strong cash flow durability"}]}',
      '{"title":"Compounders","summary":"Second pass","tickers":[{"symbol":"MSFT","exchange":"NASDAQ","reason":"Fresh rerun result"}]}',
    );
    __setDetectedProvidersForTests([provider]);

    const dataProvider = createTestDataProvider();
    setSharedDataProviderForTests(dataProvider);
    setSharedRegistryForTests({
      dataProvider,
      tickerRepository: {
        loadTicker: async () => null,
        createTicker: async (metadata: TickerRecord["metadata"]) => ({ metadata }),
        saveTicker: async () => {},
      },
      events: { emit() {} },
      pinTickerFn() {},
    } as any);

    testSetup = await testRender(<ScreenerHarness prompt="Find quality compounders." providerId="shell" />, {
      width: 96,
      height: 18,
    });

    const frame = await waitForFrameToContain("AAPL");
    expect(frame).toContain("Compounders");
    expect(frame).toContain("Initial pass");
    expect(frame).toContain("1 tickers");
  });

  test("merges new unique results on a normal refresh", async () => {
    const provider = makePromptAwareProvider(
      '{"title":"Compounders","summary":"Initial pass","tickers":[{"symbol":"AAPL","exchange":"NASDAQ","reason":"Strong cash flow durability"}]}',
      '{"title":"Compounders","summary":"Second pass","tickers":[{"symbol":"MSFT","exchange":"NASDAQ","reason":"Fresh rerun result"}]}',
    );
    __setDetectedProvidersForTests([provider]);

    const dataProvider = createTestDataProvider();
    setSharedDataProviderForTests(dataProvider);
    setSharedRegistryForTests({
      dataProvider,
      tickerRepository: {
        loadTicker: async () => null,
        createTicker: async (metadata: TickerRecord["metadata"]) => ({ metadata }),
        saveTicker: async () => {},
      },
      events: { emit() {} },
      pinTickerFn() {},
    } as any);

    testSetup = await testRender(<ScreenerHarness prompt="Find quality compounders." providerId="shell" />, {
      width: 96,
      height: 18,
    });

    await waitForFrameToContain("AAPL");

    await act(async () => {
      testSetup!.mockInput.pressKey("r");
      await testSetup!.renderOnce();
    });

    const frame = await waitForFrameToContain("MSFT");
    expect(frame).toContain("AAPL");
    expect(frame).toContain("2 tickers");
  });

  test("opens the inline prompt editor without using the dialog flow", async () => {
    const provider = makePromptAwareProvider(
      '{"title":"Compounders","summary":"Initial pass","tickers":[{"symbol":"AAPL","exchange":"NASDAQ","reason":"Strong cash flow durability"}]}',
      '{"title":"Compounders","summary":"Second pass","tickers":[{"symbol":"MSFT","exchange":"NASDAQ","reason":"Fresh rerun result"}]}',
    );
    __setDetectedProvidersForTests([provider]);

    const dataProvider = createTestDataProvider();
    setSharedDataProviderForTests(dataProvider);
    setSharedRegistryForTests({
      dataProvider,
      tickerRepository: {
        loadTicker: async () => null,
        createTicker: async (metadata: TickerRecord["metadata"]) => ({ metadata }),
        saveTicker: async () => {},
      },
      events: { emit() {} },
      pinTickerFn() {},
    } as any);

    testSetup = await testRender(<ScreenerHarness prompt="Find quality compounders." providerId="shell" />, {
      width: 96,
      height: 18,
    });

    await waitForFrameToContain("AAPL");

    await act(async () => {
      testSetup!.mockInput.pressKey("e");
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Save");
    expect(frame).toContain("Cancel");
    expect(frame).toContain("Find quality compounders.");
  });

  test("replaces results on a force refresh", async () => {
    const provider = makePromptAwareProvider(
      '{"title":"Compounders","summary":"Initial pass","tickers":[{"symbol":"AAPL","exchange":"NASDAQ","reason":"Strong cash flow durability"}]}',
      '{"title":"Compounders","summary":"Second pass","tickers":[{"symbol":"MSFT","exchange":"NASDAQ","reason":"Fresh rerun result"}]}',
    );
    __setDetectedProvidersForTests([provider]);

    const dataProvider = createTestDataProvider();
    setSharedDataProviderForTests(dataProvider);
    setSharedRegistryForTests({
      dataProvider,
      tickerRepository: {
        loadTicker: async () => null,
        createTicker: async (metadata: TickerRecord["metadata"]) => ({ metadata }),
        saveTicker: async () => {},
      },
      events: { emit() {} },
      pinTickerFn() {},
    } as any);

    testSetup = await testRender(<ScreenerHarness prompt="Find quality compounders." providerId="shell" />, {
      width: 96,
      height: 18,
    });

    await waitForFrameToContain("AAPL");

    await act(async () => {
      testSetup!.mockInput.pressKey("r", { shift: true });
      await testSetup!.renderOnce();
    });

    const frame = await waitForFrameToContain("MSFT");
    expect(frame).not.toContain("AAPL");
    expect(frame).toContain("1 tickers");
  });

  test("keeps the last good results visible when a rerun returns invalid JSON", async () => {
    const provider = makePromptAwareProvider(
      '{"title":"Compounders","summary":"Initial pass","tickers":[{"symbol":"AAPL","exchange":"NASDAQ","reason":"Strong cash flow durability"}]}',
      "not-json",
    );
    __setDetectedProvidersForTests([provider]);

    const dataProvider = createTestDataProvider();
    setSharedDataProviderForTests(dataProvider);
    setSharedRegistryForTests({
      dataProvider,
      tickerRepository: {
        loadTicker: async () => null,
        createTicker: async (metadata: TickerRecord["metadata"]) => ({ metadata }),
        saveTicker: async () => {},
      },
      events: { emit() {} },
      pinTickerFn() {},
    } as any);

    testSetup = await testRender(<ScreenerHarness prompt="Find quality compounders." providerId="shell" />, {
      width: 96,
      height: 18,
    });

    await waitForFrameToContain("AAPL");

    await act(async () => {
      testSetup!.mockInput.pressKey("r");
      await testSetup!.renderOnce();
    });

    const frame = await waitForFrameToContain("invalid");
    expect(frame).toContain("AAPL");
  });

});
