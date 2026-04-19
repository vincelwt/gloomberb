import { describe, expect, test } from "bun:test";
import { resolveFredMapping, getRelatedTickers } from "./fred-series-map";

describe("resolveFredMapping", () => {
  test("maps exact US event titles", () => {
    const m = resolveFredMapping("CPI m/m", "US");
    expect(m).not.toBeNull();
    expect(m!.seriesId).toBe("CPIAUCSL");
    expect(m!.relatedTickers).toContain("TIP");
  });

  test("case insensitive matching", () => {
    expect(resolveFredMapping("cpi m/m", "US")?.seriesId).toBe("CPIAUCSL");
    expect(resolveFredMapping("CPI M/M", "US")?.seriesId).toBe("CPIAUCSL");
  });

  test("strips prefixes for fuzzy match", () => {
    expect(resolveFredMapping("Final GDP q/q", "US")?.seriesId).toBe("GDP");
    expect(resolveFredMapping("Prelim GDP q/q", "US")?.seriesId).toBe("GDP");
    expect(resolveFredMapping("Advance GDP q/q", "US")?.seriesId).toBe("GDP");
  });

  test("returns null for non-US events", () => {
    expect(resolveFredMapping("CPI m/m", "EU")).toBeNull();
    expect(resolveFredMapping("CPI m/m", "GB")).toBeNull();
  });

  test("returns null for unmapped events", () => {
    expect(resolveFredMapping("President Trump Speaks", "US")).toBeNull();
    expect(resolveFredMapping("Bank Holiday", "US")).toBeNull();
  });

  test("maps FOMC and Fed events", () => {
    expect(resolveFredMapping("Federal Funds Rate", "US")?.seriesId).toBe("FEDFUNDS");
  });

  test("maps commodity indicators", () => {
    expect(resolveFredMapping("Crude Oil Inventories", "US")?.seriesId).toBe("WCOILWTICO");
    expect(resolveFredMapping("Natural Gas Storage", "US")?.seriesId).toBe("NATURALGAS");
  });
});

describe("getRelatedTickers", () => {
  test("returns related tickers for known events", () => {
    const tickers = getRelatedTickers("CPI m/m", "US");
    expect(tickers).toContain("TIP");
    expect(tickers).toContain("DX-Y.NYB");
  });

});
