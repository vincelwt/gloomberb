import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

type RpcCall = { method: string; payload: unknown };

const backendCalls: RpcCall[] = [];
const backendResponses = new Map<string, unknown>();
const quoteListeners = new Map<string, (message: any) => void>();
const snapshotListeners = new Map<string, (message: any) => void>();
const resolvedListeners = new Set<(message: any) => void>();

mock.module("../backend-rpc", () => ({
  backendRequest: async (method: string, payload: unknown) => {
    backendCalls.push({ method, payload });
    return backendResponses.get(method) ?? null;
  },
  onIbkrQuoteSubscription: (subscriptionId: string, listener: (message: any) => void) => {
    quoteListeners.set(subscriptionId, listener);
    return () => {
      quoteListeners.delete(subscriptionId);
    };
  },
  onIbkrSnapshotSubscription: (subscriptionId: string, listener: (message: any) => void) => {
    snapshotListeners.set(subscriptionId, listener);
    return () => {
      snapshotListeners.delete(subscriptionId);
    };
  },
  onIbkrResolved: (listener: (message: any) => void) => {
    resolvedListeners.add(listener);
    return () => {
      resolvedListeners.delete(listener);
    };
  },
}));

const {
  ibkrGatewayManager,
  setResolvedIbkrGatewayListener,
} = await import("./ibkr-gateway-service");

describe("Electrobun IBKR gateway bridge", () => {
  beforeEach(() => {
    backendCalls.length = 0;
    backendResponses.clear();
    quoteListeners.clear();
    snapshotListeners.clear();
    setResolvedIbkrGatewayListener(null);
  });

  afterEach(async () => {
    await ibkrGatewayManager.destroyAll();
    backendCalls.length = 0;
    backendResponses.clear();
    quoteListeners.clear();
    snapshotListeners.clear();
    setResolvedIbkrGatewayListener(null);
  });

  test("delegates quote requests through backend RPC", async () => {
    const expectedQuote = {
      symbol: "NVDA",
      regularMarketPrice: 123.45,
    };
    backendResponses.set("ibkr.getQuote", expectedQuote);

    const service = ibkrGatewayManager.getService("ibkr-main");
    const quote = await service.getQuote("NVDA", { host: "127.0.0.1" }, "NASDAQ");

    expect(quote).toEqual(expectedQuote);
    expect(backendCalls).toHaveLength(1);
    expect(backendCalls[0]).toMatchObject({
      method: "ibkr.getQuote",
      payload: {
        instanceId: "ibkr-main",
        ticker: "NVDA",
        exchange: "NASDAQ",
        config: { host: "127.0.0.1" },
      },
    });
  });

  test("streams quote subscriptions through backend RPC", async () => {
    const service = ibkrGatewayManager.getService("ibkr-stream");
    const target = { symbol: "NVDA", exchange: "NASDAQ" } as any;
    const received: Array<{ target: unknown; quote: unknown }> = [];

    const unsubscribe = service.subscribeQuotes(
      { host: "127.0.0.1" },
      [target],
      (nextTarget, nextQuote) => {
        received.push({ target: nextTarget, quote: nextQuote });
      },
    );

    expect(backendCalls).toHaveLength(1);
    expect(backendCalls[0]?.method).toBe("ibkr.subscribeQuotes");
    const subscriptionId = (backendCalls[0]?.payload as { subscriptionId: string }).subscriptionId;
    expect(subscriptionId).toStartWith("ibkr-quote:ibkr-stream:");

    quoteListeners.get(subscriptionId)?.({
      subscriptionId,
      target,
      quote: { symbol: "NVDA", regularMarketPrice: 987.65 },
    });

    expect(received).toEqual([
      {
        target,
        quote: { symbol: "NVDA", regularMarketPrice: 987.65 },
      },
    ]);

    unsubscribe();

    expect(backendCalls.at(-1)).toMatchObject({
      method: "ibkr.unsubscribeQuotes",
      payload: {
        instanceId: "ibkr-stream",
        subscriptionId,
      },
    });
  });

  test("keeps snapshot and resolved-connection state in sync", async () => {
    const listener = mock(() => {});
    const resolvedSpy = mock(() => {});

    setResolvedIbkrGatewayListener(resolvedSpy);
    const unsubscribe = ibkrGatewayManager.subscribe("ibkr-live", listener);

    expect(backendCalls).toHaveLength(1);
    expect(backendCalls[0]?.method).toBe("ibkr.subscribeSnapshot");
    const subscriptionId = (backendCalls[0]?.payload as { subscriptionId: string }).subscriptionId;
    expect(subscriptionId).toStartWith("ibkr-snapshot:ibkr-live:");

    const snapshot = {
      status: { state: "connected", updatedAt: Date.now() },
      accounts: [{ id: "acct-1", accountId: "U123" }],
      openOrders: [],
      executions: [],
    };
    const resolvedConnection = {
      host: "127.0.0.1",
      port: 4002,
      clientId: 7,
      requestedClientId: 7,
    };

    snapshotListeners.get(subscriptionId)?.({
      subscriptionId,
      snapshot,
      resolvedConnection,
    });
    for (const emitResolved of resolvedListeners) {
      emitResolved({
        instanceId: "ibkr-live",
        connection: resolvedConnection,
      });
    }

    expect(ibkrGatewayManager.getSnapshot("ibkr-live")).toEqual(snapshot);
    expect(ibkrGatewayManager.getResolvedConnection("ibkr-live")).toEqual(resolvedConnection);
    expect(listener).toHaveBeenCalled();
    expect(resolvedSpy).toHaveBeenCalledWith("ibkr-live", resolvedConnection);

    unsubscribe();

    expect(backendCalls.at(-1)).toMatchObject({
      method: "ibkr.unsubscribeSnapshot",
      payload: {
        instanceId: "ibkr-live",
        subscriptionId,
      },
    });
  });
});
