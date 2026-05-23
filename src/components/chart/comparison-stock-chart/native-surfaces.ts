import { useEffect, useMemo, useRef, type RefObject } from "react";
import type { BoxRenderable, NativeRendererHost } from "../../../ui";
import {
  getRenderablePixelSize,
  scaleLocalPixelCoordinate,
} from "../chart-pointer";
import type { ComparisonChartProjection } from "../comparison-chart-data";
import type { ComparisonChartScene } from "../comparison-chart-renderer";
import type { ResolvedChartRenderer } from "../chart-types";
import {
  computeBitmapSize,
  renderNativeComparisonChartBase,
  renderNativeCrosshairOverlay,
  type NativeCrosshairOverlay,
} from "../native/chart-rasterizer";
import {
  useNativeChartSurfaceLifecycle,
  type NativeChartSurfaceCache,
} from "../native/surface-hooks";
import type { NativeSurfaceManager } from "../native/surface-manager";
import {
  getRenderableCellRect,
  resolveNativeSurfaceVisibleRect,
  type NativeSurfaceRenderableNode,
} from "../native/surface-visibility";
import {
  buildComparisonNativeBitmapKey,
  buildNativeCrosshairBitmapKey,
} from "./helpers";
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
  const lastNativeBaseBitmapRef = useRef<NativeChartSurfaceCache | null>(null);
  const lastNativeCrosshairBitmapRef = useRef<NativeChartSurfaceCache | null>(null);

  useNativeChartSurfaceLifecycle({
    baseBitmapRef: lastNativeBaseBitmapRef,
    baseSurfaceId: nativeBaseSurfaceId,
    crosshairBitmapRef: lastNativeCrosshairBitmapRef,
    crosshairSurfaceId: nativeCrosshairSurfaceId,
    effectiveRenderer,
    nativeReady,
    nativeSurfaceManager,
    paneId,
    plotRef,
    renderer,
  });

  useEffect(() => {
    if (effectiveRenderer !== "kitty" || !nativeReady || !renderer.resolution || !plotRef.current || !staticScene) {
      lastNativeBaseBitmapRef.current = null;
      nativeSurfaceManager.removeSurface(nativeBaseSurfaceId);
      return;
    }

    const plot = plotRef.current as unknown as NativeSurfaceRenderableNode;
    const plotRect = getRenderableCellRect(plot);
    const visibleRect = resolveNativeSurfaceVisibleRect(plot, renderer.terminalWidth, renderer.terminalHeight);
    const bitmapSize = computeBitmapSize(plotRect, renderer.resolution, renderer.terminalWidth, renderer.terminalHeight);
    const bitmapKey = buildComparisonNativeBitmapKey(
      symbolCount,
      projection,
      selectedSymbol,
      bitmapSize.pixelWidth,
      bitmapSize.pixelHeight,
      buildChartColorKey(chartColors),
      marketSessionKey,
    );
    const cachedBitmap = lastNativeBaseBitmapRef.current?.key === bitmapKey
      ? lastNativeBaseBitmapRef.current.bitmap
      : null;
    const bitmap = cachedBitmap ?? renderNativeComparisonChartBase(staticScene, bitmapSize.pixelWidth, bitmapSize.pixelHeight);
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
    if (!cachedBitmap) {
      renderer.requestRender();
    }
  }, [
    chartColors,
    effectiveRenderer,
    marketSessionKey,
    nativeReady,
    nativeBaseSurfaceId,
    nativeSurfaceManager,
    paneId,
    plotRef,
    projection,
    renderer,
    selectedSymbol,
    staticScene,
    symbolCount,
  ]);

  useEffect(() => {
    if (effectiveRenderer !== "kitty" || !nativeReady || !renderer.resolution || !plotRef.current || !nativeCrosshair) {
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
    nativeReady,
    nativeSurfaceManager,
    paneId,
    plotRef,
    renderer,
  ]);
}
