import { describe, expect, test } from "bun:test";
import {
  consumeStoredChartSelectionChange,
  createStoredChartSelectionSyncState,
  markStoredChartSelectionLocallyApplied,
} from "./pane-settings";

describe("chart pane setting sync", () => {
  test("does not replay locally persisted range selections", () => {
    const state = createStoredChartSelectionSyncState("1Y", "1d");

    markStoredChartSelectionLocallyApplied(state, "5Y", "1wk");

    expect(consumeStoredChartSelectionChange(state, "5Y", "1wk")).toBe(false);
    expect(state.lastAppliedKey).toBe("5Y:1wk");
    expect(state.locallyAppliedKey).toBeNull();
  });

  test("applies external stored range selections", () => {
    const state = createStoredChartSelectionSyncState("1Y", "1d");

    expect(consumeStoredChartSelectionChange(state, "5Y", "1wk")).toBe(true);
    expect(state.lastAppliedKey).toBe("5Y:1wk");
  });
});
