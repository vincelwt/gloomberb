import type { CellRect, NativeChartBitmap } from "./chart-rasterizer";
import type { NativeSurfaceManager } from "./surface-manager";

interface CachedNativeSurface {
  key: string;
  bitmap: NativeChartBitmap;
}

interface NativeSurfaceGeometry {
  paneId: string;
  rect: CellRect;
  visibleRect: CellRect | null;
}

export function syncCachedNativeSurface(
  manager: Pick<NativeSurfaceManager, "upsertSurface" | "updateSurfaceGeometry">,
  id: string,
  geometry: NativeSurfaceGeometry,
  cachedSurface: CachedNativeSurface | null,
) {
  if (geometry.visibleRect && cachedSurface) {
    manager.upsertSurface({
      id,
      paneId: geometry.paneId,
      rect: geometry.rect,
      visibleRect: geometry.visibleRect,
      bitmap: cachedSurface.bitmap,
      bitmapKey: cachedSurface.key,
    });
    return;
  }

  manager.updateSurfaceGeometry(id, geometry);
}
