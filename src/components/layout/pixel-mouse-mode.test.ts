import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CliRenderer } from "@opentui/core";

const syncPixelMouseMode = (CliRenderer as any).prototype.syncPixelMouseMode as (this: any, force?: boolean) => void;
const getMouseProtocolTrackingMode = (CliRenderer as any).prototype.getMouseProtocolTrackingMode as (this: any) => string;
const buildMouseProtocolSequence = (CliRenderer as any).prototype.buildMouseProtocolSequence as (this: any, pixelEnabled: boolean) => string;
const originalPixelMouseDisabledEnv = process.env.GLOOMBERB_DISABLE_PIXEL_MOUSE;

function createRendererHarness(overrides: Record<string, unknown> = {}) {
  const writes: string[] = [];
  const protocolPatches: Array<Record<string, unknown>> = [];
  const renderer = {
    _useMouse: true,
    _terminalWidth: 120,
    _terminalHeight: 40,
    _capabilities: { sgr_pixels: true },
    _resolution: null,
    _mouseProtocolSignature: "disabled",
    _pixelMouseEnabled: false,
    enableMouseMovement: false,
    getMouseProtocolTrackingMode,
    buildMouseProtocolSequence,
    writeOut(sequence: string) {
      writes.push(sequence);
    },
    updateStdinParserProtocolContext(patch: Record<string, unknown>) {
      protocolPatches.push(patch);
    },
    ...overrides,
  };

  return { renderer, writes, protocolPatches };
}

describe("pixel mouse mode enablement", () => {
  beforeEach(() => {
    delete process.env.GLOOMBERB_DISABLE_PIXEL_MOUSE;
  });

  afterEach(() => {
    if (originalPixelMouseDisabledEnv === undefined) {
      delete process.env.GLOOMBERB_DISABLE_PIXEL_MOUSE;
    } else {
      process.env.GLOOMBERB_DISABLE_PIXEL_MOUSE = originalPixelMouseDisabledEnv;
    }
  });

  test("stays in cell mode until pixel resolution is known", () => {
    const { renderer, writes, protocolPatches } = createRendererHarness({
      _resolution: null,
    });

    syncPixelMouseMode.call(renderer);

    expect(writes).toEqual(["\x1B[?1005l\x1B[?1015l\x1B[?1006h\x1B[?1003l\x1B[?1002l\x1B[?1000h\x1B[?1016l"]);
    expect((renderer as any)._mouseProtocolSignature).toBe("press:cell");
    expect((renderer as any)._pixelMouseEnabled).toBe(false);
    expect(protocolPatches.at(-1)).toMatchObject({
      mouseUsesPixels: false,
      mousePixelsConfirmed: false,
      pixelWidth: 0,
      pixelHeight: 0,
    });
  });

  test("stays in cell mode when the terminal does not advertise sgr pixel support", () => {
    const { renderer, writes, protocolPatches } = createRendererHarness({
      _capabilities: { sgr_pixels: false },
      _resolution: { width: 1440, height: 900 },
    });

    syncPixelMouseMode.call(renderer);

    expect(writes).toEqual(["\x1B[?1005l\x1B[?1015l\x1B[?1006h\x1B[?1003l\x1B[?1002l\x1B[?1000h\x1B[?1016l"]);
    expect((renderer as any)._mouseProtocolSignature).toBe("press:cell");
    expect((renderer as any)._pixelMouseEnabled).toBe(false);
    expect(protocolPatches.at(-1)).toMatchObject({
      mouseUsesPixels: false,
      mousePixelsConfirmed: false,
      pixelWidth: 1440,
      pixelHeight: 900,
    });
  });

  test("enables pixel mouse by default after capability detection and pixel resolution are ready", () => {
    const { renderer, writes, protocolPatches } = createRendererHarness({
      _resolution: { width: 1440, height: 900 },
    });

    syncPixelMouseMode.call(renderer);

    expect(writes).toEqual(["\x1B[?1005l\x1B[?1015l\x1B[?1006h\x1B[?1003l\x1B[?1002l\x1B[?1000h\x1B[?1016h"]);
    expect((renderer as any)._mouseProtocolSignature).toBe("press:pixel");
    expect((renderer as any)._pixelMouseEnabled).toBe(true);
    expect(protocolPatches.at(-1)).toMatchObject({
      mouseUsesPixels: true,
      mousePixelsConfirmed: true,
      pixelWidth: 1440,
      pixelHeight: 900,
    });
  });

  test("stays in cell mode when pixel mouse is explicitly disabled", () => {
    process.env.GLOOMBERB_DISABLE_PIXEL_MOUSE = "1";

    const { renderer, writes, protocolPatches } = createRendererHarness({
      _resolution: { width: 1440, height: 900 },
    });

    syncPixelMouseMode.call(renderer);

    expect(writes).toEqual(["\x1B[?1005l\x1B[?1015l\x1B[?1006h\x1B[?1003l\x1B[?1002l\x1B[?1000h\x1B[?1016l"]);
    expect((renderer as any)._mouseProtocolSignature).toBe("press:cell");
    expect((renderer as any)._pixelMouseEnabled).toBe(false);
    expect(protocolPatches.at(-1)).toMatchObject({
      mouseUsesPixels: false,
      mousePixelsConfirmed: false,
      pixelWidth: 1440,
      pixelHeight: 900,
    });
  });
});
