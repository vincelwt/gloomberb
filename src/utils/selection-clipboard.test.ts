import { describe, expect, test } from "bun:test";
import { copyActiveSelection, isCopyShortcut, isPasteShortcut } from "./selection-clipboard";

describe("selection clipboard sync", () => {
  test("copies the active selection when present", () => {
    const renderer = {
      copyToClipboardOSC52: (text: string) => text === "AAPL",
      getSelection: () => ({
        getSelectedText: () => "AAPL",
      }),
    };

    expect(copyActiveSelection(renderer as any)).toBe(true);
  });

  test("ignores empty or missing selections", () => {
    expect(copyActiveSelection({
      copyToClipboardOSC52: () => true,
      getSelection: () => null,
    } as any)).toBe(false);

    expect(copyActiveSelection({
      copyToClipboardOSC52: () => true,
      getSelection: () => ({
        getSelectedText: () => "",
      }),
    } as any)).toBe(false);
  });

  test("matches explicit copy shortcuts only", () => {
    expect(isCopyShortcut({ name: "c", super: true, meta: false, ctrl: false, shift: false } as any)).toBe(true);
    expect(isCopyShortcut({ name: "c", super: false, meta: true, ctrl: false, shift: false } as any)).toBe(true);
    expect(isCopyShortcut({ name: "c", super: false, meta: false, ctrl: true, shift: true } as any)).toBe(true);
    expect(isCopyShortcut({ name: "c", super: false, ctrl: true, shift: false } as any)).toBe(false);
  });

  test("matches explicit paste shortcuts only", () => {
    expect(isPasteShortcut({ name: "v", super: true, meta: false, ctrl: false, shift: false } as any)).toBe(true);
    expect(isPasteShortcut({ name: "v", super: false, meta: true, ctrl: false, shift: false } as any)).toBe(true);
    expect(isPasteShortcut({ name: "v", super: false, meta: false, ctrl: true, shift: true } as any)).toBe(true);
    expect(isPasteShortcut({ name: "v", super: false, meta: false, ctrl: true, shift: false } as any)).toBe(false);
  });
});
