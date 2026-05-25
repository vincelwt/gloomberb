import { afterEach, describe, expect, test } from "bun:test";
import { MemoryPluginPersistence } from "../../../test-support/plugin-persistence";
import type { EconEvent } from "./types";
import {
  attachEconCalendarPersistence,
  loadCalendar,
  resetEconCalendarPersistence,
} from "./calendar-model";

function makeEvent(id: string): EconEvent {
  return {
    id,
    date: new Date("2026-05-24T13:30:00.000Z"),
    time: "08:30",
    country: "US",
    event: "Core PCE Price Index",
    impact: "high",
    actual: null,
    forecast: "0.3%",
    prior: "0.2%",
  };
}

afterEach(() => {
  resetEconCalendarPersistence();
});

describe("econ calendar cache", () => {
  test("rehydrates persisted events without refetching", async () => {
    const persistence = new MemoryPluginPersistence();
    attachEconCalendarPersistence(persistence);

    await loadCalendar(false, async () => [makeEvent("pce")]);

    resetEconCalendarPersistence();
    attachEconCalendarPersistence(persistence);

    let calls = 0;
    const events = await loadCalendar(false, async () => {
      calls += 1;
      return [makeEvent("fallback")];
    });

    expect(calls).toBe(0);
    expect(events.map((event) => event.id)).toEqual(["pce"]);
    expect(events[0]!.date).toBeInstanceOf(Date);
  });
});
