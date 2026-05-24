import { useCallback, useMemo, type RefObject } from "react";
import type { BoxRenderable, NativeRendererHost } from "../../../ui";
import type { ComparisonChartProjection } from "../comparison-chart-data";
import type { ComparisonChartScene } from "../comparison-chart-renderer";
import type { ResolvedChartRenderer } from "../chart-types";
import {
  renderNativeComparisonChartBase,
  type NativeCrosshairOverlay,
} from "../native/chart-rasterizer";
import { useNativeChartSurfaces } from "../native/surface-rendering";
import type { NativeSurfaceManager } from "../native/surface-manager";
import { buildComparisonNativeBitmapKey } from "./helpers";
import type { ComparisonChartColors } from "./types";

interface UseComparisonChartNativeSurfacesOptions {
  chartColors: ComparisonChartColors;
  effectiveRenderer: ResolvedChartRenderer;
  marketSessionKey: string;
  nativeCrosshair: NativeCrosshairOverlay | null;
  nativeReady: boolean;
  nativeSurfaceManager: NativeSurfaceManager;
  paneId: string;
  plotRef: RefObject<BoxRenderable | null>;
  projection: ComparisonChartProjection;
  renderer: NativeRendererHost;
  selectedSymbol: string | null;
  staticScene: ComparisonChartScene | null;
  symbolCount: number;
}

function buildChartColorKey(colors: ComparisonChartColors): string {
  return [
    colors.bgColor,
    colors.gridColor,
    colors.crosshairColor,
    colors.preMarketBgColor,
    colors.postMarketBgColor,
  ].join(",");
}

export function useComparisonChartNativeSurfaces({
  chartColors,
  effectiveRenderer,
  marketSessionKey,
  nativeCrosshair,
  nativeReady,
  nativeSurfaceManager,
  paneId,
  plotRef,
  projection,
  renderer,
  selectedSymbol,
  staticScene,
  symbolCount,
}: UseComparisonChartNativeSurfacesOptions) {
  const nativeBaseSurfaceId = useMemo(() => `comparison-chart-surface:${paneId}:base`, [paneId]);
  const nativeCrosshairSurfaceId = useMemo(() => `comparison-chart-surface:${paneId}:crosshair`, [paneId]);

  const buildBaseBitmapKey = useCallback((bitmapSize: { pixelWidth: number; pixelHeight: number }) => buildComparisonNativeBitmapKey(
    symbolCount,
    projection,
    selectedSymbol,
    bitmapSize.pixelWidth,
    bitmapSize.pixelHeight,
    buildChartColorKey(chartColors),
    marketSessionKey,
  ), [
    chartColors,
    marketSessionKey,
    projection,
    selectedSymbol,
    symbolCount,
  ]);

  useNativeChartSurfaces({
    baseScene: staticScene,
    baseSurfaceId: nativeBaseSurfaceId,
    buildBaseBitmapKey,
    crosshair: nativeCrosshair,
    crosshairSurfaceId: nativeCrosshairSurfaceId,
    effectiveRenderer,
    nativeReady,
    nativeSurfaceManager,
    paneId,
    plotRef,
    renderBase: renderNativeComparisonChartBase,
    renderer,
  });
}
