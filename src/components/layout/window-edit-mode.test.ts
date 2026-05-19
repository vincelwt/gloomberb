import { describe, expect, test } from "bun:test";
import type { LayoutConfig } from "../../types/config";
import { cycleWindowEditPane, getWindowEditPaneIds, type WindowEditState } from "./window-edit-mode";

const bounds = { x: 0, y: 0, width: 120, height: 40 };

function pane(instanceId: string, paneId = "test-pane") {
  return { instanceId, paneId };
}

describe("window edit mode", () => {
  test("keeps window cycling independent from floating z-index changes", () => {
    const layout: LayoutConfig = {
      dockRoot: {
        kind: "split",
        axis: "horizontal",
        ratio: 0.5,
        first: { kind: "pane", instanceId: "dock-a" },
        second: { kind: "pane", instanceId: "dock-b" },
      },
      instances: [
        pane("dock-a"),
        pane("dock-b"),
        pane("float-a"),
        pane("float-b"),
      ],
      floating: [
        { instanceId: "float-a", x: 4, y: 2, width: 30, height: 8, zIndex: 50 },
        { instanceId: "float-b", x: 8, y: 4, width: 30, height: 8, zIndex: 75 },
      ],
      detached: [],
    };
    let state: WindowEditState = {
      paneId: "dock-a",
      previewLayout: layout,
      mode: "move",
      focus: { kind: "move" },
      dirty: false,
    };

    state = cycleWindowEditPane(state, getWindowEditPaneIds(state.previewLayout), bounds, {}, 1);
    expect(state.paneId).toBe("dock-b");

    state = cycleWindowEditPane(state, getWindowEditPaneIds(state.previewLayout), bounds, {}, 1);
    expect(state.paneId).toBe("float-a");
    expect(state.previewLayout.floating.find((entry) => entry.instanceId === "float-a")?.zIndex)
      .toBeGreaterThan(state.previewLayout.floating.find((entry) => entry.instanceId === "float-b")?.zIndex ?? 0);

    state = cycleWindowEditPane(state, getWindowEditPaneIds(state.previewLayout), bounds, {}, 1);
    expect(state.paneId).toBe("float-b");

    state = cycleWindowEditPane(state, getWindowEditPaneIds(state.previewLayout), bounds, {}, 1);
    expect(state.paneId).toBe("dock-a");
  });
});
