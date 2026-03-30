import { describe, expect, test } from "bun:test";
import { TickerRefreshQueue } from "./ticker-refresh-queue";

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("TickerRefreshQueue", () => {
  test("holds pending work while paused", async () => {
    const queue = new TickerRefreshQueue(1);
    const started: string[] = [];
    let releaseFirst: (() => void) | undefined;

    queue.enqueue({
      key: "first",
      priority: 0,
      run: async () => {
        started.push("first");
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      },
    });

    queue.enqueue({
      key: "second",
      priority: 1,
      run: async () => {
        started.push("second");
      },
    });

    await nextTick();
    expect(started).toEqual(["first"]);

    queue.setPaused(true);
    if (!releaseFirst) throw new Error("expected first task to be running");
    releaseFirst();
    await nextTick();
    expect(started).toEqual(["first"]);

    queue.setPaused(false);
    await nextTick();
    expect(started).toEqual(["first", "second"]);
  });
});
