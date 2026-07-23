import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "../../../renderers/opentui/test-utils";
import { AppContext, createInitialState } from "../../../state/app/context";
import { createDefaultConfig } from "../../../types/config";
import type { ChartSpec } from "../../../time-series/types";
import { buildPriceChartPreset } from "./presets";
import { ChartSeriesQuickAdd } from "./quick-add";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

async function emitKey(name: string, sequence: string) {
  await act(async () => {
    (testSetup!.renderer as any).keyInput.emit("keypress", {
      name,
      sequence,
      ctrl: false,
      meta: false,
      super: false,
      option: false,
      shift: false,
      eventType: "press",
      repeated: false,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.propagationStopped = true;
      },
    });
    await testSetup!.renderOnce();
  });
}

async function waitForFrameToContain(text: string, attempts = 12): Promise<string> {
  let frame = "";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await act(async () => {
      await Bun.sleep(10);
      await testSetup!.renderOnce();
    });
    frame = testSetup!.captureCharFrame();
    if (frame.includes(text)) return frame;
  }
  return frame;
}

async function waitForFrameToExclude(text: string, attempts = 12): Promise<string> {
  let frame = testSetup!.captureCharFrame();
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!frame.includes(text)) return frame;
    await act(async () => {
      await Bun.sleep(10);
      await testSetup!.renderOnce();
    });
    frame = testSetup!.captureCharFrame();
  }
  return frame;
}

afterEach(async () => {
  if (!testSetup) return;
  await act(async () => {
    testSetup!.renderer.destroy();
  });
  testSetup = undefined;
});

describe("chart series inline quick add", () => {
  test("stays visible and adds a smart ticker-metric suggestion", async () => {
    const initial = createInitialState(createDefaultConfig("/tmp/gloomberb-chart-quick-add"));
    const startingSpec = buildPriceChartPreset("AAPL");
    let updatedSpec: ChartSpec | undefined;
    let renderedWidth = 0;

    testSetup = await testRender(
      <AppContext.Provider value={{ state: initial, dispatch: () => {} }}>
        <ChartSeriesQuickAdd
          spec={startingSpec}
          setSpec={(next) => {
            updatedSpec = next;
          }}
          focused
          width={92}
          height={8}
          shortcutEnabled
          shortcutBlocked={false}
          onActivatePane={() => {}}
          onWidthChange={(width) => {
            renderedWidth = width;
          }}
        />
      </AppContext.Provider>,
      { width: 92, height: 8 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
    });
    expect(testSetup.captureCharFrame()).toContain("add series");
    expect(renderedWidth).toBe(14);

    await emitKey("n", "n");
    await act(async () => {
      await testSetup!.mockInput.typeText("MSFT revenue");
      await testSetup!.renderOnce();
    });
    expect(await waitForFrameToContain("MSFT · Revenue")).toContain("MSFT · Revenue");
    expect(renderedWidth).toBe(36);

    await act(async () => {
      await testSetup!.mockMouse.click(2, 1);
      await testSetup!.renderOnce();
    });
    expect(updatedSpec?.series).toHaveLength(2);
    expect(updatedSpec?.series[1]?.source).toMatchObject({
      kind: "security",
      instrument: { symbol: "MSFT" },
      fieldId: "fundamental.totalRevenue",
    });

    const closedFrame = await waitForFrameToExclude("MSFT · Revenue");
    expect(closedFrame).toContain("add series");
    expect(closedFrame).not.toContain("MSFT · Revenue");
    expect(renderedWidth).toBe(14);
  });
});
