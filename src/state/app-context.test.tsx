import { describe, expect, test } from "bun:test";
import { createDefaultConfig } from "../types/config";
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
});
