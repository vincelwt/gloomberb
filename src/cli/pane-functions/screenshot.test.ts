import { describe, expect, test } from "bun:test";
import type { RemoteUiNodeSnapshot } from "../../remote/types";
import {
  chartEvidenceMismatchesFor,
  missingActiveTabSelections,
  type PaneScreenshotExpectedChartEvidence,
  type PaneScreenshotExpectedSelection,
} from "./screenshot";

describe("pane screenshot active-state verification", () => {
  const expected: PaneScreenshotExpectedSelection[] = [
    { control: "statement", label: "Cash Flow" },
    { control: "period", value: "annual" },
  ];

  test("accepts selections confirmed by the rendered semantic tab state", () => {
    expect(missingActiveTabSelections(renderedTabs("1", "annual"), expected)).toEqual([]);
  });

  test("rejects labels that are visible but not active", () => {
    expect(missingActiveTabSelections(renderedTabs("0", "quarterly"), expected))
      .toEqual(expected);
  });
});

describe("pane screenshot chart-data verification", () => {
  const expected: PaneScreenshotExpectedChartEvidence = {
    kind: "price-comparison",
    symbols: ["AAPL", "NVDA"],
    rangePreset: "1Y",
    axisMode: "percent",
    resolution: "1d",
    sourceSeries: [
      {
        symbol: "AAPL",
        pointCount: 2,
        first: { date: "2025-07-17T00:00:00.000Z", close: 100 },
        last: { date: "2026-07-18T00:00:00.000Z", close: 150 },
        projectionBaseValue: 110,
        projectionLatestRawValue: 150,
        projectionLatestValue: 36.36363636363637,
      },
      {
        symbol: "NVDA",
        pointCount: 2,
        first: { date: "2025-07-17T00:00:00.000Z", close: 200 },
        last: { date: "2026-07-18T00:00:00.000Z", close: 220 },
        projectionBaseValue: 205,
        projectionLatestRawValue: 220,
        projectionLatestValue: 7.317073170731708,
      },
    ],
  };

  test("accepts exact rendered comparison inputs and projection values", () => {
    expect(chartEvidenceMismatchesFor(renderedComparisonChart(), expected)).toEqual([]);
  });

  test("rejects a wrong range or rendered value even when symbols are visible", () => {
    const nodes = renderedComparisonChart();
    nodes[0]!.metadata!.rangePreset = "3M";
    (nodes[0]!.metadata!.projectionSeries as Array<Record<string, unknown>>)[0]!.latestRawValue = 149;
    expect(chartEvidenceMismatchesFor(nodes, expected)).toEqual([
      "rendered chart range does not match",
      "AAPL comparison latest value does not match",
    ]);
  });
});

function renderedTabs(statement: string, period: string): RemoteUiNodeSnapshot[] {
  return [
    {
      id: "statements",
      role: "tabs",
      actions: [],
      metadata: {
        activeValue: statement,
        tabs: [
          { label: "Income", value: "0" },
          { label: "Cash Flow", value: "1" },
          { label: "Balance Sheet", value: "2" },
        ],
      },
    },
    {
      id: "period",
      role: "tabs",
      actions: [],
      metadata: {
        activeValue: period,
        tabs: [
          { label: "Annual", value: "annual" },
          { label: "Quarterly", value: "quarterly" },
        ],
      },
    },
  ];
}

function renderedComparisonChart(): RemoteUiNodeSnapshot[] {
  return [{
    id: "comparison-chart-data",
    role: "chart-data",
    actions: [],
    metadata: {
      kind: "price-comparison",
      symbols: ["AAPL", "NVDA"],
      rangePreset: "1Y",
      selectedResolution: "1d",
      effectiveResolution: "1d",
      requestedAxisMode: "percent",
      effectiveAxisMode: "percent",
      sourceSeries: [
        {
          symbol: "AAPL",
          pointCount: 2,
          first: { date: "2025-07-17T00:00:00.000Z", close: 100 },
          last: { date: "2026-07-18T00:00:00.000Z", close: 150 },
        },
        {
          symbol: "NVDA",
          pointCount: 2,
          first: { date: "2025-07-17T00:00:00.000Z", close: 200 },
          last: { date: "2026-07-18T00:00:00.000Z", close: 220 },
        },
      ],
      projectedPointCount: 2,
      projectionSeries: [
        {
          symbol: "AAPL",
          baseValue: 110,
          latestRawValue: 150,
          latestValue: 36.36363636363637,
          pointCount: 2,
        },
        {
          symbol: "NVDA",
          baseValue: 205,
          latestRawValue: 220,
          latestValue: 7.317073170731708,
          pointCount: 2,
        },
      ],
    },
  }];
}
