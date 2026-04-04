import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import {
  Harness,
  MemoryPersistence,
  PREDICTION_CACHE_POLICIES,
  TEST_PANE_ID,
  cleanupPredictionTest,
  emitKeypress,
  flushFrames,
  harnessStateRef,
  installPredictionMarketMocks,
} from "./test-helpers";
import { attachPredictionMarketsPersistence } from "./services/fetch";
import {
  loadKalshiCatalog,
  normalizeKalshiMarket,
} from "./services/kalshi-adapter";
import { normalizePolymarketMarket } from "./services/polymarket-adapter";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(async () => {
  await cleanupPredictionTest(testSetup);
  testSetup = undefined;
});

describe("prediction markets pane interactions", () => {
  test("renders cached catalogs immediately on reopen", async () => {
    const persistence = new MemoryPersistence();
    attachPredictionMarketsPersistence(persistence);

    const cachedPolymarket = normalizePolymarketMarket({
      id: "pm-1",
      question: "Will inflation fall?",
      conditionId: "cond-1",
      outcomes: '["Yes","No"]',
      outcomePrices: '["0.62","0.38"]',
      clobTokenIds: '["yes-1","no-1"]',
      volume24hr: 250000,
      events: [
        {
          id: "event-1",
          title: "US inflation",
          openInterest: 12,
          tags: [{ label: "Macro" }],
        } as any,
      ],
    } as any);
    const cachedKalshi = normalizeKalshiMarket({
      ticker: "KAL-1",
      title: "Will the Fed cut rates?",
      yes_sub_title: "Yes",
      event_ticker: "FED-1",
      status: "open",
      market_type: "binary",
      last_price_dollars: "0.48",
      volume_24h_fp: "15000",
    } as any);

    persistence.setResource(
      "catalog",
      "polymarket:all:all",
      [cachedPolymarket].filter(Boolean),
      { cachePolicy: PREDICTION_CACHE_POLICIES.catalog, sourceKey: "remote" },
    );
    persistence.setResource(
      "catalog",
      "kalshi:all:all",
      [cachedKalshi].filter(Boolean),
      { cachePolicy: PREDICTION_CACHE_POLICIES.catalog, sourceKey: "remote" },
    );

    globalThis.fetch = (async () =>
      new Response("{}", { status: 500 })) as unknown as typeof fetch;

    testSetup = await testRender(<Harness />, { width: 120, height: 34 });
    await flushFrames(testSetup);

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Will inflation fall?");
    expect(frame).toContain("Will the Fed cut rates?");
  });

  test("renders the merged market browser and supports venue switching", async () => {
    installPredictionMarketMocks();

    testSetup = await testRender(<Harness />, { width: 120, height: 34 });
    await flushFrames(testSetup);

    let frame = testSetup.captureCharFrame();
    expect(frame).toContain("All venues");
    expect(frame).not.toContain("VOL = native venue units");
    expect(frame).toContain("Will inflation fall?");
    expect(frame).toContain("Kalshi");

    const lines = frame.split("\n");
    const kalshiRow = lines.findIndex((line) =>
      line.includes("Will the Fed cut rates?"),
    );
    const kalshiCol = lines[kalshiRow]?.indexOf("Will the Fed cut rates?") ?? -1;

    await act(async () => {
      await testSetup!.mockMouse.click(kalshiCol + 1, kalshiRow);
      await testSetup!.renderOnce();
    });
    await flushFrames(testSetup);

    expect(
      harnessStateRef.current?.paneState[TEST_PANE_ID]?.pluginState?.[
        "prediction-markets"
      ]?.selectedRowKey,
    ).toBe("kalshi:KAL-1");

    frame = testSetup.captureCharFrame();
    expect(frame).toContain("Will the Fed cut rates?");
    expect(frame).toContain("Kalshi primary rule");
  });

  test("loads selected detail once instead of refetching in a render loop", async () => {
    const { fetchUrls } = installPredictionMarketMocks();

    testSetup = await testRender(<Harness />, { width: 120, height: 34 });
    await flushFrames(testSetup);

    const frame = testSetup.captureCharFrame();
    const lines = frame.split("\n");
    const kalshiRow = lines.findIndex((line) =>
      line.includes("Will the Fed cut rates?"),
    );
    const kalshiCol = lines[kalshiRow]?.indexOf("Will the Fed cut rates?") ?? -1;

    await act(async () => {
      await testSetup!.mockMouse.click(kalshiCol + 1, kalshiRow);
      await testSetup!.renderOnce();
    });
    await flushFrames(testSetup, 8);

    const eventFetches = fetchUrls.filter((url) =>
      url.includes("/trade-api/v2/events/FED-1"),
    );
    const orderbookFetches = fetchUrls.filter((url) =>
      url.includes("/trade-api/v2/markets/KAL-1/orderbook"),
    );
    const tradeFetches = fetchUrls.filter((url) =>
      url.includes("/trade-api/v2/markets/trades?ticker=KAL-1"),
    );
    const historyFetches = fetchUrls.filter((url) =>
      url.includes("/trade-api/v2/series/FED/markets/KAL-1/candlesticks"),
    );

    expect(eventFetches).toHaveLength(2);
    expect(orderbookFetches).toHaveLength(1);
    expect(tradeFetches).toHaveLength(1);
    expect(historyFetches).toHaveLength(1);
    expect(testSetup.captureCharFrame()).not.toContain("Loading market detail...");
  });

  test("moves selection through the list with keyboard navigation", async () => {
    installPredictionMarketMocks();

    testSetup = await testRender(<Harness />, { width: 120, height: 34 });
    await flushFrames(testSetup);

    await emitKeypress(testSetup, { name: "j", sequence: "j" });
    await flushFrames(testSetup);
    expect(
      harnessStateRef.current?.paneState[TEST_PANE_ID]?.pluginState?.[
        "prediction-markets"
      ]?.selectedRowKey,
    ).not.toBeNull();

    await emitKeypress(testSetup, { name: "j", sequence: "j" });
    await flushFrames(testSetup);

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Will the Fed cut rates?");
  });

  test("does not wrap to the last row when moving up without a selection", async () => {
    installPredictionMarketMocks();

    testSetup = await testRender(<Harness />, { width: 120, height: 34 });
    await flushFrames(testSetup);

    await emitKeypress(testSetup, {
      name: "up",
      sequence: "\u001b[A",
    });
    await flushFrames(testSetup);

    expect(
      harnessStateRef.current?.paneState[TEST_PANE_ID]?.pluginState?.[
        "prediction-markets"
      ]?.selectedRowKey,
    ).toBe("polymarket:pm-1");
  });

  test("supports detail outcome navigation and escape focus return from the keyboard", async () => {
    attachPredictionMarketsPersistence(new MemoryPersistence());

    globalThis.fetch = (async (input: Request | string | URL) => {
      const url = String(input);
      if (url.includes("gamma-api.polymarket.com/events?")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes("/trade-api/v2/events?")) {
        return new Response(
          JSON.stringify({
            events: [
              {
                title: "Federal funds target rate after April 2026 FOMC",
                sub_title: "Upper bound",
                category: "Economics",
                event_ticker: "FED-1",
                series_ticker: "FED",
                markets: [
                  {
                    ticker: "KXFED-27APR-T4.25",
                    title:
                      "Will the upper bound of the federal funds target rate be above 4.25%?",
                    yes_sub_title: "Above 4.25%",
                    event_ticker: "FED-1",
                    status: "open",
                    market_type: "binary",
                    last_price_dollars: "0.48",
                    volume_24h_fp: "15000",
                    volume_fp: "90000",
                    open_interest_fp: "45000",
                    liquidity_dollars: "250000",
                    rules_primary: "Rule 1",
                  },
                  {
                    ticker: "KXFED-27APR-T4.50",
                    title:
                      "Will the upper bound of the federal funds target rate be above 4.50%?",
                    yes_sub_title: "Above 4.50%",
                    event_ticker: "FED-1",
                    status: "open",
                    market_type: "binary",
                    last_price_dollars: "0.31",
                    volume_24h_fp: "12000",
                    volume_fp: "70000",
                    open_interest_fp: "35000",
                    liquidity_dollars: "190000",
                    rules_primary: "Rule 2",
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/trade-api/v2/events/FED-1")) {
        return new Response(
          JSON.stringify({
            event: {
              title: "Federal funds target rate after April 2026 FOMC",
              sub_title: "Upper bound",
              category: "Economics",
              event_ticker: "FED-1",
              series_ticker: "FED",
            },
            markets: [
              {
                ticker: "KXFED-27APR-T4.25",
                title:
                  "Will the upper bound of the federal funds target rate be above 4.25%?",
                yes_sub_title: "Above 4.25%",
                event_ticker: "FED-1",
                status: "open",
                market_type: "binary",
                last_price_dollars: "0.48",
                volume_24h_fp: "15000",
                rules_primary: "Rule 1",
              },
              {
                ticker: "KXFED-27APR-T4.50",
                title:
                  "Will the upper bound of the federal funds target rate be above 4.50%?",
                yes_sub_title: "Above 4.50%",
                event_ticker: "FED-1",
                status: "open",
                market_type: "binary",
                last_price_dollars: "0.31",
                volume_24h_fp: "12000",
                rules_primary: "Rule 2",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/trade-api/v2/series/FED/markets/")) {
        return new Response(JSON.stringify({ candlesticks: [] }), {
          status: 200,
        });
      }
      if (url.includes("/trade-api/v2/markets/")) {
        return new Response(
          JSON.stringify({ orderbook_fp: { yes_dollars: [], no_dollars: [] } }),
          { status: 200 },
        );
      }
      if (url.includes("/trade-api/v2/markets/trades?ticker=")) {
        return new Response(JSON.stringify({ trades: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;

    testSetup = await testRender(<Harness />, { width: 120, height: 34 });
    await flushFrames(testSetup);

    await emitKeypress(testSetup, { name: "j", sequence: "j" });
    await flushFrames(testSetup);
    await emitKeypress(testSetup, { name: "enter", sequence: "\r" });
    await flushFrames(testSetup);
    await emitKeypress(testSetup, { name: "down", sequence: "\u001b[B" });
    await flushFrames(testSetup);

    expect(
      harnessStateRef.current?.paneState[TEST_PANE_ID]?.pluginState?.[
        "prediction-markets"
      ]?.selectedDetailMarketKey,
    ).toBe("kalshi:KXFED-27APR-T4.50");

    await emitKeypress(testSetup, { name: "esc", sequence: "\u001b" });
    await flushFrames(testSetup);

    expect(
      harnessStateRef.current?.paneState[TEST_PANE_ID]?.pluginState?.[
        "prediction-markets"
      ]?.focusRegion,
    ).toBe("list");
  });

  test("starts with no detail pane and toggles the detail pane off on repeat selection", async () => {
    installPredictionMarketMocks();

    testSetup = await testRender(<Harness />, { width: 120, height: 34 });
    await flushFrames(testSetup);

    const frame = testSetup.captureCharFrame();
    const lines = frame.split("\n");
    const kalshiRow = lines.findIndex((line) =>
      line.includes("Will the Fed cut rates?"),
    );
    const kalshiCol = lines[kalshiRow]?.indexOf("Will the Fed cut rates?") ?? -1;

    await act(async () => {
      await testSetup!.mockMouse.click(kalshiCol + 1, kalshiRow);
      await testSetup!.renderOnce();
    });
    await flushFrames(testSetup);

    await act(async () => {
      await testSetup!.mockMouse.click(kalshiCol + 1, kalshiRow);
      await testSetup!.renderOnce();
    });
    await flushFrames(testSetup);

    expect(
      harnessStateRef.current?.paneState[TEST_PANE_ID]?.pluginState?.[
        "prediction-markets"
      ]?.selectedRowKey,
    ).toBeNull();
  });

  test("resizes the list/detail split by dragging the divider", async () => {
    installPredictionMarketMocks();

    testSetup = await testRender(<Harness />, { width: 120, height: 34 });
    await flushFrames(testSetup);

    let frame = testSetup.captureCharFrame();
    const lines = frame.split("\n");
    const kalshiRow = lines.findIndex((line) =>
      line.includes("Will the Fed cut rates?"),
    );
    const kalshiCol = lines[kalshiRow]?.indexOf("Will the Fed cut rates?") ?? -1;

    await act(async () => {
      await testSetup!.mockMouse.click(kalshiCol + 1, kalshiRow);
      await testSetup!.renderOnce();
    });
    await flushFrames(testSetup);

    frame = testSetup.captureCharFrame();
    const dividerLines = frame.split("\n");
    const dividerRow = dividerLines.findIndex((line) => line.includes("│"));
    const dividerCol = dividerLines[dividerRow]?.indexOf("│") ?? -1;

    await act(async () => {
      await testSetup!.mockMouse.drag(
        dividerCol,
        dividerRow,
        dividerCol + 10,
        dividerRow,
      );
      await testSetup!.renderOnce();
    });
    await flushFrames(testSetup);

    expect(
      harnessStateRef.current?.paneState[TEST_PANE_ID]?.pluginState?.[
        "prediction-markets"
      ]?.detailSplitRatio,
    ).toBeGreaterThan(0.42);
  });

  test("switches categories with arrows and venues with shift+arrows", async () => {
    installPredictionMarketMocks();

    testSetup = await testRender(<Harness />, { width: 120, height: 34 });
    await flushFrames(testSetup);

    await emitKeypress(testSetup, {
      name: "right",
      sequence: "\u001b[C",
    });
    await flushFrames(testSetup);
    await emitKeypress(testSetup, {
      name: "right",
      sequence: "\u001b[1;2C",
      shift: true,
    });
    await flushFrames(testSetup);

    expect(
      harnessStateRef.current?.paneState[TEST_PANE_ID]?.pluginState?.[
        "prediction-markets"
      ]?.categoryId,
    ).toBe("politics");
    expect(
      harnessStateRef.current?.paneState[TEST_PANE_ID]?.pluginState?.[
        "prediction-markets"
      ]?.venueScope,
    ).toBe("polymarket");
  });

  test("toggles the watch column without triggering a render loop", async () => {
    installPredictionMarketMocks();

    testSetup = await testRender(<Harness />, { width: 120, height: 34 });
    await flushFrames(testSetup);

    const frame = testSetup.captureCharFrame();
    const lines = frame.split("\n");
    const firstMarketRow = lines.findIndex((line) =>
      line.includes("Will inflation fall?"),
    );

    await act(async () => {
      await testSetup!.mockMouse.click(2, firstMarketRow);
      await testSetup!.renderOnce();
    });
    await flushFrames(testSetup);

    const nextFrame = testSetup.captureCharFrame();
    expect(nextFrame).not.toContain("Maximum update depth exceeded");
    expect(nextFrame).toContain("★");
  });
});
