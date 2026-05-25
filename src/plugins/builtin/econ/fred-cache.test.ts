import { afterEach, describe, expect, test } from "bun:test";
import { MemoryPluginPersistence } from "../../../test-support/plugin-persistence";
import {
  attachEconFredPersistence,
  loadCachedFredSeries,
  resetEconFredPersistence,
  type FredSeriesCacheData,
  type FredSeriesRequest,
} from "./fred-cache";

const REQUEST: FredSeriesRequest = {
  seriesId: "CPIAUCSL",
  startDate: "2021-05-24",
  sortOrder: "asc",
};

function makeSeries(value: number): FredSeriesCacheData {
  return {
    observations: [
      { date: "2026-05-01", value },
    ],
    info: {
      id: "CPIAUCSL",
      title: "Consumer Price Index",
      units: "Index 1982-1984=100",
      frequency: "Monthly",
      seasonalAdjustment: "Seasonally Adjusted",
      source: "FRED",
      notes: "",
    },
  };
}

afterEach(() => {
  resetEconFredPersistence();
});

describe("FRED series cache", () => {
  test("rehydrates persisted series without refetching", async () => {
    const persistence = new MemoryPluginPersistence();
    attachEconFredPersistence(persistence);

    await loadCachedFredSeries(REQUEST, async () => makeSeries(320));

    resetEconFredPersistence();
    attachEconFredPersistence(persistence);

    let calls = 0;
    const cached = await loadCachedFredSeries(REQUEST, async () => {
      calls += 1;
      return makeSeries(1);
    });

    expect(calls).toBe(0);
    expect(cached.observations[0]!.value).toBe(320);
    expect(cached.info?.id).toBe("CPIAUCSL");
  });
});
