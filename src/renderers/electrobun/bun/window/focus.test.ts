import { describe, expect, test } from "bun:test";
import { detachedRpcKey, focusWindowForRpcKey, MAIN_WINDOW_RPC_KEY, type FocusableElectrobunWindow } from "./focus";

describe("Electrobun window focus routing", () => {
  test("uses activate for the main window", () => {
    const calls: string[] = [];
    const mainWindow: FocusableElectrobunWindow = {
      activate: () => calls.push("activate"),
      focus: () => calls.push("focus"),
    };

    expect(focusWindowForRpcKey(MAIN_WINDOW_RPC_KEY, mainWindow, new Map())).toBe(true);
    expect(calls).toEqual(["activate"]);
  });

  test("uses activate for detached windows", () => {
    const calls: string[] = [];
    const detachedWindows = new Map<string, FocusableElectrobunWindow>([
      ["pane:1", { activate: () => calls.push("detached") }],
    ]);

    expect(focusWindowForRpcKey(detachedRpcKey("pane:1"), null, detachedWindows)).toBe(true);
    expect(calls).toEqual(["detached"]);
  });

  test("falls back to focus for legacy window objects", () => {
    const calls: string[] = [];
    const mainWindow: FocusableElectrobunWindow = {
      focus: () => calls.push("focus"),
    };

    expect(focusWindowForRpcKey(MAIN_WINDOW_RPC_KEY, mainWindow, new Map())).toBe(true);
    expect(calls).toEqual(["focus"]);
  });
});
