import { describe, expect, test } from "bun:test";
import { shouldDeliverShortcut, type KeyEventLike } from "./input";

function keyEvent(overrides: Partial<KeyEventLike> = {}): KeyEventLike {
  return {
    key: "k",
    name: "k",
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
    preventDefault: () => {},
    stopPropagation: () => {},
    ...overrides,
  };
}

describe("shouldDeliverShortcut", () => {
  test("keeps plain app shortcuts out of editable targets by default", () => {
    expect(shouldDeliverShortcut(keyEvent({ targetEditable: true }), false)).toBe(false);
    expect(shouldDeliverShortcut(keyEvent({ targetEditable: true, name: "down" }), false)).toBe(false);
  });

  test("allows explicit editable handlers and system shortcuts", () => {
    expect(shouldDeliverShortcut(keyEvent({ targetEditable: true }), true)).toBe(true);
    expect(shouldDeliverShortcut(keyEvent({ targetEditable: true, ctrl: true }), false)).toBe(true);
    expect(shouldDeliverShortcut(keyEvent({ targetEditable: true, meta: true }), false)).toBe(true);
  });
});
