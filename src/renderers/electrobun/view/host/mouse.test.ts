import { describe, expect, test } from "bun:test";
import { hasDirectMouseHandler, mouseHandlers } from "./mouse";

function fakeMouseEvent() {
  return {
    clientX: 16,
    clientY: 36,
    button: 0,
    detail: 0,
    timeStamp: 1,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    preventDefault() {},
    stopPropagation() {},
  };
}

describe("desktop web mouse host", () => {
  test("forwards mouse over handlers", () => {
    let cellX = -1;
    let cellY = -1;
    const handlers = mouseHandlers({
      onMouseOver: (event: { x: number; y: number }) => {
        cellX = event.x;
        cellY = event.y;
      },
    });

    handlers.onMouseOver?.(fakeMouseEvent() as never);

    expect(cellX).toBe(2);
    expect(cellY).toBe(2);
    expect(hasDirectMouseHandler({ onMouseOver: () => {} })).toBe(true);
  });
});
