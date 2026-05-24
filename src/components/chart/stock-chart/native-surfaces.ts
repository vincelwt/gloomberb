import { useCallback, useMemo, type RefObject } from "react";
import type { BoxRenderable, NativeRendererHost as CliRenderer } from "../../../ui";
import type { ChartScene, ResolvedChartPalette } from "../core/renderer";
import type { ProjectedChartPoint } from "../core/data";
import type { ChartRenderMode, ResolvedChartRenderer } from "../core/types";
import {
  renderNativeChartBase,
  type NativeCrosshairOverlay,
} from "../native/chart-rasterizer";
import { useNativeChartSurfaces } from "../native/surface/rendering";
import { getNativeSurfaceManager } from "../native/surface/manager";
import { buildNativeBitmapKey } from "./bitmaps";

interface UseStockChartNativeSurfacesOptions {
  chartColors: Pick<
    ResolvedChartPalette,
    | "candleDown"
    | "candleUp"
    | "fillColor"
    | "gridColor"
    | "lineColor"
    | "postMarketBgColor"
    | "preMarketBgColor"
    | "volumeDown"
    | "volumeUp"
  >;
  compact: boolean | undefined;
  effectiveRenderer: ResolvedChartRenderer;
  indicatorRenderKey: string;
  marketSessionKey: string;
  nativeBaseScene: ChartScene | null;
  nativeCrosshair: NativeCrosshairOverlay | null;
  paneId: string;
  plotRef: RefObject<BoxRenderable | null>;
  projectionMode: ChartRenderMode;
  projectionPoints: ProjectedChartPoint[];
  renderer: CliRenderer;
  rendererNativeReady: boolean;
  showVolume: boolean;
}

export function useStockChartNativeSurfaces({
  chartColors,
  compact,
  effectiveRenderer,
  indicatorRenderKey,
  marketSessionKey,
  nativeBaseScene,
  nativeCrosshair,
  paneId,
  plotRef,
  projectionMode,
  projectionPoints,
  renderer,
  rendererNativeReady,
  showVolume,
}: UseStockChartNativeSurfacesOptions) {
  const nativeSurfaceManager = useMemo(() => getNativeSurfaceManager(renderer), [renderer]);
  const nativeSurfaceScope = compact ? "compact" : "full";
  const nativeBaseSurfaceId = useMemo(
    () => `chart-surface:${paneId}:${nativeSurfaceScope}:base`,
    [nativeSurfaceScope, paneId],
  );
  const nativeCrosshairSurfaceId = useMemo(
    () => `chart-surface:${paneId}:${nativeSurfaceScope}:crosshair`,
    [nativeSurfaceScope, paneId],
  );

  const buildBaseBitmapKey = useCallback((bitmapSize: { pixelWidth: number; pixelHeight: number }) => buildNativeBitmapKey(
    projectionPoints.length,
    projectionPoints,
    bitmapSize.pixelWidth,
    bitmapSize.pixelHeight,
    projectionMode,
    showVolume,
    [
      chartColors.lineColor,
      chartColors.fillColor,
      chartColors.gridColor,
      chartColors.volumeUp,
      chartColors.volumeDown,
      chartColors.candleUp,
      chartColors.candleDown,
      chartColors.preMarketBgColor,
      chartColors.postMarketBgColor,
    ].join(","),
    indicatorRenderKey,
    marketSessionKey,
  ), [
    chartColors.candleDown,
    chartColors.candleUp,
    chartColors.fillColor,
    chartColors.gridColor,
    chartColors.lineColor,
    chartColors.postMarketBgColor,
    chartColors.preMarketBgColor,
    chartColors.volumeDown,
    chartColors.volumeUp,
    indicatorRenderKey,
    marketSessionKey,
    projectionMode,
    projectionPoints,
    showVolume,
  ]);

  useNativeChartSurfaces({
    baseScene: nativeBaseScene,
    baseSurfaceId: nativeBaseSurfaceId,
    buildBaseBitmapKey,
    crosshair: nativeCrosshair,
    crosshairSurfaceId: nativeCrosshairSurfaceId,
    effectiveRenderer,
    nativeReady: rendererNativeReady,
    nativeSurfaceManager,
    paneId,
    plotRef,
    renderBase: renderNativeChartBase,
    renderer,
    requestBaseRender: "always",
  });
}
