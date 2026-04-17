import { type NativeRendererHost as CliRenderer } from "../../../ui";

export function writeRendererRaw(renderer: CliRenderer, data: string | Uint8Array): boolean {
  if (renderer.isDestroyed) {
    return false;
  }

  return renderer.write?.(data) ?? false;
}
