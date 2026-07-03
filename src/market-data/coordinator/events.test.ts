import { describe, expect, test } from "bun:test";
import { MarketDataCoordinatorEvents } from "./events";

const waitMicrotask = () => Promise.resolve();
const waitTimer = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("MarketDataCoordinatorEvents", () => {
  test("coalesces version bumps before notifying external-store listeners", async () => {
    const events = new MarketDataCoordinatorEvents();
    const calls: number[] = [];
    events.subscribeKeys(["quote:AMD"], () => {
      calls.push(events.getKeysVersion(["quote:AMD"]));
    });

    events.bump("quote:AMD");
    events.bump("quote:AMD");

    expect(events.getKeysVersion(["quote:AMD"])).toBe(0);
    expect(calls).toEqual([]);

    await waitMicrotask();
    expect(events.getKeysVersion(["quote:AMD"])).toBe(1);
    expect(calls).toEqual([]);

    await waitTimer();
    expect(calls).toEqual([1]);
  });

  test("delivers bumps scheduled during notification in a later notification pass", async () => {
    const events = new MarketDataCoordinatorEvents();
    const order: string[] = [];
    events.subscribeKeys(["quote:AMD"], () => {
      order.push("AMD");
      events.bump("quote:NVDA");
    });
    events.subscribeKeys(["quote:NVDA"], () => {
      order.push("NVDA");
    });

    events.bump("quote:AMD");
    await waitMicrotask();
    await waitTimer();
    expect(order).toEqual(["AMD"]);

    await waitMicrotask();
    await waitTimer();
    expect(order).toEqual(["AMD", "NVDA"]);
  });
});
