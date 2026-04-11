# Bloomberg Tier 1 Features — Design Spec

Four features that close the biggest gaps between Gloomberb and a Bloomberg terminal. All use free, zero-config data sources (primarily Yahoo Finance, which is already a dependency).

---

## Feature 1: Economic Calendar (ECON)

**What it is:** A pane showing upcoming and recent economic events — GDP, CPI, NFP, FOMC, PMI — with release dates, consensus estimates, actual values, and prior readings. Bloomberg's `ECO` screen equivalent.

**Data source:** Scrape the public Investing.com economic calendar page. It has structured event data with actual/forecast/prior columns, filterable by country and importance. Fallback: Trading Economics has a similar public calendar. No API key needed for either.

**Implementation:**
- New data source: `src/sources/econ-calendar.ts` — fetches and parses the public calendar HTML, returns structured `EconEvent[]`
- New plugin: `src/plugins/builtin/econ/` with a single pane
- Pane shows a table: Date | Time | Event | Actual | Forecast | Prior | Impact (high/med/low)
- Filter controls: country (US default, G7 available), importance level, date range (this week / next week / custom)
- Color coding: actual vs forecast (green if beat, red if miss)
- Cache: 15-minute staleness, 2-hour expiry (events don't change frequently)
- Command bar shortcut: `ECON`
- Provider router integration: register as a new resource type alongside quotes/news/etc.

**Pane behavior:**
- Defaults to upcoming US high-importance events for the current week
- Scrollable table with keyboard navigation (j/k)
- Past events show actual values; future events show forecast only
- Clicking an event could show a detail view with historical readings for that indicator

---

## Feature 2: Technical Analysis / Chart Indicators

**What it is:** Overlay technical indicators on existing price charts. Moving averages, RSI, MACD, Bollinger Bands, and volume bars. The biggest gap for anyone who trades.

**Data source:** Computed from existing OHLCV price history data — no new external data needed.

**Implementation:**
- New module: `src/components/chart/indicators/` — pure computation functions, one file per indicator family
  - `moving-averages.ts`: SMA, EMA (configurable period)
  - `oscillators.ts`: RSI (14-period default), MACD (12/26/9)
  - `bands.ts`: Bollinger Bands (20-period, 2 std dev)
  - `volume.ts`: Volume bars, volume-weighted average price (VWAP)
- Each indicator function takes `PricePoint[]` and returns overlay data in a standard format
- Chart renderer changes:
  - Both Kitty and Unicode renderers need to draw overlays on the existing chart canvas
  - Moving averages / Bollinger: additional line series drawn over the price line
  - RSI / MACD: drawn in a sub-panel below the main chart (split the chart area ~75/25)
  - Volume: bars at the bottom of the main chart area (transparent overlay)
- Pane settings integration:
  - Chart pane settings get a new "Indicators" section
  - Toggle individual indicators on/off
  - Configure periods (e.g., SMA 20 vs SMA 50)
  - Persist indicator selections per pane instance
- Color assignments: each indicator gets a distinct color from the theme palette
- Performance: indicators are computed once per price history fetch and cached with the chart data

**Indicator rendering approach:**
- Main chart area: price line + MAs + Bollinger bands + volume bars (semi-transparent)
- Sub-panel (when RSI or MACD enabled): oscillator with reference lines (RSI 30/70, MACD zero line)
- Sub-panel height: configurable, default 25% of chart height

---

## Feature 3: Market Movers (TOP)

**What it is:** A pane showing the day's biggest gainers, losers, and most active stocks. Bloomberg's `MOST` and `TOP` screens.

**Data source:** Yahoo Finance `screener` API — the `yahoo-finance2` package already has `screener()` with built-in presets for `day_gainers`, `day_losers`, `most_actives`. Also `trendingSymbols()` for what's trending by search volume.

**Implementation:**
- New plugin: `src/plugins/builtin/market-movers/` with a single pane
- Pane has tabbed sections: Gainers | Losers | Most Active | Trending
- Each tab shows a ranked table: # | Ticker | Name | Price | Change | Change% | Volume | Mkt Cap
- New data source method in `src/sources/yahoo-finance.ts`: wrap the yahoo-finance2 `screener()` and `trendingSymbols()` calls
- Cache: 5-minute staleness (market movers change frequently during trading hours)
- Command bar shortcut: `TOP`
- Table rows are clickable — selecting a ticker navigates the linked detail pane
- Color coding: green/red for change values, bold for top 3
- Configurable count: default 20 per tab, max 50
- Region filter: US default, with option for other markets

**Pane behavior:**
- Auto-refreshes on the 5-minute cache cycle
- Keyboard: tab to switch sections, j/k to navigate rows, enter to focus ticker
- Mouse: click row to select, click tab to switch

---

## Feature 4: World Equity Indices (WEI)

**What it is:** A compact summary pane showing major global equity indices with current values, daily change, and market status (open/closed). Bloomberg's `WEI` screen.

**Data source:** Yahoo Finance quotes for index tickers (^GSPC, ^DJI, ^IXIC, ^FTSE, ^GDAXI, ^N225, ^HSI, etc.). Already supported by the existing quote infrastructure.

**Implementation:**
- New plugin: `src/plugins/builtin/world-indices/` with a single pane
- Hardcoded list of ~15-20 major indices grouped by region:
  - Americas: S&P 500, Dow Jones, Nasdaq, Russell 2000, S&P/TSX
  - Europe: FTSE 100, DAX, CAC 40, Euro Stoxx 50, SMI
  - Asia-Pacific: Nikkei 225, Hang Seng, Shanghai Composite, KOSPI, ASX 200, Sensex
  - Other: VIX (volatility index), DXY (US dollar index)
- Table columns: Index | Last | Change | Change% | Market Status
- Market status indicator: green dot (open), red dot (closed), yellow dot (pre/post-market)
- Uses the existing `MarketDataCoordinator` to fetch quotes — no new data source needed, just batch-request the index symbols
- Command bar shortcut: `WEI`
- Compact mode option: show just ticker + change% in a dense grid for embedding in dashboards

**Pane behavior:**
- Grouped by region with section headers
- Auto-refreshes with the standard quote refresh cycle
- Clicking an index opens it in the linked detail pane (chart, etc.)
- Keyboard: j/k navigation, enter to focus

---

## Shared Concerns

**Plugin registration pattern:** All four features follow the existing plugin pattern — implement `GloomPlugin`, register panes/commands via `PluginRegistry`. Each gets its own directory under `src/plugins/builtin/`.

**Data source integration:** ECON calendar and market movers need new fetcher functions. World indices and tech indicators use existing infrastructure.

**Testing:** Each indicator computation gets unit tests. Data source parsers get tests with fixture HTML/JSON. Pane rendering is tested through the existing TUI testing approach (tmux).

**Theme compatibility:** All new panes use the existing `colors` theme system. Indicator colors should be theme-aware (work on amber, green, blue themes).
