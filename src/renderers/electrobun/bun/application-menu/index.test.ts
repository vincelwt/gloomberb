import { describe, expect, test } from "bun:test";
import { buildApplicationMenu, buildDesktopApplicationMenu } from "./index";

describe("desktop application menu", () => {
  test("hides the application menu on Windows to preserve vertical space", () => {
    expect(buildDesktopApplicationMenu("win32")).toEqual([]);
  });

  test("keeps the native application menu on macOS", () => {
    expect(buildDesktopApplicationMenu("darwin")).toEqual(buildApplicationMenu());
  });

  test("routes macOS quit through an explicit command item", () => {
    const appMenu = buildApplicationMenu()[0]?.submenu;
    expect(appMenu?.at(-1)).toMatchObject({
      label: "Quit Gloomberb",
      accelerator: "CmdOrCtrl+Q",
      data: { type: "quit" },
    });
  });
});
