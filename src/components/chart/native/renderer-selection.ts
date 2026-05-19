import { useEffect, useMemo, useState } from "react";
import { type PixelResolution } from "../../../ui";
import { type NativeRendererHost as CliRenderer } from "../../../ui";
import type { ChartRendererPreference, ResolvedChartRenderer } from "../chart-types";
import { ensureKittySupport, getCachedKittySupport } from "./kitty-support";

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

interface NativeChartRendererSnapshot {
  kittySupport: boolean | null;
  resolution: PixelResolution | null;
}

function readNativeChartRendererSnapshot(renderer: CliRenderer): NativeChartRendererSnapshot {
  return {
    kittySupport: getCachedKittySupport(renderer),
    resolution: renderer.resolution,
  };
}

function sameResolution(left: PixelResolution | null, right: PixelResolution | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.width === right.width && left.height === right.height;
}

function sameSnapshot(left: NativeChartRendererSnapshot, right: NativeChartRendererSnapshot): boolean {
  return left.kittySupport === right.kittySupport
    && sameResolution(left.resolution, right.resolution);
}

function shouldQueryKittySupport(
  preference: ChartRendererPreference,
  renderer: CliRenderer,
  snapshot: NativeChartRendererSnapshot,
): boolean {
  return !renderer.isDestroyed && preference !== "braille" && snapshot.kittySupport === null;
}

export function useResolvedChartRendererState(
  preference: ChartRendererPreference,
  renderer: CliRenderer,
): ResolvedChartRendererState {
  const [snapshot, setSnapshot] = useState<NativeChartRendererSnapshot>(() => (
    readNativeChartRendererSnapshot(renderer)
  ));

  useEffect(() => {
    let cancelled = false;
    const commitSnapshot = (next: NativeChartRendererSnapshot) => {
      if (cancelled) return;
      setSnapshot((current) => (sameSnapshot(current, next) ? current : next));
    };

    const refreshReadiness = () => {
      const next = readNativeChartRendererSnapshot(renderer);
      commitSnapshot(next);
    };

    renderer.on("capabilities", refreshReadiness);
    renderer.on("resolution", refreshReadiness);
    renderer.on("resize", refreshReadiness);
    refreshReadiness();

    if (shouldQueryKittySupport(preference, renderer, readNativeChartRendererSnapshot(renderer))) {
      ensureKittySupport(renderer).then(() => {
        refreshReadiness();
      }).catch(() => {
        refreshReadiness();
      });
    }

    return () => {
      cancelled = true;
      renderer.off("capabilities", refreshReadiness);
      renderer.off("resolution", refreshReadiness);
      renderer.off("resize", refreshReadiness);
    };
  }, [preference, renderer]);

  return useMemo(
    () => resolveChartRendererState(preference, snapshot.kittySupport, snapshot.resolution),
    [preference, snapshot.kittySupport, snapshot.resolution],
  );
}
