import { describe, expect, test } from "bun:test";
import { buildBarChartScene, renderBarChart, renderNativeBarChart } from "./bar-chart-renderer";

const series = [
  {
    id: "AMD",
    label: "AMD",
    color: "#00ff66",
    points: [
      { category: "2024", value: 10 },
      { category: "2025", value: 15 },
    ],
  },
  {
    id: "NVDA",
    label: "NVDA",
    color: "#4dabf7",
    points: [
      { category: "2024", value: 20 },
      { category: "2025", value: -5 },
    ],
  },
];

describe("bar chart renderer", () => {
  test("builds grouped bars with a zero axis", () => {
    const scene = buildBarChartScene(series, {
      width: 24,
      height: 8,
      colors: { bgColor: "#000000", gridColor: "#333333", axisColor: "#666666" },
    });

    expect(scene).not.toBeNull();
    expect(scene!.categories).toEqual(["2024", "2025"]);
    expect(scene!.bars).toHaveLength(4);
    expect(scene!.zeroRow).toBeGreaterThanOrEqual(0);
  });

  test("renders text fallback and native bitmap output", () => {
    const scene = buildBarChartScene(series, {
      width: 24,
      height: 8,
      colors: { bgColor: "#000000", gridColor: "#333333", axisColor: "#666666" },
    })!;

    expect(renderBarChart(scene).join("\n")).toContain("█");

    const bitmap = renderNativeBarChart(scene, 96, 48);
    expect(bitmap.width).toBe(96);
    expect(bitmap.height).toBe(48);
    expect(bitmap.pixels.some((value) => value > 0)).toBe(true);
  });
});
