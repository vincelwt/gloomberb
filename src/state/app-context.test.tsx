import { describe, expect, test } from "bun:test";
import { cloneLayout, createDefaultConfig } from "../types/config";
import { appReducer, createInitialState } from "./app-context";

describe("appReducer command bar state", () => {
  test("opens the command bar with an explicit query", () => {
    const state = createInitialState(createDefaultConfig("/tmp/gloomberb-test"));
    const next = appReducer(state, { type: "SET_COMMAND_BAR", open: true, query: "Sync Broker Account" });

    expect(next.commandBarOpen).toBe(true);
    expect(next.commandBarQuery).toBe("Sync Broker Account");
  });

  test("clears the command bar query when closing", () => {
    const state = appReducer(
      createInitialState(createDefaultConfig("/tmp/gloomberb-test")),
      { type: "SET_COMMAND_BAR", open: true, query: "Disconnect Broker Account" },
    );
    const next = appReducer(state, { type: "SET_COMMAND_BAR", open: false });

    expect(next.commandBarOpen).toBe(false);
    expect(next.commandBarQuery).toBe("");
  });

  test("toggle opens blank and clears on close", () => {
    const initial = createInitialState(createDefaultConfig("/tmp/gloomberb-test"));
    const opened = appReducer(initial, { type: "TOGGLE_COMMAND_BAR" });
    const closed = appReducer({ ...opened, commandBarQuery: "stale" }, { type: "TOGGLE_COMMAND_BAR" });

    expect(opened.commandBarOpen).toBe(true);
    expect(opened.commandBarQuery).toBe("");
    expect(closed.commandBarOpen).toBe(false);
    expect(closed.commandBarQuery).toBe("");
  });

  test("updates the live command bar query without closing the overlay", () => {
    const state = appReducer(
      createInitialState(createDefaultConfig("/tmp/gloomberb-test")),
      { type: "SET_COMMAND_BAR", open: true, query: "PL " },
    );
    const next = appReducer(state, { type: "SET_COMMAND_BAR_QUERY", query: "PL notes" });

    expect(next.commandBarOpen).toBe(true);
    expect(next.commandBarQuery).toBe("PL notes");
  });

  test("re-shows the gridlock tip and refreshes its sequence on every trigger", () => {
    const initial = createInitialState(createDefaultConfig("/tmp/gloomberb-test"));

    const shown = appReducer(initial, { type: "SHOW_GRIDLOCK_TIP" });
    expect(shown.gridlockTipVisible).toBe(true);
    expect(shown.gridlockTipSequence).toBe(1);

    const dismissed = appReducer(shown, { type: "DISMISS_GRIDLOCK_TIP" });
    expect(dismissed.gridlockTipVisible).toBe(false);
    expect(dismissed.gridlockTipSequence).toBe(1);

    const repeated = appReducer(dismissed, { type: "SHOW_GRIDLOCK_TIP" });
    expect(repeated.gridlockTipVisible).toBe(true);
    expect(repeated.gridlockTipSequence).toBe(2);
  });

  test("tracks layout undo and redo history", () => {
    const initial = createInitialState(createDefaultConfig("/tmp/gloomberb-test"));
    const changedLayout = cloneLayout(initial.config.layout);
    if (!changedLayout.dockRoot || changedLayout.dockRoot.kind !== "split") {
      throw new Error("expected split dock root");
    }
    changedLayout.dockRoot.ratio = 0.5;

    const withHistory = appReducer(initial, { type: "PUSH_LAYOUT_HISTORY" });
    const changed = appReducer(withHistory, { type: "UPDATE_LAYOUT", layout: changedLayout });

    expect(changed.layoutHistory[0]?.past).toHaveLength(1);
    expect(changed.config.layout.dockRoot && changed.config.layout.dockRoot.kind === "split"
      ? changed.config.layout.dockRoot.ratio
      : null).toBe(0.5);

    const undone = appReducer(changed, { type: "UNDO_LAYOUT" });
    expect(undone.config.layout.dockRoot && undone.config.layout.dockRoot.kind === "split"
      ? undone.config.layout.dockRoot.ratio
      : null).toBe(0.4);
    expect(undone.layoutHistory[0]?.future).toHaveLength(1);

    const redone = appReducer(undone, { type: "REDO_LAYOUT" });
    expect(redone.config.layout.dockRoot && redone.config.layout.dockRoot.kind === "split"
      ? redone.config.layout.dockRoot.ratio
      : null).toBe(0.5);
    expect(redone.layoutHistory[0]?.past).toHaveLength(1);
  });

  test("keeps layout history isolated per saved layout", () => {
    const initial = createInitialState(createDefaultConfig("/tmp/gloomberb-test"));

    const firstLayout = cloneLayout(initial.config.layout);
    if (!firstLayout.dockRoot || firstLayout.dockRoot.kind !== "split") {
      throw new Error("expected split dock root");
    }
    firstLayout.dockRoot.ratio = 0.45;
    let state = appReducer(initial, { type: "PUSH_LAYOUT_HISTORY" });
    state = appReducer(state, { type: "UPDATE_LAYOUT", layout: firstLayout });
    state = appReducer(state, { type: "NEW_LAYOUT", name: "Research" });

    const noUndoOnFreshLayout = appReducer(state, { type: "UNDO_LAYOUT" });
    expect(noUndoOnFreshLayout.config.activeLayoutIndex).toBe(1);
    expect(noUndoOnFreshLayout.config.layout.dockRoot && noUndoOnFreshLayout.config.layout.dockRoot.kind === "split"
      ? noUndoOnFreshLayout.config.layout.dockRoot.ratio
      : null).toBe(0.4);

    const secondLayout = cloneLayout(noUndoOnFreshLayout.config.layout);
    if (!secondLayout.dockRoot || secondLayout.dockRoot.kind !== "split") {
      throw new Error("expected split dock root");
    }
    secondLayout.dockRoot.ratio = 0.55;
    state = appReducer(noUndoOnFreshLayout, { type: "PUSH_LAYOUT_HISTORY" });
    state = appReducer(state, { type: "UPDATE_LAYOUT", layout: secondLayout });

    const backToFirst = appReducer(state, { type: "SWITCH_LAYOUT", index: 0 });
    const firstUndone = appReducer(backToFirst, { type: "UNDO_LAYOUT" });
    expect(firstUndone.config.activeLayoutIndex).toBe(0);
    expect(firstUndone.config.layout.dockRoot && firstUndone.config.layout.dockRoot.kind === "split"
      ? firstUndone.config.layout.dockRoot.ratio
      : null).toBe(0.4);

    const backToSecond = appReducer(firstUndone, { type: "SWITCH_LAYOUT", index: 1 });
    const secondUndone = appReducer(backToSecond, { type: "UNDO_LAYOUT" });
    expect(secondUndone.config.activeLayoutIndex).toBe(1);
    expect(secondUndone.config.layout.dockRoot && secondUndone.config.layout.dockRoot.kind === "split"
      ? secondUndone.config.layout.dockRoot.ratio
      : null).toBe(0.4);
  });

  test("tracks manual update-check feedback", () => {
    const initial = createInitialState(createDefaultConfig("/tmp/gloomberb-test"));
    const checking = appReducer(initial, { type: "SET_UPDATE_CHECK_IN_PROGRESS", checking: true });
    const noticed = appReducer(checking, { type: "SET_UPDATE_NOTICE", notice: "Already on v0.3.1" });

    expect(checking.updateCheckInProgress).toBe(true);
    expect(noticed.updateNotice).toBe("Already on v0.3.1");
  });

  test("clears stale update notices when an update becomes available", () => {
    const initial = {
      ...createInitialState(createDefaultConfig("/tmp/gloomberb-test")),
      updateNotice: "Already on v0.3.1",
    };
    const next = appReducer(initial, {
      type: "SET_UPDATE_AVAILABLE",
      release: {
        version: "0.3.2",
        tagName: "v0.3.2",
        downloadUrl: "https://example.com/gloomberb.gz",
        publishedAt: "2026-04-03T00:00:00Z",
        updateAction: { kind: "self" },
        compressed: true,
      },
    });

    expect(next.updateAvailable?.version).toBe("0.3.2");
    expect(next.updateNotice).toBeNull();
  });
});
