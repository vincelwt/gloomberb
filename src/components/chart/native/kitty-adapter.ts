import type { CliRenderer } from "@opentui/core";

export function writeRendererRaw(renderer: CliRenderer, data: string | Uint8Array): boolean {
  if (renderer.isDestroyed) {
    return false;
  }

  const writer = (renderer as unknown as { writeOut?: (payload: string | Uint8Array) => void }).writeOut;
  if (typeof writer !== "function") return false;
  writer.call(renderer, data);
  return true;
}
