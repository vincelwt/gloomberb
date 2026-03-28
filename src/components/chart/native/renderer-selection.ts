import type { PixelResolution } from "@opentui/core";
import type { ChartRendererPreference, ResolvedChartRenderer } from "../chart-types";

export interface ResolvedChartRendererState {
  renderer: ResolvedChartRenderer;
  nativeUnavailable: boolean;
  nativeReady: boolean;
}

export function resolveChartRendererState(
  preference: ChartRendererPreference,
  kittySupport: boolean | null,
  resolution: PixelResolution | null,
): ResolvedChartRendererState {
  const nativeReady = kittySupport === true && resolution !== null;
  if (preference === "braille") {
    return { renderer: "braille", nativeUnavailable: false, nativeReady };
  }
  if (preference === "kitty") {
    return { renderer: nativeReady ? "kitty" : "braille", nativeUnavailable: !nativeReady && kittySupport !== null, nativeReady };
  }
  return { renderer: nativeReady ? "kitty" : "braille", nativeUnavailable: false, nativeReady };
}

