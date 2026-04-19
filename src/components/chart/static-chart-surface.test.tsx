import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "../../renderers/opentui/test-utils";
import { colors } from "../../theme/colors";
import { resolveChartPalette } from "./chart-renderer";
import { StaticChartSurface } from "./static-chart-surface";
import type { ProjectedChartPoint } from "./chart-data";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(async () => {
  if (!testSetup) return;
  await act(async () => {
    testSetup!.renderer.destroy();
  });
  testSetup = undefined;
});

const points: ProjectedChartPoint[] = [
  { date: new Date("2026-01-01"), open: 3.5, high: 3.5, low: 3.5, close: 3.5, volume: 0 },
  { date: new Date("2026-01-02"), open: 4.1, high: 4.1, low: 4.1, close: 4.1, volume: 0 },
  { date: new Date("2026-01-03"), open: 4.9, high: 4.9, low: 4.9, close: 4.9, volume: 0 },
];

describe("StaticChartSurface", () => {
  test("renders unit and custom y-axis labels", async () => {
    testSetup = await testRender(
      <StaticChartSurface
        points={points}
        width={48}
        height={10}
        mode="line"
        colors={resolveChartPalette(colors, "positive")}
        yAxisLabel="Yield (%)"
        yAxisColor={colors.textDim}
        formatYAxisValue={(value) => `${value.toFixed(2)}%`}
      />,
      { width: 50, height: 12 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Yield (%)");
    expect(frame).toContain("4.90%");
    expect(frame).toContain("3.50%");
  });
});
