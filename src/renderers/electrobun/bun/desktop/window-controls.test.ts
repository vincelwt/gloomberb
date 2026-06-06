import { describe, expect, test } from "bun:test";
import { applyDesktopWindowControl } from "./window-controls";

type WindowCall = "close" | "minimize" | "maximize" | "unmaximize";

function createWindow(isMaximized = false) {
  const calls: WindowCall[] = [];
  return {
    calls,
    window: {
      close: () => calls.push("close"),
      minimize: () => calls.push("minimize"),
      maximize: () => calls.push("maximize"),
      unmaximize: () => calls.push("unmaximize"),
      isMaximized: () => isMaximized,
    },
  };
}

describe("applyDesktopWindowControl", () => {
  test("minimizes and closes windows", () => {
    const target = createWindow();

    applyDesktopWindowControl(target.window, "minimize");
    applyDesktopWindowControl(target.window, "close");

    expect(target.calls).toEqual(["minimize", "close"]);
  });

  test("toggles maximize based on the current window state", () => {
    const restored = createWindow(false);
    const maximized = createWindow(true);

    applyDesktopWindowControl(restored.window, "toggle-maximize");
    applyDesktopWindowControl(maximized.window, "toggle-maximize");

    expect(restored.calls).toEqual(["maximize"]);
    expect(maximized.calls).toEqual(["unmaximize"]);
  });
});
