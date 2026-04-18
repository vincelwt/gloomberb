import { describe, expect, test } from "bun:test";
import { createDefaultConfig } from "../../../types/config";
import { createDesktopWorkspace } from "./desktop-workspace";

describe("desktop workspace", () => {
  test("popping out a pane persists it into the active layout", () => {
    const config = createDefaultConfig("/tmp/gloomberb-desktop");
    const workspace = createDesktopWorkspace(config, null);

    const snapshot = workspace.popOutPane("chat:main", {
      x: 100,
      y: 120,
      width: 800,
      height: 540,
    });

    expect(snapshot.config.layout.detached).toEqual([
      { instanceId: "chat:main", x: 100, y: 120, width: 800, height: 540 },
    ]);
    expect(snapshot.config.layouts[snapshot.config.activeLayoutIndex]?.layout.detached).toEqual([
      { instanceId: "chat:main", x: 100, y: 120, width: 800, height: 540 },
    ]);
    expect(snapshot.config.layout.floating).toHaveLength(0);
  });

  test("docking a detached pane onto a frame edge clears detached placement", () => {
    const config = createDefaultConfig("/tmp/gloomberb-desktop");
    const workspace = createDesktopWorkspace(config, null);
    workspace.popOutPane("chat:main", {
      x: 100,
      y: 120,
      width: 800,
      height: 540,
    });

    const snapshot = workspace.dockDetachedPane("chat:main", "left");

    expect(snapshot.config.layout.detached).toHaveLength(0);
    expect(snapshot.config.layout.dockRoot).not.toBeNull();
  });

  test("updating a detached frame rewrites the detached entry in-place", () => {
    const config = createDefaultConfig("/tmp/gloomberb-desktop");
    const workspace = createDesktopWorkspace(config, null);
    workspace.popOutPane("chat:main", {
      x: 100,
      y: 120,
      width: 800,
      height: 540,
    });

    const snapshot = workspace.updateDetachedFrame("chat:main", {
      x: 220,
      y: 260,
      width: 640,
      height: 480,
    });

    expect(snapshot.config.layout.detached).toEqual([
      { instanceId: "chat:main", x: 220, y: 260, width: 640, height: 480 },
    ]);
  });
});
