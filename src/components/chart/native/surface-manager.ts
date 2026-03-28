import type { CliRenderer } from "@opentui/core";
import {
  computeNativePlacements,
  excludeCellRects,
  intersectCellRects,
  type CellRect,
  type NativeChartBitmap,
} from "./chart-rasterizer";
import { KittyImageManager } from "./kitty-manager";

export interface NativePaneLayer {
  paneId: string;
  zIndex: number;
}

export interface NativeOccluder {
  id: string;
  paneId?: string | null;
  rect: CellRect;
  zIndex: number;
}

export interface NativeSurfaceSnapshot {
  id: string;
  paneId: string;
  rect: CellRect;
  visibleRect: CellRect | null;
  bitmap: NativeChartBitmap;
  bitmapKey: string;
}

interface SurfaceEntry {
  imageManager: KittyImageManager;
  snapshot: NativeSurfaceSnapshot;
}

interface NativeWindowState {
  paneLayers: NativePaneLayer[];
  occluders: NativeOccluder[];
}

function compareRects(a: CellRect, b: CellRect): number {
  if (a.y !== b.y) return a.y - b.y;
  if (a.x !== b.x) return a.x - b.x;
  if (a.height !== b.height) return a.height - b.height;
  return a.width - b.width;
}

export function computeSurfaceVisibleFragments(
  rect: CellRect,
  visibleRect: CellRect | null,
  surfaceZIndex: number,
  paneId: string,
  occluders: NativeOccluder[],
): CellRect[] {
  if (!visibleRect) return [];
  const clipped = intersectCellRects(rect, visibleRect);
  if (!clipped) return [];

  const relevantCuts = occluders
    .filter((occluder) => occluder.paneId !== paneId && occluder.zIndex >= surfaceZIndex)
    .sort((left, right) => right.zIndex - left.zIndex)
    .map((occluder) => occluder.rect);

  return excludeCellRects(clipped, relevantCuts).sort(compareRects);
}

export class NativeSurfaceManager {
  private windowState: NativeWindowState = { paneLayers: [], occluders: [] };
  private readonly surfaces = new Map<string, SurfaceEntry>();

  constructor(private readonly renderer: CliRenderer) {}

  setWindowState(windowState: NativeWindowState) {
    this.windowState = {
      paneLayers: [...windowState.paneLayers],
      occluders: [...windowState.occluders],
    };
    this.syncAll();
  }

  upsertSurface(snapshot: NativeSurfaceSnapshot) {
    const existing = this.surfaces.get(snapshot.id);
    if (existing) {
      existing.snapshot = snapshot;
      this.syncSurface(existing);
      return;
    }

    const entry: SurfaceEntry = {
      imageManager: new KittyImageManager(this.renderer),
      snapshot,
    };
    this.surfaces.set(snapshot.id, entry);
    this.syncSurface(entry);
  }

  updateSurfaceGeometry(id: string, geometry: Pick<NativeSurfaceSnapshot, "paneId" | "rect" | "visibleRect">) {
    const entry = this.surfaces.get(id);
    if (!entry) return;
    entry.snapshot = {
      ...entry.snapshot,
      ...geometry,
    };
    this.syncSurface(entry);
  }

  removeSurface(id: string) {
    const entry = this.surfaces.get(id);
    if (!entry) return;
    entry.imageManager.destroy();
    this.surfaces.delete(id);
  }

  destroy() {
    for (const id of [...this.surfaces.keys()]) {
      this.removeSurface(id);
    }
  }

  private syncAll() {
    for (const entry of this.surfaces.values()) {
      this.syncSurface(entry);
    }
  }

  private syncSurface(entry: SurfaceEntry) {
    const resolution = this.renderer.resolution;
    if (!resolution) {
      entry.imageManager.clear();
      return;
    }

    const surfaceZIndex = this.windowState.paneLayers.find((layer) => layer.paneId === entry.snapshot.paneId)?.zIndex ?? 0;
    const fragments = computeSurfaceVisibleFragments(
      entry.snapshot.rect,
      entry.snapshot.visibleRect,
      surfaceZIndex,
      entry.snapshot.paneId,
      this.windowState.occluders,
    );

    const placements = computeNativePlacements(
      entry.snapshot.rect,
      fragments,
      entry.snapshot.bitmap,
      resolution,
      this.renderer.terminalWidth,
      this.renderer.terminalHeight,
    );

    if (placements.length === 0) {
      entry.imageManager.clear();
      return;
    }

    entry.imageManager.render(entry.snapshot.bitmap, placements, entry.snapshot.bitmapKey);
  }
}

const nativeSurfaceManagers = new WeakMap<CliRenderer, NativeSurfaceManager>();

export function getNativeSurfaceManager(renderer: CliRenderer): NativeSurfaceManager {
  const existing = nativeSurfaceManagers.get(renderer);
  if (existing) return existing;
  const manager = new NativeSurfaceManager(renderer);
  nativeSurfaceManagers.set(renderer, manager);
  return manager;
}
