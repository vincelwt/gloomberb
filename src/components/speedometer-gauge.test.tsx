import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "../renderers/opentui/test-utils";
import { colors } from "../theme/colors";
import { SpeedometerGauge, type SpeedometerSegment } from "./speedometer-gauge";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(async () => {
  if (!testSetup) return;
  await act(async () => {
    testSetup!.renderer.destroy();
  });
  testSetup = undefined;
});

const segments: SpeedometerSegment[] = [
  { from: 0, to: 24.999, label: "EXTREME FEAR", color: colors.negative },
  { from: 25, to: 44.999, label: "FEAR", color: colors.warning },
  { from: 45, to: 55, label: "NEUTRAL", color: colors.neutral },
  { from: 55.001, to: 75, label: "GREED", color: colors.positive },
  { from: 75.001, to: 100, label: "EXTREME GREED", color: colors.positive },
];

describe("SpeedometerGauge", () => {
  test("keeps the terminal fallback compact in wide panes", async () => {
    testSetup = await testRender(
      <SpeedometerGauge value={67} valueLabel="GREED" width={120} segments={segments} />,
      { width: 124, height: 14 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Current reading GREED");
    expect(frame).toContain("67");

    const labelLine = frame.split("\n").find((line) => line.includes("EXT FEAR") && line.includes("EXT GREED"));
    expect(labelLine).toBeTruthy();
    expect(labelLine!.indexOf("EXT GREED") - labelLine!.indexOf("EXT FEAR")).toBeLessThanOrEqual(58);
  });
});
