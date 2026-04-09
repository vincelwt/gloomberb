import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { TickerBadgeText } from "./ticker-badge-text";
import type { InlineTickerCatalogEntry } from "../state/use-inline-tickers";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
});

function makeCatalogEntry(overrides?: Partial<InlineTickerCatalogEntry>): InlineTickerCatalogEntry {
  return {
    status: "ready",
    ticker: null,
    quote: {
      symbol: "TSLA",
      price: 250,
      currency: "USD",
      change: -12.5,
      changePercent: -5,
      lastUpdated: Date.now(),
    },
    ...overrides,
  };
}

describe("TickerBadgeText", () => {
  test("renders live ticker badges when quote data exists", async () => {
    testSetup = await testRender(
      <TickerBadgeText
        text="Watching $TSLA now"
        lineWidth={40}
        catalog={{ TSLA: makeCatalogEntry() }}
        textColor="#ffffff"
        openTicker={() => {}}
      />,
      { width: 40, height: 4 },
    );

    await testSetup.renderOnce();

    expect(testSetup.captureCharFrame()).toContain("TSLA -5%");
  });

  test("falls back to the raw token when resolution failed", async () => {
    testSetup = await testRender(
      <TickerBadgeText
        text="Watching $TSLA now"
        lineWidth={40}
        catalog={{ TSLA: makeCatalogEntry({ status: "missing", quote: null }) }}
        textColor="#ffffff"
        openTicker={() => {}}
      />,
      { width: 40, height: 4 },
    );

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("$TSLA");
    expect(frame).not.toContain("TSLA -5%");
  });

  test("opens the ticker detail pane when a badge is clicked", async () => {
    const opened: string[] = [];
    testSetup = await testRender(
      <TickerBadgeText
        text="Watching $TSLA now"
        lineWidth={40}
        catalog={{ TSLA: makeCatalogEntry() }}
        textColor="#ffffff"
        openTicker={(symbol) => opened.push(symbol)}
      />,
      { width: 40, height: 4 },
    );

    await testSetup.renderOnce();

    const lines = testSetup.captureCharFrame().split("\n");
    const row = lines.findIndex((line) => line.includes("TSLA -5%"));
    const col = lines[row]?.indexOf("TSLA -5%") ?? -1;

    expect(row).toBeGreaterThanOrEqual(0);
    expect(col).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(col + 1, row);
      await testSetup!.renderOnce();
    });

    expect(opened).toEqual(["TSLA"]);
  });

  test("renders inline links alongside ticker badges", async () => {
    testSetup = await testRender(
      <TickerBadgeText
        text="Read https://example.com while watching $TSLA"
        lineWidth={60}
        catalog={{ TSLA: makeCatalogEntry() }}
        textColor="#ffffff"
        openTicker={() => {}}
      />,
      { width: 60, height: 4 },
    );

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("https://example.com");
    expect(frame).toContain("TSLA -5%");
  });

  test("opens detected links without trailing punctuation when clicked", async () => {
    const opened: string[] = [];
    testSetup = await testRender(
      <TickerBadgeText
        text="Read https://example.com/story."
        lineWidth={60}
        catalog={{}}
        textColor="#ffffff"
        openTicker={() => {}}
        openLink={(url) => opened.push(url)}
      />,
      { width: 60, height: 4 },
    );

    await testSetup.renderOnce();

    const lines = testSetup.captureCharFrame().split("\n");
    const row = lines.findIndex((line) => line.includes("https://example.com/story."));
    const col = lines[row]?.indexOf("https://example.com/story") ?? -1;

    expect(row).toBeGreaterThanOrEqual(0);
    expect(col).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(col + 1, row);
      await testSetup!.renderOnce();
    });

    expect(opened).toEqual(["https://example.com/story"]);
  });

  test("shows the current price when the badge is hovered", async () => {
    testSetup = await testRender(
      <TickerBadgeText
        text="Watching $TSLA now"
        lineWidth={40}
        catalog={{ TSLA: makeCatalogEntry() }}
        textColor="#ffffff"
        openTicker={() => {}}
      />,
      { width: 40, height: 4 },
    );

    await testSetup.renderOnce();

    const lines = testSetup.captureCharFrame().split("\n");
    const row = lines.findIndex((line) => line.includes("TSLA -5%"));
    const col = lines[row]?.indexOf("TSLA -5%") ?? -1;

    expect(row).toBeGreaterThanOrEqual(0);
    expect(col).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.moveTo(col + 1, row);
      await testSetup!.renderOnce();
    });

    expect(testSetup.captureCharFrame()).toContain("TSLA $250.00");
  });

  test("restores the change label when the mouse leaves the badge", async () => {
    testSetup = await testRender(
      <TickerBadgeText
        text="Watching $TSLA now"
        lineWidth={40}
        catalog={{ TSLA: makeCatalogEntry() }}
        textColor="#ffffff"
        openTicker={() => {}}
      />,
      { width: 40, height: 4 },
    );

    await testSetup.renderOnce();

    const lines = testSetup.captureCharFrame().split("\n");
    const row = lines.findIndex((line) => line.includes("TSLA -5%"));
    const col = lines[row]?.indexOf("TSLA -5%") ?? -1;

    expect(row).toBeGreaterThanOrEqual(0);
    expect(col).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.moveTo(col + 1, row);
      await testSetup!.renderOnce();
      await testSetup!.mockMouse.moveTo(0, 3);
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("TSLA -5%");
    expect(frame).not.toContain("TSLA $250.00");
  });
});
