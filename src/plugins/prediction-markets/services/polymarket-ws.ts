import type { PredictionBookLevel, PredictionTrade } from "../types";
import { parseFloatSafe } from "./fetch";

const POLYMARKET_HEARTBEAT_MS = 10_000;

interface PolymarketLiveCallbacks {
  onBestBidAsk?: (
    assetId: string,
    bestBid: number | null,
    bestAsk: number | null,
    spread: number | null,
  ) => void;
  onBook?: (
    assetId: string,
    bids: PredictionBookLevel[],
    asks: PredictionBookLevel[],
    lastTradePrice: number | null,
  ) => void;
  onTrade?: (assetId: string, trade: PredictionTrade) => void;
}

function toBookLevels(
  levels: Array<{ price: string; size: string }> | undefined,
): PredictionBookLevel[] {
  return (levels ?? [])
    .map((level) => {
      const price = parseFloatSafe(level.price);
      const size = parseFloatSafe(level.size);
      return price == null || size == null ? null : { price, size };
    })
    .filter((level): level is PredictionBookLevel => level != null);
}

export function subscribePolymarketMarket(
  assetIds: string[],
  callbacks: PolymarketLiveCallbacks,
): () => void {
  if (assetIds.length === 0) return () => {};

  let closed = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const clearHeartbeat = () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  };

  const sendHeartbeat = () => {
    try {
      socket?.send("PING");
    } catch {
      // The close handler will schedule reconnects for broken sockets.
    }
  };

  const connect = () => {
    clearHeartbeat();
    socket = new WebSocket(
      "wss://ws-subscriptions-clob.polymarket.com/ws/market",
    );
    socket.addEventListener("open", () => {
      socket?.send(
        JSON.stringify({
          assets_ids: assetIds,
          type: "market",
          custom_feature_enabled: true,
        }),
      );
      heartbeatTimer = setInterval(sendHeartbeat, POLYMARKET_HEARTBEAT_MS);
    });
    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as any;
        switch (payload.event_type) {
          case "book":
            callbacks.onBook?.(
              String(payload.asset_id),
              toBookLevels(payload.bids),
              toBookLevels(payload.asks),
              parseFloatSafe(payload.last_trade_price),
            );
            break;
          case "best_bid_ask":
            callbacks.onBestBidAsk?.(
              String(payload.asset_id),
              parseFloatSafe(payload.best_bid),
              parseFloatSafe(payload.best_ask),
              parseFloatSafe(payload.spread),
            );
            break;
          case "last_trade_price":
            callbacks.onTrade?.(String(payload.asset_id), {
              id: `${payload.asset_id}:${payload.timestamp}:${payload.price}`,
              timestamp: Number.parseInt(String(payload.timestamp), 10),
              side:
                String(payload.side).toUpperCase() === "SELL" ? "sell" : "buy",
              outcome: "yes",
              price: parseFloatSafe(payload.price) ?? 0,
              size: parseFloatSafe(payload.size) ?? 0,
            });
            break;
        }
      } catch {
        // ignore malformed messages
      }
    });
    socket.addEventListener("close", () => {
      clearHeartbeat();
      socket = null;
      if (closed) return;
      reconnectTimer = setTimeout(connect, 1_500);
    });
    socket.addEventListener("error", () => {
      socket?.close();
    });
  };

  connect();

  return () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    clearHeartbeat();
    socket?.close();
  };
}
