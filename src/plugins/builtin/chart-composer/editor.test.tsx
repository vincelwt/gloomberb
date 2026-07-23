import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "../../../renderers/opentui/test-utils";
import { SeriesEditorDialog } from "./editor";
import { buildPriceChartPreset } from "./presets";

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

afterEach(async () => {
  if (!testSetup) return;
  await act(async () => {
    testSetup!.renderer.destroy();
  });
  testSetup = undefined;
});

describe("chart composer series editor", () => {
  test("focuses its catalog quick-add outside the app-state root", async () => {
    testSetup = await testRender(
      <SeriesEditorDialog
        dialogId="series-editor-test"
        initialSpec={buildPriceChartPreset("AAPL")}
        dismiss={() => {}}
        resolve={() => {}}
      />,
      { width: 92, height: 42 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
    });
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Add a series");
    expect(frame).toContain("AAPL:market.ohlcv");

    await act(async () => {
      await testSetup!.mockInput.typeText("MSFT revenue");
      await testSetup!.renderOnce();
    });

    expect(await waitForFrameToContain("MSFT · Revenue")).toContain("MSFT · Revenue");

    await emitKey("enter", "\r");
    await emitKey("a", "a");
    await act(async () => {
      await Bun.sleep(80);
      await testSetup!.mockInput.typeText("AAPL free cash flow");
      await testSetup!.renderOnce();
    });

    const secondAddFrame = await waitForFrameToContain("AAPL · Free Cash Flow");
    expect(secondAddFrame).toContain("AAPL free cash flow");
    expect(secondAddFrame).toContain("AAPL · Free Cash Flow");
    expect(secondAddFrame).not.toContain("MSFT revenueAAPL");
  });
});
