import { describe, expect, test } from "bun:test";
import { cloneLayout, createDefaultConfig, createPaneInstance } from "../types/config";
import {
  addPaneFloating,
  applyDrop,
  floatAtRect,
  gridlockAllPanes,
  getDockedPaneIds,
  getLeafRect,
  simulateDrop,
} from "./pane-manager";

const BOUNDS = { x: 0, y: 0, width: 120, height: 40 };

describe("pane-manager split-tree drops", () => {
  test("docks the first floating pane into an empty dock root", () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    const layout = {
      ...cloneLayout(config.layout),
      dockRoot: null,
      floating: [],
      instances: [],
    };
    const floatingOnly = addPaneFloating(layout, createPaneInstance("chat"), 120, 30);
    const paneId = floatingOnly.floating[0]!.instanceId;

    const next = applyDrop(floatingOnly, paneId, { kind: "frame", edge: "left" });

    expect(getDockedPaneIds(next)).toEqual([paneId]);
    expect(next.floating).toHaveLength(0);
  });

  test("keeps frame-drop previews identical to the committed rect", () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    const notesPane = createPaneInstance("chat");
    const withFloating = addPaneFloating(cloneLayout(config.layout), notesPane, 120, 30);
    const target = { kind: "frame", edge: "right" } as const;

    const simulation = simulateDrop(withFloating, notesPane.instanceId, target, BOUNDS);
    const next = applyDrop(withFloating, notesPane.instanceId, target);

    expect(getLeafRect(next, notesPane.instanceId, BOUNDS)).toEqual(simulation.previewRect);
    expect(getDockedPaneIds(next)).toContain(notesPane.instanceId);
  });

  test("splits the hovered pane on leaf drops and matches the preview", () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    const notesPane = createPaneInstance("chat");
    const withFloating = addPaneFloating(cloneLayout(config.layout), notesPane, 120, 30);
    const target = { kind: "leaf", targetId: "ticker-detail:main", position: "top" } as const;

    const simulation = simulateDrop(withFloating, notesPane.instanceId, target, BOUNDS);
    const next = applyDrop(withFloating, notesPane.instanceId, target);
    const notesRect = getLeafRect(next, notesPane.instanceId, BOUNDS);
    const tickerRect = getLeafRect(next, "ticker-detail:main", BOUNDS);

    expect(notesRect).toEqual(simulation.previewRect);
    expect(notesRect).not.toBeNull();
    expect(tickerRect).not.toBeNull();
    expect(notesRect?.x).toBe(tickerRect?.x);
    expect(notesRect?.width).toBe(tickerRect?.width);
    expect(notesRect?.y).toBeLessThan(tickerRect!.y);
  });

  test("gridlocks floating windows back into a tiled layout", () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    let layout = cloneLayout(config.layout);
    layout = addPaneFloating(layout, createPaneInstance("chat"), 120, 30);
    layout = addPaneFloating(layout, createPaneInstance("chat"), 120, 30);

    const next = gridlockAllPanes(layout);

    expect(next.floating).toHaveLength(0);
    expect(getDockedPaneIds(next)).toHaveLength(5);
  });

  test("gridlock infers a matching tiled layout from arranged windows", () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    let layout = {
      ...cloneLayout(config.layout),
      dockRoot: null,
      floating: [],
      instances: [],
    };
    const leftPane = createPaneInstance("chat");
    const topRightPane = createPaneInstance("chat");
    const bottomRightPane = createPaneInstance("chat");

    layout = addPaneFloating(layout, leftPane, 120, 40);
    layout = addPaneFloating(layout, topRightPane, 120, 40);
    layout = addPaneFloating(layout, bottomRightPane, 120, 40);
    layout = floatAtRect(layout, leftPane.instanceId, { x: 0, y: 0, width: 60, height: 40 });
    layout = floatAtRect(layout, topRightPane.instanceId, { x: 60, y: 0, width: 60, height: 20 });
    layout = floatAtRect(layout, bottomRightPane.instanceId, { x: 60, y: 20, width: 60, height: 20 });

    const next = gridlockAllPanes(layout, BOUNDS);

    expect(next.floating).toHaveLength(0);
    expect(getLeafRect(next, leftPane.instanceId, BOUNDS)).toEqual({ x: 0, y: 0, width: 60, height: 40 });
    expect(getLeafRect(next, topRightPane.instanceId, BOUNDS)).toEqual({ x: 60, y: 0, width: 60, height: 20 });
    expect(getLeafRect(next, bottomRightPane.instanceId, BOUNDS)).toEqual({ x: 60, y: 20, width: 60, height: 20 });
  });
});
