import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import type { ResolvedSeries, TimeSeriesPoint } from "../../../time-series/types";
import { testRender } from "../../../renderers/opentui/test-utils";
import {
  InputHostProvider,
  type InputHost,
  type KeyEventLike,
} from "../../../react/input";
import { CompositeChart } from "./composite-chart";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;
let chartShortcut: ((event: KeyEventLike) => void) | null = null;

const chartInputHost: InputHost = {
  useShortcut(handler) {
    chartShortcut = handler;
  },
  useViewport() {
    return { width: 80, height: 24 };
  },
};

function keyEvent(name: string): KeyEventLike {
  let defaultPrevented = false;
  let propagationStopped = false;
  return {
    key: name,
    name,
    sequence: name,
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
    get defaultPrevented() {
      return defaultPrevented;
    },
    get propagationStopped() {
      return propagationStopped;
    },
    preventDefault() {
      defaultPrevented = true;
    },
    stopPropagation() {
      propagationStopped = true;
    },
  };
}

afterEach(async () => {
  if (!testSetup) return;
  await act(async () => testSetup!.renderer.destroy());
  testSetup = undefined;
  chartShortcut = null;
});

function point(date: string, value: number): TimeSeriesPoint {
  const observedAt = new Date(`${date}T00:00:00.000Z`);
  return { date: observedAt, observedAt, value };
}

function timestampPoint(timestamp: string, value: number): TimeSeriesPoint {
  const observedAt = new Date(timestamp);
  return { date: observedAt, observedAt, value };
}

function series(id: string, panelId: string, axis: ResolvedSeries["axis"], unit: string, values: number[]): ResolvedSeries {
  return {
    id,
    label: id === "price" ? "ACME Price" : "OTHER Revenue",
    color: id === "price" ? "#00ff66" : "#ffaa00",
    unit,
    unitGroup: unit === "USD" ? "currency" : "percent",
    nativeFrequency: id === "price" ? "daily" : "quarterly",
    dataShape: "scalar",
    style: id === "price" ? "line" : "step",
    transform: "raw",
    axis,
    panelId,
    interpolation: id === "price" ? "none" : "step-after",
    points: values.map((value, index) => point(`2025-01-0${index + 1}`, value)),
  };
}

describe("CompositeChart", () => {
  test("lays out mixed panels with one shared legend and time axis", async () => {
    testSetup = await testRender(
      <CompositeChart
        width={78}
        height={18}
        series={[
          series("price", "main", "left", "USD", [100, 103, 101]),
          series("revenue", "fundamentals", "right", "%", [4, 6, 8]),
        ]}
        panels={[{ id: "main", height: 2 }, { id: "fundamentals", height: 1 }]}
        cursorDate={new Date("2025-01-02T00:00:00.000Z")}
      />,
      { width: 80, height: 20 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("2025-01-02");
    expect(frame).toContain("ACME Price");
    expect(frame).toContain("OTHER Revenue");
    expect(frame).toContain("$103");
    expect(frame.match(/2025-01-01/g)).toHaveLength(1);
    expect(frame.match(/2025-01-03/g)).toHaveLength(1);
  });

  test("moves and clears the shared cursor from the keyboard while focused", async () => {
    const cursorChanges: Array<string | null> = [];
    testSetup = await testRender(
      <InputHostProvider host={chartInputHost}>
        <CompositeChart
          width={60}
          height={12}
          focused
          series={[series("price", "main", "left", "USD", [100, 103, 101])]}
          panels={[{ id: "main" }]}
          onCursorDateChange={(date) => cursorChanges.push(date?.toISOString() ?? null)}
        />
      </InputHostProvider>,
      { width: 62, height: 14 },
    );

    await act(async () => testSetup!.renderOnce());
    await act(async () => chartShortcut?.(keyEvent("left")));
    await act(async () => testSetup!.renderOnce());
    expect(cursorChanges).toEqual(["2025-01-03T00:00:00.000Z"]);
    expect(testSetup.captureCharFrame()).toContain("2025-01-03");

    await act(async () => chartShortcut?.(keyEvent("left")));
    await act(async () => testSetup!.renderOnce());
    expect(cursorChanges).toEqual([
      "2025-01-03T00:00:00.000Z",
      "2025-01-02T00:00:00.000Z",
    ]);
    expect(testSetup.captureCharFrame()).toContain("2025-01-02");

    await act(async () => chartShortcut?.(keyEvent("escape")));
    await act(async () => testSetup!.renderOnce());
    expect(testSetup.captureCharFrame()).toContain("Latest");
  });

  test("does not emit the same snapped cursor timestamp twice", async () => {
    const cursorChanges: string[] = [];
    testSetup = await testRender(
      <InputHostProvider host={chartInputHost}>
        <CompositeChart
          width={60}
          height={12}
          focused
          series={[series("price", "main", "left", "USD", [100, 103, 101])]}
          panels={[{ id: "main" }]}
          onCursorDateChange={(date) => {
            if (date) cursorChanges.push(date.toISOString());
          }}
        />
      </InputHostProvider>,
      { width: 62, height: 14 },
    );

    await act(async () => testSetup!.renderOnce());
    await act(async () => chartShortcut?.(keyEvent("right")));
    await act(async () => chartShortcut?.(keyEvent("left")));

    expect(cursorChanges).toEqual(["2025-01-01T00:00:00.000Z"]);
  });

  test("zooms with plus and resets the interaction viewport with zero", async () => {
    testSetup = await testRender(
      <InputHostProvider host={chartInputHost}>
        <CompositeChart
          width={60}
          height={12}
          focused
          series={[series("price", "main", "left", "USD", [100, 101, 102, 103, 104, 105, 106, 107, 108])]}
          panels={[{ id: "main" }]}
          viewport={{
            start: new Date("2025-01-01T00:00:00.000Z"),
            end: new Date("2025-01-09T00:00:00.000Z"),
          }}
        />
      </InputHostProvider>,
      { width: 62, height: 14 },
    );

    await act(async () => testSetup!.renderOnce());
    expect(testSetup.captureCharFrame()).toContain("2025-01-01");

    const zoomIn = keyEvent("=");
    zoomIn.sequence = "+";
    zoomIn.shift = true;
    await act(async () => chartShortcut?.(zoomIn));
    await act(async () => testSetup!.renderOnce());

    expect(zoomIn.defaultPrevented).toBe(true);
    expect(testSetup.captureCharFrame()).not.toContain("2025-01-01");

    await act(async () => chartShortcut?.(keyEvent("0")));
    await act(async () => testSetup!.renderOnce());
    expect(testSetup.captureCharFrame()).toContain("2025-01-01");
  });

  test("shows useful UTC times for an intraday shared cursor and time axis", async () => {
    const intraday = {
      ...series("price", "main", "left", "USD", []),
      points: [
        timestampPoint("2025-01-02T09:30:00.000Z", 100),
        timestampPoint("2025-01-02T12:05:00.000Z", 103),
        timestampPoint("2025-01-02T16:00:00.000Z", 101),
      ],
    };
    testSetup = await testRender(
      <CompositeChart
        width={78}
        height={12}
        series={[intraday]}
        panels={[{ id: "main" }]}
        cursorDate={new Date("2025-01-02T12:05:00.000Z")}
      />,
      { width: 80, height: 14 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("2025-01-02 12:05 UTC");
    expect(frame).toContain("09:30 UTC");
    expect(frame).toContain("16:00 UTC");
  });
});
