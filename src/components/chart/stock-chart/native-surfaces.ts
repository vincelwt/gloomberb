import { useEffect, useMemo, useRef, type RefObject } from "react";
import type { BoxRenderable, NativeRendererHost as CliRenderer } from "../../../ui";
import type { ChartScene, ResolvedChartPalette } from "../chart-renderer";
import type { ProjectedChartPoint } from "../chart-data";
import type { ChartRenderMode, ResolvedChartRenderer } from "../chart-types";
import {
  computeBitmapSize,
  renderNativeChartBase,
  renderNativeCrosshairOverlay,
  type NativeCrosshairOverlay,
} from "../native/chart-rasterizer";
import {
  useNativeChartSurfaceLifecycle,
  type NativeChartSurfaceCache,
} from "../native/surface-hooks";
import { getNativeSurfaceManager } from "../native/surface-manager";
import {
  getRenderableCellRect,
  resolveNativeSurfaceVisibleRect,
  type NativeSurfaceRenderableNode,
} from "../native/surface-visibility";
import {
  buildNativeBitmapKey,
  buildNativeCrosshairBitmapKey,
} from "./bitmaps";
import { getRenderablePixelSize, scaleLocalPixelCoordinate } from "../chart-pointer";

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
  const lastNativeBaseBitmapRef = useRef<NativeChartSurfaceCache | null>(null);
  const lastNativeCrosshairBitmapRef = useRef<NativeChartSurfaceCache | null>(null);

  useNativeChartSurfaceLifecycle({
    baseBitmapRef: lastNativeBaseBitmapRef,
    baseSurfaceId: nativeBaseSurfaceId,
    crosshairBitmapRef: lastNativeCrosshairBitmapRef,
    crosshairSurfaceId: nativeCrosshairSurfaceId,
    effectiveRenderer,
    nativeReady: rendererNativeReady,
    nativeSurfaceManager,
    paneId,
    plotRef,
    renderer,
  });

  useEffect(() => {
    if (effectiveRenderer !== "kitty" || !rendererNativeReady || !renderer.resolution || !plotRef.current || !nativeBaseScene) {
      lastNativeBaseBitmapRef.current = null;
      nativeSurfaceManager.removeSurface(nativeBaseSurfaceId);
      return;
    }

    const plot = plotRef.current as unknown as NativeSurfaceRenderableNode;
    const plotRect = getRenderableCellRect(plot);
    const visibleRect = resolveNativeSurfaceVisibleRect(plot, renderer.terminalWidth, renderer.terminalHeight);
    const bitmapSize = computeBitmapSize(plotRect, renderer.resolution, renderer.terminalWidth, renderer.terminalHeight);
    const bitmapKey = buildNativeBitmapKey(
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
    );
    const cachedBitmap = lastNativeBaseBitmapRef.current?.key === bitmapKey
      ? lastNativeBaseBitmapRef.current.bitmap
      : null;
    const bitmap = cachedBitmap ?? renderNativeChartBase(nativeBaseScene, bitmapSize.pixelWidth, bitmapSize.pixelHeight);
    if (!cachedBitmap) {
      lastNativeBaseBitmapRef.current = { key: bitmapKey, bitmap };
    }

    if (!visibleRect) {
      nativeSurfaceManager.removeSurface(nativeBaseSurfaceId);
      return;
    }

    nativeSurfaceManager.upsertSurface({
      id: nativeBaseSurfaceId,
      paneId,
      rect: plotRect,
      visibleRect,
      bitmap,
      bitmapKey,
    });
    renderer.requestRender();
  }, [
    chartColors.candleDown,
    chartColors.candleUp,
    chartColors.fillColor,
    chartColors.gridColor,
    chartColors.lineColor,
    chartColors.postMarketBgColor,
    chartColors.preMarketBgColor,
    chartColors.volumeDown,
    chartColors.volumeUp,
    effectiveRenderer,
    indicatorRenderKey,
    marketSessionKey,
    nativeBaseScene,
    nativeBaseSurfaceId,
    nativeSurfaceManager,
    paneId,
    plotRef,
    projectionMode,
    projectionPoints,
    renderer,
    rendererNativeReady,
    showVolume,
  ]);

  useEffect(() => {
    if (effectiveRenderer !== "kitty" || !rendererNativeReady || !renderer.resolution || !plotRef.current || !nativeCrosshair) {
      lastNativeCrosshairBitmapRef.current = null;
      nativeSurfaceManager.removeSurface(nativeCrosshairSurfaceId);
      return;
    }

    const plot = plotRef.current as unknown as NativeSurfaceRenderableNode;
    const plotRect = getRenderableCellRect(plot);
    const visibleRect = resolveNativeSurfaceVisibleRect(plot, renderer.terminalWidth, renderer.terminalHeight);
    const bitmapSize = computeBitmapSize(plotRect, renderer.resolution, renderer.terminalWidth, renderer.terminalHeight);
    const renderablePixelSize = getRenderablePixelSize(plotRef.current, renderer);
    const overlayPixelX = scaleLocalPixelCoordinate(
      nativeCrosshair.pixelX,
      renderablePixelSize?.pixelWidth ?? bitmapSize.pixelWidth,
      bitmapSize.pixelWidth,
    );
    const overlayPixelY = scaleLocalPixelCoordinate(
      nativeCrosshair.pixelY,
      renderablePixelSize?.pixelHeight ?? bitmapSize.pixelHeight,
      bitmapSize.pixelHeight,
    );

    if (overlayPixelX === null || overlayPixelY === null) {
      lastNativeCrosshairBitmapRef.current = null;
      nativeSurfaceManager.removeSurface(nativeCrosshairSurfaceId);
      return;
    }

    const overlay = {
      ...nativeCrosshair,
      pixelX: overlayPixelX,
      pixelY: overlayPixelY,
    };
    const bitmapKey = buildNativeCrosshairBitmapKey(
      bitmapSize.pixelWidth,
      bitmapSize.pixelHeight,
      overlay.height,
      overlay.chartRows,
      overlay.colors.crosshairColor,
      overlay.pixelX,
      overlay.pixelY,
    );
    const cachedBitmap = lastNativeCrosshairBitmapRef.current?.key === bitmapKey
      ? lastNativeCrosshairBitmapRef.current.bitmap
      : null;
    const bitmap = cachedBitmap ?? renderNativeCrosshairOverlay(overlay, bitmapSize.pixelWidth, bitmapSize.pixelHeight);
    if (!cachedBitmap) {
      lastNativeCrosshairBitmapRef.current = { key: bitmapKey, bitmap };
    }

    if (!visibleRect) {
      nativeSurfaceManager.removeSurface(nativeCrosshairSurfaceId);
      return;
    }

    nativeSurfaceManager.upsertSurface({
      id: nativeCrosshairSurfaceId,
      paneId,
      rect: plotRect,
      visibleRect,
      bitmap,
      bitmapKey,
    });
  }, [
    effectiveRenderer,
    nativeCrosshair,
    nativeCrosshairSurfaceId,
    nativeSurfaceManager,
    paneId,
    plotRef,
    renderer,
    rendererNativeReady,
  ]);
}
