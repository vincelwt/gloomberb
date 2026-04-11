# WebSocket News Upgrade — Design Spec

Optional real-time news streaming via Alpaca or Finnhub websocket APIs. Upgrades the FIRST (breaking news) pane from 2-minute polling to push-based delivery when an API key is configured.

**Status: PLANNED — implement after input model redesign.**

---

## Architecture

The existing `NewsSource` interface supports pull-based `fetchMarketNews()`. For websocket push, add an optional streaming method:

```typescript
// Extended NewsSource interface
export interface NewsSource {
  readonly id: string;
  readonly name: string;
  fetchMarketNews(): Promise<MarketNewsItem[]>;
  // Optional: real-time streaming
  subscribeMarketNews?(onArticle: (item: MarketNewsItem) => void): () => void;
}
```

The `NewsAggregator` checks if any registered source supports `subscribeMarketNews`. If so, it subscribes and pushes new articles into the in-memory list immediately (no polling delay). The poll loop still runs for non-streaming sources.

## Alpaca NewsSource

```typescript
// src/plugins/builtin/news-wire/alpaca-source.ts

export function createAlpacaNewsSource(apiKey: string, apiSecret: string): NewsSource {
  return {
    id: "alpaca",
    name: "Alpaca",

    async fetchMarketNews() {
      // REST API fallback: GET https://data.alpaca.markets/v1beta1/news
      // Returns recent news articles
    },

    subscribeMarketNews(onArticle) {
      // WebSocket: wss://stream.data.alpaca.markets/v1beta1/news
      // Auth: send { "action": "auth", "key": apiKey, "secret": apiSecret }
      // Subscribe: send { "action": "subscribe", "news": ["*"] }
      // On message: parse article, call onArticle(enrichedItem)
      // Returns unsubscribe function
    },
  };
}
```

## Finnhub NewsSource

```typescript
// src/plugins/builtin/news-wire/finnhub-source.ts

export function createFinnhubNewsSource(apiKey: string): NewsSource {
  return {
    id: "finnhub",
    name: "Finnhub",

    async fetchMarketNews() {
      // REST: GET https://finnhub.io/api/v1/news?category=general&token=apiKey
    },

    subscribeMarketNews(onArticle) {
      // WebSocket: wss://ws.finnhub.io?token=apiKey
      // Subscribe: send { "type": "subscribe-news" }
      // Returns unsubscribe function
    },
  };
}
```

## Configuration

API keys stored via plugin config commands (same pattern as FRED):

```
Set Alpaca Key    → stores apiKey + apiSecret in pluginConfig["news-wire"]
Set Finnhub Key   → stores apiKey in pluginConfig["news-wire"]
```

The news-wire plugin checks for configured keys on setup and registers the appropriate streaming source alongside the RSS source.

## Aggregator Changes

```typescript
// In NewsAggregator.start():
for (const source of this.sources.values()) {
  if (source.subscribeMarketNews) {
    const unsub = source.subscribeMarketNews((item) => {
      this.ingestArticle(item);
      this.bump();
    });
    this.subscriptions.push(unsub);
  }
}
```

New articles from websocket are deduplicated against existing articles and immediately visible to all panes via the reactive subscription.

## FIRST Pane Enhancement

When a streaming source is active, the FIRST pane shows a "LIVE" indicator. New articles appear immediately without waiting for a poll cycle. A notification sound plays for high-importance breaking articles (reusing the alert notification infrastructure).

## Not In Scope

- Alpaca/Finnhub trading integration (separate from news)
- Historical news backfill from websocket sources
- Sentiment analysis on streaming articles
