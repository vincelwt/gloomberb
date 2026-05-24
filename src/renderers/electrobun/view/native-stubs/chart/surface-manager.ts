export interface NativePaneLayer {
  paneId: string;
  zIndex: number;
}

export interface NativeOccluder {
  id: string;
  paneId?: string | null;
  rect: { x: number; y: number; width: number; height: number };
  zIndex: number;
}

export class NativeSurfaceManager {
  setWindowState(): void {}
  upsertSurface(): void {}
  updateSurfaceGeometry(): void {}
  removeSurface(): void {}
  destroy(): void {}
}

const manager = new NativeSurfaceManager();

export function getNativeSurfaceManager(): NativeSurfaceManager {
  return manager;
}
