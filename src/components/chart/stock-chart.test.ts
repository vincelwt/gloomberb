import { describe, expect, test } from "bun:test";
import type { BoxRenderable, CliRenderer } from "@opentui/core";
import {
  getLocalPlotPointer,
  projectCellCursorToLocalPixels,
  resolveAutoDisplayState,
  resolveAutoZoomWindow,
  resolveAdjacentSelectionCursorX,
  resolveVisibleChartDateWindow,
  resolveSelectionDisplayCursorState,
} from "./stock-chart";
import { getPointTerminalColumn } from "./chart-renderer";

const renderer = {
  resolution: { width: 1200, height: 800 },
  terminalWidth: 120,
  terminalHeight: 40,
} as Pick<CliRenderer, "resolution" | "terminalWidth" | "terminalHeight">;

const renderable = {
  x: 10,
  y: 5,
  width: 40,
  height: 12,
} as BoxRenderable;

function makeDailyHistory(startDay: number, length: number) {
  return Array.from({ length }, (_, index) => ({
    date: new Date(Date.UTC(2026, 0, startDay + index)),
    close: 100 + index,
  }));
}

describe("stock chart pointer helpers", () => {
  test("returns both cell and pixel coordinates when pixel mouse is available", () => {
    const pointer = getLocalPlotPointer({
      x: 24,
      y: 10,
      pixelX: 245,
      pixelY: 205,
      modifiers: { shift: false, alt: false, ctrl: false },
    }, renderable, renderer);

    expect(pointer).not.toBeNull();
    expect(pointer).toMatchObject({
      hasPixelPrecision: true,
      pixelX: 145,
      pixelY: 105,
    });
    expect(pointer!.cellX).toBeCloseTo(14.17, 2);
    expect(pointer!.cellY).toBeCloseTo(4.83, 2);
  });

  test("returns null pixel coordinates when only cell mouse data exists", () => {
    const pointer = getLocalPlotPointer({
      x: 24,
      y: 10,
      modifiers: { shift: false, alt: false, ctrl: false },
    }, renderable, renderer);

    expect(pointer).toEqual({
      cellX: 14,
      cellY: 5,
      pixelX: null,
      pixelY: null,
      hasPixelPrecision: false,
    });
  });

  test("can derive local pixels from cell coordinates for non-pixel fallbacks", () => {
    const pixels = projectCellCursorToLocalPixels(14, 5, renderable, renderer);

    expect(pixels).not.toBeNull();
    expect(pixels!.pixelX).toBeCloseTo(143.23, 2);
    expect(pixels!.pixelY).toBeCloseTo(108.64, 2);
  });

  test("keeps a visible display cursor for keyboard selection when only cursorX is explicit", () => {
    const cursor = resolveSelectionDisplayCursorState(14, null, 14, 5, renderable, renderer);

    expect(cursor).toMatchObject({
      cellX: 14,
      cellY: 5,
    });
    expect(cursor.pixelX).toBeCloseTo(143.23, 2);
    expect(cursor.pixelY).toBeCloseTo(108.64, 2);
  });

  test("prefers the explicit selection cursorY over the derived fallback", () => {
    const cursor = resolveSelectionDisplayCursorState(14, 3, 17, 5, renderable, renderer);

    expect(cursor).toMatchObject({
      cellX: 14,
      cellY: 3,
    });
    expect(cursor.pixelY).toBeCloseTo(65.18, 2);
  });

  test("can snap keyboard display cursor x to the active chart point", () => {
    const cursor = resolveSelectionDisplayCursorState(14, null, 17, 5, renderable, renderer);

    expect(cursor).toMatchObject({
      cellX: 17,
      cellY: 5,
    });
  });

  test("moves keyboard selection between snapped chart points", () => {
    const width = 40;
    const pointCount = 20;
    const rightmost = getPointTerminalColumn(pointCount - 1, pointCount, width, "candles");
    const previous = getPointTerminalColumn(pointCount - 2, pointCount, width, "candles");

    expect(resolveAdjacentSelectionCursorX(width - 1, -1, pointCount, width, "candles")).toBe(previous);
    expect(resolveAdjacentSelectionCursorX(previous, 1, pointCount, width, "candles")).toBe(rightmost);
  });
});

