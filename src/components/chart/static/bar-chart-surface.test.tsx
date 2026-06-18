import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { Text } from "../../../ui";
import { testRender } from "../../../renderers/opentui/test-utils";
import { StaticBarChartSurface } from "./bar-chart-surface";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(async () => {
  if (!testSetup) return;
  await act(async () => {
    testSetup!.renderer.destroy();
  });
  testSetup = undefined;
});

describe("StaticBarChartSurface", () => {
  test("shows hover feedback without shifting chart rows", async () => {
    testSetup = await testRender(
      <StaticBarChartSurface
        width={64}
        height={12}
        title="Operating Cash Flow (quarterly)"
        formatValue={(value) => `${Math.round(value / 1000)}k`}
        series={[{
          id: "value",
          label: "Value",
          color: "#00ff66",
          points: [
            { category: "2025 Q1", value: -271000 },
            { category: "2025 Q2", value: -138000 },
            { category: "2025 Q3", value: 653000 },
          ],
        }]}
      />,
      { width: 66, height: 14 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const initialFrame = testSetup.captureCharFrame();
    const initialLines = initialFrame.split("\n");
    const initialAxisRow = initialLines.findIndex((line) => line.includes("2025 Q1") && line.includes("2025 Q2"));

    await act(async () => {
      await testSetup!.mockMouse.moveTo(14, 4);
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const hoverFrame = testSetup.captureCharFrame();
    const hoverLines = hoverFrame.split("\n");
    const hoverAxisRow = hoverLines.findIndex((line) => line.includes("2025 Q1") && line.includes("2025 Q2"));

    expect(hoverFrame).toContain("2025 Q1: -271k");
    expect(hoverFrame).toContain("▓");
    expect(hoverLines).toHaveLength(initialLines.length);
    expect(hoverAxisRow).toBe(initialAxisRow);
  });

  test("shows a hover readout when a custom header is rendered", async () => {
    testSetup = await testRender(
      <StaticBarChartSurface
        width={64}
        height={12}
        header={<Text>Revenue  Gross Profit</Text>}
        formatValue={(value) => `${Math.round(value / 1000)}k`}
        series={[{
          id: "value",
          label: "Value",
          color: "#00ff66",
          points: [
            { category: "2025 Q1", value: -271000 },
            { category: "2025 Q2", value: -138000 },
            { category: "2025 Q3", value: 653000 },
          ],
        }]}
      />,
      { width: 66, height: 14 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
      await testSetup!.mockMouse.moveTo(14, 4);
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Revenue  Gross Profit");
    expect(frame).toContain("2025 Q1: -271k");
  });
});
