import { describe, expect, test } from "bun:test";
import { resetTerminalInputState, TERMINAL_MOUSE_RESET_SEQUENCE } from "./terminal-input-reset";

describe("resetTerminalInputState", () => {
  test("disables mouse tracking and exits raw mode before renderer startup", () => {
    const writes: string[] = [];
    const rawModeCalls: boolean[] = [];

    resetTerminalInputState(
      {
        isTTY: true,
        setRawMode(mode: boolean) {
          rawModeCalls.push(mode);
        },
      },
      {
        isTTY: true,
        write(chunk: string) {
          writes.push(chunk);
        },
      },
    );

    expect(writes).toEqual([TERMINAL_MOUSE_RESET_SEQUENCE]);
    expect(rawModeCalls).toEqual([false]);
  });

  test("does not write terminal escapes when stdout is not a tty", () => {
    const writes: string[] = [];
    const rawModeCalls: boolean[] = [];

    resetTerminalInputState(
      {
        isTTY: true,
        setRawMode(mode: boolean) {
          rawModeCalls.push(mode);
        },
      },
      {
        isTTY: false,
        write(chunk: string) {
          writes.push(chunk);
        },
      },
    );

    expect(writes).toEqual([]);
    expect(rawModeCalls).toEqual([false]);
  });
});
