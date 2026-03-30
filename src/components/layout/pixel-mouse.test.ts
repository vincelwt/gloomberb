import { describe, expect, test } from "bun:test";
import { MouseParser } from "@opentui/core";

describe("pixel mouse projection", () => {
  test("keeps bottom-row pixel clicks on the bottom terminal row", () => {
    const parser = new MouseParser();
    const event = parser.parseMouseEvent(
      Buffer.from("\x1B[<0;101;565M"),
      {
        mouseUsesPixels: true,
        mousePixelsConfirmed: true,
        terminalWidth: 100,
        terminalHeight: 24,
        pixelWidth: 1000,
        pixelHeight: 576,
      },
    );

    expect(event).not.toBeNull();
    expect(event?.y).toBe(23);
  });

  test("keeps second-last-row pixel clicks on the second-last terminal row", () => {
    const parser = new MouseParser();
    const event = parser.parseMouseEvent(
      Buffer.from("\x1B[<0;101;541M"),
      {
        mouseUsesPixels: true,
        mousePixelsConfirmed: true,
        terminalWidth: 100,
        terminalHeight: 24,
        pixelWidth: 1000,
        pixelHeight: 576,
      },
    );

    expect(event).not.toBeNull();
    expect(event?.y).toBe(22);
  });
});
