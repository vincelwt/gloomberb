import { describe, expect, test } from "bun:test";
import type { NativeRendererHost } from "../../../ui";
import { shouldRenderNativeBitmap } from "./bitmap-support";

function rendererWithCapabilities(capabilities: unknown): NativeRendererHost {
  return {
    terminalWidth: 80,
    terminalHeight: 24,
    resolution: null,
    capabilities,
    on() {},
    off() {},
    requestRender() {},
    registerLifecyclePass() {},
    unregisterLifecyclePass() {},
  };
}

describe("shouldRenderNativeBitmap", () => {
  test("skips native bitmaps only when kitty graphics are known unsupported", () => {
    expect(shouldRenderNativeBitmap(rendererWithCapabilities({ kitty_graphics: false }), true)).toBe(false);
    expect(shouldRenderNativeBitmap(rendererWithCapabilities({ kitty_graphics: true }), true)).toBe(true);
    expect(shouldRenderNativeBitmap(rendererWithCapabilities(null), true)).toBe(true);
    expect(shouldRenderNativeBitmap(rendererWithCapabilities({}), true)).toBe(true);
    expect(shouldRenderNativeBitmap(rendererWithCapabilities({ kitty_graphics: true }), false)).toBe(false);
  });
});
