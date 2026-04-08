import { act, useMemo, useReducer, useRef } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import {
  AppContext,
  appReducer,
  createInitialState,
  PaneInstanceProvider,
} from "../../state/app-context";
import { createDefaultConfig, type AppConfig } from "../../types/config";
import type { PersistedResourceValue } from "../../types/persistence";
import type { PluginPersistence } from "../../types/plugin";
import {
  PluginRenderProvider,
  type PluginRuntimeAccess,
} from "../plugin-runtime";
import { PredictionMarketChart } from "./chart";
import { PredictionMarketDetailPane } from "./detail/pane";
import { PredictionMarketsPane } from "./pane";
import { buildPredictionListRows } from "./rows";
import {
  PREDICTION_CACHE_POLICIES,
  attachPredictionMarketsPersistence,
} from "./services/fetch";
import { normalizeKalshiMarket } from "./services/kalshi-adapter";

export const TEST_PANE_ID = "prediction-markets:main";
const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;

export const harnessStateRef: {
  current: ReturnType<typeof createInitialState> | null;
} = { current: null };

export class MemoryPersistence implements PluginPersistence {
  private readonly state = new Map<string, { schemaVersion: number; value: unknown }>();
  private readonly resources = new Map<string, PersistedResourceValue<unknown>>();

  getState<T = unknown>(key: string, options?: { schemaVersion?: number }): T | null {
    const record = this.state.get(key);
    if (!record) return null;
    if (options?.schemaVersion != null && record.schemaVersion !== options.schemaVersion) {
      this.state.delete(key);
      return null;
    }
    return record.value as T;
  }

  setState(key: string, value: unknown, options?: { schemaVersion?: number }): void {
    this.state.set(key, { schemaVersion: options?.schemaVersion ?? 1, value });
  }

  deleteState(key: string): void {
    this.state.delete(key);
  }

  getResource<T = unknown>(
    kind: string,
    key: string,
    options?: { sourceKey?: string; schemaVersion?: number; allowExpired?: boolean },
  ): PersistedResourceValue<T> | null {
    const record = this.resources.get(`${kind}:${key}:${options?.sourceKey ?? ""}`);
    if (!record) return null;
    if (options?.schemaVersion != null && record.schemaVersion !== options.schemaVersion) {
      this.resources.delete(`${kind}:${key}:${options.sourceKey ?? ""}`);
      return null;
    }
    return record as PersistedResourceValue<T>;
  }

  setResource<T = unknown>(
    kind: string,
    key: string,
    value: T,
    options: {
      cachePolicy: { staleMs: number; expireMs: number };
      sourceKey?: string;
      schemaVersion?: number;
      provenance?: unknown;
    },
  ): PersistedResourceValue<T> {
    const now = Date.now();
    const record: PersistedResourceValue<T> = {
      value,
      fetchedAt: now,
      staleAt: now + options.cachePolicy.staleMs,
      expiresAt: now + options.cachePolicy.expireMs,
      sourceKey: options.sourceKey ?? "",
      schemaVersion: options.schemaVersion ?? 1,
      provenance: options.provenance,
    };
    this.resources.set(`${kind}:${key}:${options.sourceKey ?? ""}`, record);
    return record;
  }

  deleteResource(kind: string, key: string, options?: { sourceKey?: string }): void {
    this.resources.delete(`${kind}:${key}:${options?.sourceKey ?? ""}`);
  }
}

attachPredictionMarketsPersistence(new MemoryPersistence());

export function createConfig(options?: {
  initialFocusedPaneId?: string;
}): AppConfig {
  const config = createDefaultConfig("/tmp/gloomberb-prediction-markets");
  const initialFocusedPaneId = options?.initialFocusedPaneId ?? TEST_PANE_ID;
  const extraInstances = initialFocusedPaneId !== TEST_PANE_ID
    ? [{
        instanceId: initialFocusedPaneId,
        paneId: initialFocusedPaneId.split(":")[0] ?? "portfolio-list",
        binding: { kind: "none" as const },
      }]
    : [];
  const layout = {
    dockRoot: { kind: "pane" as const, instanceId: TEST_PANE_ID },
    instances: [
      ...extraInstances,
      {
        instanceId: TEST_PANE_ID,
        paneId: "prediction-markets",
        binding: { kind: "none" as const },
        settings: {},
      },
    ],
    floating: [],
  };

  return {
    ...config,
    layout,
    layouts: [{ name: "Default", layout }],
  };
}

