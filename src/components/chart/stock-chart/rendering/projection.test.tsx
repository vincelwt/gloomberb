import { afterEach, describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { act, useState, type Dispatch, type SetStateAction } from "react";
import { createOpenTuiTestRoot as createRoot } from "../../../../renderers/opentui/test-utils";
import type { PricePoint } from "../../../../types/financials";
import { Box } from "../../../../ui";
import { resolveStableOhlcProjectionOptions } from "../../core/data";
import type { DateWindowRange } from "../../core/controller";
import { useStockChartProjectionModel } from "./projection";

let testSetup: Awaited<ReturnType<typeof createTestRenderer>> | undefined;
let root: ReturnType<typeof createRoot> | undefined;
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

afterEach(async () => {
  if (root) {
    await act(async () => {
      root!.unmount();
      await Promise.resolve();
    });
    root = undefined;
  }
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
});

function makeDailyHistory(length: number): PricePoint[] {
  return Array.from({ length }, (_, index) => ({
    date: new Date(Date.UTC(2026, 0, 1 + index)),
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100 + index,
    volume: 1_000 + index,
  }));
}

describe("useStockChartProjectionModel", () => {
  test("keeps indicator overlays available immediately when the visible window changes", async () => {
    const history = makeDailyHistory(120);
    const firstWindow = {
      start: history[20]!.date,
      end: history[90]!.date,
    };
    const secondWindow = {
      start: history[25]!.date,
      end: history[95]!.date,
    };
    let setDisplayedWindow: Dispatch<SetStateAction<DateWindowRange>> | null = null;
    let latestIndicatorPointCount: number | null = null;
    let latestWindowStartIdx: number | null = null;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

    function Harness() {
      const [displayedDateWindow, setDisplayedDateWindow] = useState<DateWindowRange>(firstWindow);
      setDisplayedWindow = setDisplayedDateWindow;
      const model = useStockChartProjectionModel({
        chartWidth: 32,
        displayedDateWindow,
        hasIndicators: true,
        history,
        indicatorConfig: { sma: [20] },
        renderMode: "area",
        resolveOhlcProjectionOptions: (pointCount, sourceIndexOffset) => resolveStableOhlcProjectionOptions({
          pointCount,
          sourceIndexOffset,
          bucketWidth: 32,
        }),
      });
      latestIndicatorPointCount = model.indicators?.smaLines[0]?.points.length ?? null;
      latestWindowStartIdx = model.chartWindow.startIdx;
      return <Box width={1} height={1} />;
    }

    testSetup = await createTestRenderer({ width: 8, height: 4 });
    root = createRoot(testSetup.renderer);
    act(() => {
      root!.render(<Harness />);
    });
    await act(async () => {
      await testSetup!.renderOnce();
    });

    expect(latestWindowStartIdx).toBe(20);
    expect(latestIndicatorPointCount).toBeGreaterThan(0);

    await act(async () => {
      setDisplayedWindow!(secondWindow);
      await Promise.resolve();
      await testSetup!.renderOnce();
    });

    expect(latestWindowStartIdx).toBe(25);
    expect(latestIndicatorPointCount).toBeGreaterThan(0);
  });
});
