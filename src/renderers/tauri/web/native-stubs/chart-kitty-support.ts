import type { NativeRendererHost } from "../../../../ui";

export function getCachedKittySupport(_renderer: NativeRendererHost): boolean {
  return false;
}

export function ensureKittySupport(_renderer: NativeRendererHost): Promise<boolean> {
  return Promise.resolve(false);
}
