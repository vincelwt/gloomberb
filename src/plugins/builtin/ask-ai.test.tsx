import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { PaneFooterBar, PaneFooterProvider } from "../../components/layout/pane-footer";
import { testRender } from "../../renderers/opentui/test-utils";
import { AppContext, PaneInstanceProvider, createInitialState } from "../../state/app-context";
import { createStatefulTestPluginRuntime } from "../../test-support/plugin-runtime";
import { createDefaultConfig } from "../../types/config";
import { Box } from "../../ui";
import { PluginRenderProvider } from "../plugin-runtime";
import { setSharedMarketDataForTests, setSharedRegistryForTests } from "../registry";
import {
  AskAiDetailTab as AskAiTab,
  __resetAskAiHistoryForTests,
  __setAskAiHistoryForTests,
  __setDetectedProvidersForTests,
  type AiProvider,
} from "./ai/ask-ai-detail-tab";
import type { TickerRecord } from "../../types/ticker";

const PANE_ID = "ticker-detail:main";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

function makeTicker(symbol: string, name = symbol): TickerRecord {
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

function createAskAiHarness(
  width = 60,
  height = 12,
  onCapture: (capturing: boolean) => void = () => {},
) {
  const config = createDefaultConfig("/tmp/gloomberb-ai");
  config.layout.instances = config.layout.instances.map((instance) => (
    instance.instanceId === PANE_ID
      ? { ...instance, binding: { kind: "fixed" as const, symbol: "AAPL" } }
      : instance
  ));

  const state = createInitialState(config);
  state.focusedPaneId = PANE_ID;
  state.tickers = new Map([["AAPL", makeTicker("AAPL", "Apple Inc.")]]);
  state.financials = new Map([["AAPL", {
    annualStatements: [],
    quarterlyStatements: [],
    priceHistory: [],
    quote: {
      symbol: "AAPL",
      price: 210,
      currency: "USD",
      change: 6.3,
      changePercent: 3,
      lastUpdated: Date.now(),
    },
  }]]);

  return (
    <AppContext value={{ state, dispatch: () => {} }}>
      <PaneInstanceProvider paneId={PANE_ID}>
        <PluginRenderProvider pluginId="ai" runtime={createStatefulTestPluginRuntime()}>
          <PaneFooterProvider>
            {(footer) => (
              <Box flexDirection="column" width={width} height={height}>
                <AskAiTab width={width} height={Math.max(1, height - 1)} focused onCapture={onCapture} />
                <PaneFooterBar footer={footer} focused width={width} />
              </Box>
            )}
          </PaneFooterProvider>
        </PluginRenderProvider>
      </PaneInstanceProvider>
    </AppContext>
  );
}

async function flushFrame() {
  await act(async () => {
    await testSetup!.renderOnce();
    await testSetup!.renderOnce();
  });
}

function setProviders(providers: AiProvider[]) {
  __setDetectedProvidersForTests(providers);
}

afterEach(() => {
  __setDetectedProvidersForTests(null);
  __resetAskAiHistoryForTests();
  setSharedRegistryForTests(undefined);
  setSharedMarketDataForTests(undefined);
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
});

describe("AskAiTab", () => {
  test("lists Claude, Gemini, and Codex when no AI CLIs are detected", async () => {
    setProviders([]);

    await act(async () => {
      testSetup = await testRender(
        createAskAiHarness(60, 12),
        { width: 60, height: 12 },
      );
    });

    await flushFrame();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("No AI CLI tools detected.");
    expect(frame).toContain("claude");
    expect(frame).toContain("gemini");
    expect(frame).toContain("codex");
  });

  test("keeps provider metadata and hints readable in a narrow pane", async () => {
    setProviders([
      { id: "claude", name: "Claude", command: "claude", available: true, buildArgs: () => [] },
      { id: "gemini", name: "Gemini", command: "gemini", available: true, buildArgs: () => [] },
    ]);

    await act(async () => {
      testSetup = await testRender(
        createAskAiHarness(46, 12),
        { width: 46, height: 12 },
      );
    });

    await flushFrame();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Provider Claude");
    expect(frame).toContain("[t]provider");
  });

  test("keeps the terminal composer clear of the pane footer", async () => {
    setProviders([
      { id: "claude", name: "Claude", command: "claude", available: true, buildArgs: () => [] },
    ]);

    await act(async () => {
      testSetup = await testRender(
        createAskAiHarness(80, 8),
        { width: 80, height: 8 },
      );
    });

    await flushFrame();

    const lines = testSetup.captureCharFrame().split("\n");
    const inputRow = lines.findIndex((line) => line.includes("Ask a question..."));
    const footerRow = lines.findIndex((line) => line.includes("Provider Claude"));

    expect(inputRow).toBeGreaterThanOrEqual(0);
    expect(footerRow).toBeGreaterThan(inputRow + 1);
    expect(lines[inputRow + 1]?.trim()).toBe("");
  });

  test("focuses the input when the prompt row is clicked", async () => {
    setProviders([
      { id: "claude", name: "Claude", command: "claude", available: true, buildArgs: () => [] },
    ]);

    await act(async () => {
      testSetup = await testRender(createAskAiHarness(60, 12), {
        width: 60,
        height: 12,
      });
    });

    await flushFrame();

    const frameBeforeClick = testSetup.captureCharFrame().split("\n");
    const inputRow = frameBeforeClick.findIndex((line) => line.includes("Ask a question..."));
    const inputCol = frameBeforeClick[inputRow]?.indexOf("Ask a question...") ?? -1;

    expect(inputRow).toBeGreaterThanOrEqual(0);
    expect(inputCol).toBeGreaterThanOrEqual(0);

    let focusedByClick = false;
    for (const row of [inputRow, inputRow + 1]) {
      for (const col of [inputCol + 1, inputCol + 2]) {
        await act(async () => {
          await testSetup!.mockMouse.click(col, row);
          await testSetup!.renderOnce();
          await testSetup!.renderOnce();
        });
        if (testSetup.captureCharFrame().includes("Ask a question...")) {
          focusedByClick = true;
          break;
        }
      }
      if (focusedByClick) break;
    }

    expect(focusedByClick).toBe(true);

    await act(async () => {
      await testSetup!.mockInput.typeText("DCF");
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const frameAfterType = testSetup.captureCharFrame();
    expect(frameAfterType).toContain("> DCF");
  });

  test("renders assistant ticker badges and opens a floating detail pane on click", async () => {
    setProviders([
      { id: "claude", name: "Claude", command: "claude", available: true, buildArgs: () => [] },
    ]);

    const opened: string[] = [];
    setSharedRegistryForTests({
      pinTicker(symbol: string) {
        opened.push(symbol);
      },
    } as any);

    __setAskAiHistoryForTests("AAPL", [
      { role: "assistant", content: "Watch $AAPL here.", loading: false },
    ]);

    await act(async () => {
      testSetup = await testRender(createAskAiHarness(60, 12), {
        width: 60,
        height: 12,
      });
    });

    await flushFrame();

    const lines = testSetup.captureCharFrame().split("\n");
    const row = lines.findIndex((line) => line.includes("AAPL +3%"));
    const col = lines[row]?.indexOf("AAPL +3%") ?? -1;

    expect(row).toBeGreaterThanOrEqual(0);
    expect(col).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(col + 1, row);
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    expect(opened).toEqual(["AAPL"]);
  });
});
