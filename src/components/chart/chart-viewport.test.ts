import { describe, expect, test } from "bun:test";
import { RIGHT_EDGE_ANCHOR_RATIO, resolveAnchoredChartZoom } from "./chart-viewport";

describe("resolveAnchoredChartZoom", () => {
  test("keeps keyboard zoom pinned to the latest data when anchored to the right edge", () => {
    expect(resolveAnchoredChartZoom(252, 1, 0, 2, RIGHT_EDGE_ANCHOR_RATIO)).toEqual({
      zoomLevel: 2,
      panOffset: 0,
    });
  });

  test("preserves the current right edge when zooming a panned view", () => {
    expect(resolveAnchoredChartZoom(252, 2, 20, 3, RIGHT_EDGE_ANCHOR_RATIO)).toEqual({
      zoomLevel: 3,
      panOffset: 20,
    });
  });

  test("still supports center-anchored zoom for pointer-driven interactions", () => {
    expect(resolveAnchoredChartZoom(252, 1, 0, 2, 0.5)).toEqual({
      zoomLevel: 2,
      panOffset: 63,
    });
  });
});
