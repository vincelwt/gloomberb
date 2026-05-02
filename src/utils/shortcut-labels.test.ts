import { describe, expect, test } from "bun:test";
import { formatPlatformShortcutLabel, formatPrimaryShortcut } from "./shortcut-labels";

describe("shortcut labels", () => {
  test("renders command-or-control shortcuts for the active platform", () => {
    expect(formatPlatformShortcutLabel("Cmd/Ctrl+Shift+D", "darwin")).toBe("Cmd+Shift+D");
    expect(formatPlatformShortcutLabel("Cmd/Ctrl+Shift+D", "linux")).toBe("Ctrl+Shift+D");
    expect(formatPlatformShortcutLabel("CmdOrCtrl+W", "win32")).toBe("Ctrl+W");
    expect(formatPrimaryShortcut(["Shift", "G"], "darwin")).toBe("Cmd+Shift+G");
    expect(formatPrimaryShortcut(",", "linux")).toBe("Ctrl+,");
  });
});
