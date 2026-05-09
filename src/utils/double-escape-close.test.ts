import { describe, expect, test } from "bun:test";
import {
  createDoubleEscapeCloseState,
  recordDoubleEscapeClose,
  resetDoubleEscapeClose,
} from "./double-escape-close";

describe("double escape close detector", () => {
  test("matches a second escape for the same target inside the threshold", () => {
    const state = createDoubleEscapeCloseState();

    expect(recordDoubleEscapeClose(state, "pane:a", 1000)).toBe(false);
    expect(recordDoubleEscapeClose(state, "pane:a", 1200)).toBe(true);
    expect(state.targetId).toBe(null);
  });

  test("requires the same target and a recent first escape", () => {
    const state = createDoubleEscapeCloseState();

    expect(recordDoubleEscapeClose(state, "pane:a", 1000)).toBe(false);
    expect(recordDoubleEscapeClose(state, "pane:b", 1100)).toBe(false);
    expect(recordDoubleEscapeClose(state, "pane:b", 2000)).toBe(false);
    expect(recordDoubleEscapeClose(state, "pane:b", 2100)).toBe(true);
  });

  test("can be reset by non-escape input", () => {
    const state = createDoubleEscapeCloseState();

    expect(recordDoubleEscapeClose(state, "pane:a", 1000)).toBe(false);
    resetDoubleEscapeClose(state);
    expect(recordDoubleEscapeClose(state, "pane:a", 1100)).toBe(false);
  });
});