export function createRuntime(): PluginRuntimeAccess {
  const resumeState = new Map<string, unknown>();
  const listeners = new Map<string, Set<() => void>>();

  return {
    subscribeResumeState(pluginId, key, listener) {
      const listenerKey = `${pluginId}:${key}`;
      if (!listeners.has(listenerKey)) listeners.set(listenerKey, new Set());
      listeners.get(listenerKey)!.add(listener);
      return () => {
        listeners.get(listenerKey)?.delete(listener);
      };
    },
    getResumeState(pluginId, key) {
      return (resumeState.get(`${pluginId}:${key}`) as any) ?? null;
    },
    setResumeState(pluginId, key, value) {
      const listenerKey = `${pluginId}:${key}`;
      resumeState.set(listenerKey, value);
      for (const listener of listeners.get(listenerKey) ?? []) listener();
    },
    deleteResumeState(pluginId, key) {
      const listenerKey = `${pluginId}:${key}`;
      resumeState.delete(listenerKey);
      for (const listener of listeners.get(listenerKey) ?? []) listener();
    },
    getConfigState() {
      return null;
    },
    async setConfigState() {},
    async deleteConfigState() {},
    getConfigStateKeys() {
      return [];
    },
  };
}

export function installPredictionMarketMocks() {
  attachPredictionMarketsPersistence(new MemoryPersistence());
  const fetchUrls: string[] = [];
  const polymarketMarket = {
    id: "pm-1",
    question: "Will inflation fall?",
    conditionId: "cond-1",
    slug: "inflation-fall",
    description: "Inflation market",
    endDate: "2026-05-01T12:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    volume24hr: 250000,
    volumeNum: 4500000,
    liquidityNum: 750000,
    spread: 0.02,
    bestBid: 0.61,
    bestAsk: 0.63,
    lastTradePrice: 0.62,
    outcomes: '["Yes","No"]',
    outcomePrices: '["0.62","0.38"]',
    clobTokenIds: '["yes-1","no-1"]',
    events: [
      {
        id: "event-1",
        title: "US inflation",
        description: "CPI event",
        resolutionSource: "BLS",
        openInterest: 1200000,
        tags: [{ label: "Macro" }],
      },
    ],
    active: true,
    closed: false,
  };
  const polymarketEvent = {
    id: "event-1",
    title: "US inflation",
    description: "CPI event",
    resolutionSource: "BLS",
    openInterest: 1200000,
    tags: [{ label: "Macro", slug: "economy" }],
    markets: [polymarketMarket],
  };

  const kalshiMarket = {
    ticker: "KAL-1",
    title: "Will the Fed cut rates?",
    yes_sub_title: "Yes",
    event_ticker: "FED-1",
    close_time: "2026-05-02T12:00:00Z",
    open_time: "2026-03-01T12:00:00Z",
    updated_time: "2026-04-01T00:00:00Z",
    status: "open",
    market_type: "binary",
    yes_bid_dollars: "0.47",
    yes_ask_dollars: "0.49",
    no_bid_dollars: "0.51",
    no_ask_dollars: "0.53",
    last_price_dollars: "0.48",
    volume_24h_fp: "15000",
    volume_fp: "90000",
    open_interest_fp: "45000",
    liquidity_dollars: "250000",
    rules_primary: "Kalshi primary rule",
    rules_secondary: "Kalshi secondary rule",
  };
  const kalshiEvent = {
    title: "Fed series",
    category: "Economics",
    event_ticker: "FED-1",
    series_ticker: "FED",
    markets: [kalshiMarket],
  };

  globalThis.fetch = (async (input: Request | string | URL) => {
    const url = String(input);
    fetchUrls.push(url);
    if (url.includes("gamma-api.polymarket.com/public-search")) {
      return new Response(
        JSON.stringify({
          events: [
            {
              id: "event-1",
              title: "US inflation",
              markets: [
                {
                  question: "Will inflation fall?",
                  slug: "inflation-fall",
                  outcomes: ["Yes", "No"],
                  outcomePrices: ["0.62", "0.38"],
                  bestBid: 0.61,
                  bestAsk: 0.63,
                  lastTradePrice: 0.62,
                  spread: 0.02,
                },
              ],
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.includes("gamma-api.polymarket.com/events?")) {
      return new Response(JSON.stringify([polymarketEvent]), { status: 200 });
    }
    if (url.includes("gamma-api.polymarket.com/events/event-1")) {
      return new Response(JSON.stringify(polymarketEvent), { status: 200 });
    }
    if (url.includes("clob.polymarket.com/prices-history")) {
      return new Response(
        JSON.stringify({
          history: [
            { t: 1711929600, p: 0.55 },
            { t: 1712016000, p: 0.58 },
            { t: 1712102400, p: 0.62 },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.includes("clob.polymarket.com/book?token_id=yes-1")) {
      return new Response(
        JSON.stringify({
          bids: [{ price: "0.61", size: "1200" }],
          asks: [{ price: "0.63", size: "1500" }],
          last_trade_price: "0.62",
        }),
        { status: 200 },
      );
    }
    if (url.includes("clob.polymarket.com/book?token_id=no-1")) {
      return new Response(
        JSON.stringify({
          bids: [{ price: "0.37", size: "900" }],
          asks: [{ price: "0.39", size: "1100" }],
          last_trade_price: "0.38",
        }),
        { status: 200 },
      );
    }
    if (url.includes("data-api.polymarket.com/trades")) {
      return new Response(
        JSON.stringify([
          {
            transactionHash: "0x1",
            side: "BUY",
            size: 250,
            price: 0.62,
            timestamp: 1712102400,
            outcome: "Yes",
          },
        ]),
        { status: 200 },
      );
    }
    if (url.includes("/trade-api/v2/events?")) {
      return new Response(JSON.stringify({ events: [kalshiEvent] }), {
        status: 200,
      });
    }
    if (url.includes("/trade-api/v2/events/FED-1")) {
      return new Response(
        JSON.stringify({
          event: {
            title: "Fed series",
            category: "Economics",
            event_ticker: "FED-1",
            series_ticker: "FED",
          },
          markets: [kalshiMarket],
        }),
        { status: 200 },
      );
    }
    if (url.includes("/trade-api/v2/markets/KAL-1/orderbook")) {
      return new Response(
        JSON.stringify({
          orderbook_fp: {
            yes_dollars: [["0.47", "120"]],
            no_dollars: [["0.53", "95"]],
          },
        }),
        { status: 200 },
      );
    }
    if (url.includes("/trade-api/v2/markets/trades?ticker=KAL-1")) {
      return new Response(
        JSON.stringify({
          trades: [
            {
              trade_id: "kal-1",
              ticker: "KAL-1",
              taker_side: "yes",
              yes_price_dollars: "0.48",
              no_price_dollars: "0.52",
              count_fp: "50",
              created_time: "2026-04-01T00:00:00Z",
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.includes("/trade-api/v2/series/FED/markets/KAL-1/candlesticks")) {
      return new Response(
        JSON.stringify({
          candlesticks: [
            {
              end_period_ts: 1711929600,
              volume_fp: "10",
              price: {
                open_dollars: "0.44",
                high_dollars: "0.46",
                low_dollars: "0.43",
                close_dollars: "0.45",
              },
            },
            {
              end_period_ts: 1712016000,
              volume_fp: "12",
              price: {
                open_dollars: "0.45",
                high_dollars: "0.49",
                low_dollars: "0.44",
                close_dollars: "0.48",
              },
            },
          ],
        }),
        { status: 200 },
      );
    }

    return new Response(JSON.stringify({}), { status: 200 });
  }) as unknown as typeof fetch;

  class MockWebSocket {
    listeners: Record<string, Array<(event?: any) => void>> = {
      open: [],
      message: [],
      close: [],
      error: [],
    };

    constructor() {
      queueMicrotask(() => {
        for (const listener of this.listeners.open ?? []) listener({});
      });
    }

    addEventListener(type: string, listener: (event?: any) => void) {
      this.listeners[type]?.push(listener);
    }

    send() {}

    close() {
      for (const listener of this.listeners.close ?? []) listener({});
    }
  }

  globalThis.WebSocket = MockWebSocket as any;

  return { fetchUrls };
}

export function Harness({
  initialFocusedPaneId = TEST_PANE_ID,
}: {
  initialFocusedPaneId?: string;
} = {}) {
  const runtime = useMemo(() => createRuntime(), []);
  const [state, dispatch] = useReducer(
    appReducer,
    (() => {
      const initial = createInitialState(createConfig({ initialFocusedPaneId }));
      initial.focusedPaneId = initialFocusedPaneId;
      return initial;
    })(),
  );
  harnessStateRef.current = state;
  return (
    <AppContext value={{ state, dispatch }}>
      <PaneInstanceProvider paneId={TEST_PANE_ID}>
        <PluginRenderProvider pluginId="prediction-markets" runtime={runtime}>
          <PredictionMarketsPane
            paneId={TEST_PANE_ID}
            paneType="prediction-markets"
            focused={state.focusedPaneId === TEST_PANE_ID}
            width={120}
            height={34}
          />
        </PluginRenderProvider>
      </PaneInstanceProvider>
    </AppContext>
  );
}

export function ChartHarness({
  history,
}: {
  history: Array<{ date: unknown; close: number }>;
}) {
  const [state, dispatch] = useReducer(
    appReducer,
    (() => {
      const initial = createInitialState(createConfig());
      initial.focusedPaneId = TEST_PANE_ID;
      return initial;
    })(),
  );
  return (
    <AppContext value={{ state, dispatch }}>
      <PaneInstanceProvider paneId={TEST_PANE_ID}>
        <PredictionMarketChart
          history={history as any}
          width={80}
          height={12}
          range="1M"
          onRangeSelect={() => {}}
        />
      </PaneInstanceProvider>
    </AppContext>
  );
}

export function GroupedDetailHarness() {
  const [state, dispatch] = useReducer(
    appReducer,
    (() => {
      const initial = createInitialState(createConfig());
      initial.focusedPaneId = TEST_PANE_ID;
      return initial;
    })(),
  );
  const [selectedRow] = buildPredictionListRows([
    normalizeKalshiMarket(
      {
        ticker: "KXFED-27APR-T4.25",
        title:
          "Will the upper bound of the federal funds target rate be above 4.25%?",
        yes_sub_title: "Above 4.25%",
        event_ticker: "KXFED-27APR",
        status: "open",
        market_type: "binary",
        last_price_dollars: "0.48",
        volume_24h_fp: "15000",
        volume_fp: "90000",
        open_interest_fp: "45000",
        liquidity_dollars: "250000",
        strike_type: "greater",
        floor_strike: "4.25",
      } as any,
      {
        title: "Federal funds target rate after April 2026 FOMC",
        sub_title: "Upper bound",
        category: "Economics",
        series_ticker: "KXFED",
      },
    )!,
    normalizeKalshiMarket(
      {
        ticker: "KXFED-27APR-T4.50",
        title:
          "Will the upper bound of the federal funds target rate be above 4.50%?",
        yes_sub_title: "Above 4.50%",
        event_ticker: "KXFED-27APR",
        status: "open",
        market_type: "binary",
        last_price_dollars: "0.31",
        volume_24h_fp: "12000",
        volume_fp: "70000",
        open_interest_fp: "35000",
        liquidity_dollars: "190000",
        strike_type: "greater",
        floor_strike: "4.50",
      } as any,
      {
        title: "Federal funds target rate after April 2026 FOMC",
        sub_title: "Upper bound",
        category: "Economics",
        series_ticker: "KXFED",
      },
    )!,
  ]);

  const summary = selectedRow!.markets[0]!;
  const scrollRef = useRef<ScrollBoxRenderable>(null);

  return (
    <AppContext value={{ state, dispatch }}>
      <PaneInstanceProvider paneId={TEST_PANE_ID}>
        <PredictionMarketDetailPane
          detail={{
            summary,
            siblings: selectedRow!.markets.map((market) => ({
              key: market.key,
              marketId: market.marketId,
              label: market.marketLabel,
              yesPrice: market.yesPrice,
              volume24h: market.volume24h,
            })),
            rules: [],
            history: [],
            book: {
              yesBids: [],
              yesAsks: [],
              noBids: [],
              noAsks: [],
              lastTradePrice: null,
            },
            trades: [],
          }}
          detailError={null}
          detailLoadCount={0}
          detailTab="overview"
          detailWidth={58}
          focused
          height={24}
          historyRange="1M"
          onDetailTabChange={() => {}}
          onHistoryRangeChange={() => {}}
          onPreviewOrder={() => {}}
          onSelectMarket={() => {}}
          scrollRef={scrollRef}
          selectedRow={selectedRow!}
          selectedSummary={summary}
        />
      </PaneInstanceProvider>
    </AppContext>
  );
}

export async function flushFrames(
  testSetup: Awaited<ReturnType<typeof import("@opentui/react/test-utils").testRender>>,
  count = 4,
) {
  for (let index = 0; index < count; index += 1) {
    await act(async () => {
      await testSetup.renderOnce();
    });
  }
}

export async function emitKeypress(
  testSetup: Awaited<ReturnType<typeof import("@opentui/react/test-utils").testRender>>,
  event: {
    name?: string;
    sequence?: string;
    shift?: boolean;
  },
) {
  await act(async () => {
    testSetup.renderer.keyInput.emit("keypress", {
      ctrl: false,
      meta: false,
      option: false,
      eventType: "press",
      repeated: false,
      ...event,
    } as any);
    await testSetup.renderOnce();
  });
}

export async function cleanupPredictionTest(
  testSetup?: Awaited<ReturnType<typeof import("@opentui/react/test-utils").testRender>>,
) {
  if (testSetup) {
    await act(async () => {
      testSetup.renderer.destroy();
    });
  }
  harnessStateRef.current = null;
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
  attachPredictionMarketsPersistence(new MemoryPersistence());
}

export { PREDICTION_CACHE_POLICIES };
