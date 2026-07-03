import { describe, expect, test } from "bun:test";
import type { ProjectedChartPoint } from "../core/data";
import { resolveStockChartFooterOhlcReadout } from "./footer";

function point(
  close: number,
  overrides: Partial<ProjectedChartPoint> = {},
): ProjectedChartPoint {
  return {
    date: new Date("2026-07-03T10:00:00Z"),
    open: close,
    high: close,
    low: close,
    close,
    volume: 100,
    ...overrides,
  };
}

describe("stock chart footer OHLC readout", () => {
  test("summarizes the visible OHLC window for idle chart readouts", () => {
    const readout = resolveStockChartFooterOhlcReadout({
      activePoint: null,
      hasDisplayCursor: false,
      points: [
        point(100, { open: 99, high: 101, low: 98, volume: 10 }),
        point(104, { open: 100, high: 108, low: 99, volume: 20 }),
        point(106, { open: 104, high: 107, low: 103, volume: 30 }),
      ],
    });

    expect(readout).toMatchObject({
      open: 99,
      high: 108,
      low: 98,
      close: 106,
      volume: 60,
    });
    expect(readout?.changePercent).toBeCloseTo(((106 - 99) / 99) * 100);
  });

  test("uses the summary only when there is no chart cursor", () => {
    const activePoint = point(104, { open: 103, high: 105, low: 102 });
    const points = [
      point(100, { open: 99, high: 101, low: 98 }),
      point(106, { open: 104, high: 107, low: 103 }),
    ];

    const idleReadout = resolveStockChartFooterOhlcReadout({
      activePoint,
      hasDisplayCursor: false,
      points,
    });
    const cursorReadout = resolveStockChartFooterOhlcReadout({
      activePoint,
      hasDisplayCursor: true,
      points,
    });

    expect(idleReadout?.close).toBe(106);
    expect(idleReadout?.changePercent).not.toBeNull();
    expect(cursorReadout).toMatchObject(activePoint);
    expect(cursorReadout?.changePercent).toBeNull();
  });
});