describe("stock chart auto helpers", () => {
  test("keeps planned auto data and the visible window in sync once fresh data is ready", () => {
    const renderedAutoView = {
      window: {
        start: new Date("2026-01-01T00:00:00Z"),
        end: new Date("2026-01-08T00:00:00Z"),
      },
      resolution: "1d" as const,
      data: [{
        date: new Date("2026-01-02T00:00:00Z"),
        close: 101,
      }],
    };
    const plannedBodyState = {
      data: [{
        date: new Date("2026-01-09T00:00:00Z"),
        close: 102,
      }],
      blocking: false,
      updating: false,
      emptyMessage: null,
      errorMessage: null,
    };
    const plannedWindow = {
      start: new Date("2026-01-09T00:00:00Z"),
      end: new Date("2026-01-10T00:00:00Z"),
    };

    const nextState = resolveAutoDisplayState({
      shouldUseRenderedAutoView: false,
      renderedAutoView,
      isRenderedAutoViewUpdating: false,
      plannedRenderBodyState: plannedBodyState,
      plannedResolvedManualResolution: "1h",
      plannedDateWindow: plannedWindow,
    });

    expect(nextState.bodyState).toBe(plannedBodyState);
    expect(nextState.resolution).toBe("1h");
    expect(nextState.window).toEqual(plannedWindow);
  });

  test("keeps showing the committed auto view while a replacement is still pending", () => {
    const renderedAutoView = {
      window: {
        start: new Date("2026-01-01T00:00:00Z"),
        end: new Date("2026-01-08T00:00:00Z"),
      },
      resolution: "1d" as const,
      data: [{
        date: new Date("2026-01-02T00:00:00Z"),
        close: 101,
      }],
    };
    const plannedBodyState = {
      data: null,
      blocking: true,
      updating: false,
      emptyMessage: null,
      errorMessage: null,
    };

    const nextState = resolveAutoDisplayState({
      shouldUseRenderedAutoView: true,
      renderedAutoView,
      isRenderedAutoViewUpdating: true,
      plannedRenderBodyState: plannedBodyState,
      plannedResolvedManualResolution: "1h",
      plannedDateWindow: {
        start: new Date("2026-01-09T00:00:00Z"),
        end: new Date("2026-01-10T00:00:00Z"),
      },
    });

    expect(nextState.bodyState).toEqual({
      data: renderedAutoView.data,
      blocking: false,
      updating: true,
      emptyMessage: null,
      errorMessage: null,
    });
    expect(nextState.resolution).toBe("1d");
    expect(nextState.window).toEqual(renderedAutoView.window);
  });

  test("derives the visible label window from the actual visible chart points", () => {
    const visibleWindow = resolveVisibleChartDateWindow([
      { date: new Date("2026-01-03T00:00:00Z") },
      { date: new Date("2026-01-06T00:00:00Z") },
    ], {
      start: new Date("2026-01-01T00:00:00Z"),
      end: new Date("2026-01-08T00:00:00Z"),
    });

    expect(visibleWindow).toEqual({
      start: new Date("2026-01-03T00:00:00Z"),
      end: new Date("2026-01-06T00:00:00Z"),
    });
  });

  test("zooms in by at least one visible point on every auto step when more detail is available", () => {
    const history = makeDailyHistory(1, 10);

    const nextWindow = resolveAutoZoomWindow({
      historyPoints: history,
      boundsDates: history.map((point) => point.date),
      currentWindow: {
        start: new Date("2026-01-06T00:00:00Z"),
        end: new Date("2026-01-10T00:00:00Z"),
      },
      direction: "in",
      anchorRatio: 1,
    });

    expect(nextWindow).toEqual({
      start: new Date("2026-01-08T00:00:00Z"),
      end: new Date("2026-01-10T00:00:00Z"),
    });
  });

  test("zooms out into broader bounds data even when the current rendered history is already fully visible", () => {
    const history = makeDailyHistory(8, 3);
    const boundsDates = makeDailyHistory(1, 10).map((point) => point.date);

    const nextWindow = resolveAutoZoomWindow({
      historyPoints: history,
      boundsDates,
      currentWindow: {
        start: new Date("2026-01-08T00:00:00Z"),
        end: new Date("2026-01-10T00:00:00Z"),
      },
      direction: "out",
      anchorRatio: 1,
    });

    expect(nextWindow).toEqual({
      start: new Date("2026-01-06T00:00:00Z"),
      end: new Date("2026-01-10T00:00:00Z"),
    });
  });

  test("zooms out beyond the currently loaded bounds so auto can request a wider buffer", () => {
    const history = makeDailyHistory(1, 10);
    const boundsDates = history.map((point) => point.date);

    const nextWindow = resolveAutoZoomWindow({
      historyPoints: history,
      boundsDates,
      currentWindow: {
        start: new Date("2026-01-01T00:00:00Z"),
        end: new Date("2026-01-10T00:00:00Z"),
      },
      direction: "out",
      anchorRatio: 1,
    });

    expect(nextWindow?.start?.getTime()).toBeLessThan(boundsDates[0]!.getTime());
    expect(nextWindow).toEqual({
      start: new Date("2025-12-27T00:00:00.000Z"),
      end: new Date("2026-01-10T00:00:00.000Z"),
    });
  });

  test("stops auto zooming in once only two visible points remain", () => {
    const history = makeDailyHistory(1, 10);

    const nextWindow = resolveAutoZoomWindow({
      historyPoints: history,
      boundsDates: history.map((point) => point.date),
      currentWindow: {
        start: new Date("2026-01-09T00:00:00Z"),
        end: new Date("2026-01-10T00:00:00Z"),
      },
      direction: "in",
      anchorRatio: 1,
    });

    expect(nextWindow).toEqual({
      start: new Date("2026-01-09T00:00:00Z"),
      end: new Date("2026-01-10T00:00:00Z"),
    });
  });
});
