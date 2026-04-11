# ECON Bloomberg Clone — Design Spec

Bloomberg's ECO screen is a two-layer interface: a calendar grid showing upcoming/recent economic releases, and a detail view for drilling into any indicator's history. Our current ECON pane only has a basic calendar grid with significant gaps.

---

## Gap Analysis: Current vs Bloomberg ECO

### Calendar Grid (List View)

| Feature | Bloomberg ECO | Our ECON | Gap |
|---------|--------------|----------|-----|
| Country indicators | Flag emoji + 2-letter code | Plain 2-letter text | Missing flags |
| Impact markers | Colored bull icons (3 levels) | "!!" / "! " text | Text instead of visual indicators |
| Time grouping | "Today", "Tomorrow", day headers with separators | Raw ISO dates, no separators | No relative dates, no visual separation |
| Now marker | Clear line between past and upcoming events | None | Can't tell what's next |
| Countdown | "in 2h 15m" for next release | None | No temporal context |
| Actual values | Shows actuals after release, colored beat/miss | Always null (ForexFactory lacks actuals) | Dead feature — no actual data |
| Surprise column | Shows actual - forecast delta | None | Missing entirely |
| Revision indicator | Shows if prior was revised | None | Missing |
| Country filter | US, G7, All, custom | Impact filter only | Missing country filter |
| Date range | Today / This Week / Next Week / Custom | This week only | No range control |
| Sort | By date/time (default), by impact, by country | Date only | No sort options |
| Event count | Shows "N events" in header | None | Missing |
| Auto-refresh indicator | Shows last refresh time | None | No staleness info |

### Detail View (Drill-In)

| Feature | Bloomberg ECO | Our ECON | Gap |
|---------|--------------|----------|-----|
| Historical chart | 5yr+ time series of the indicator | None | Not built |
| Historical readings table | Past 12-24 releases with actual/forecast/prior | None | Not built |
| Surprise history | Chart of actual-vs-forecast over time | None | Not built |
| Related indicators | Links to related series (e.g., CPI → Core CPI, PCE) | None | Not built |
| Related tickers | Links to reactive assets (CPI → TIP, TIPS, DXY) | None | Not built |
| Data source attribution | "Source: Bureau of Labor Statistics" | None | Not built |
| Release schedule | Next N release dates | None | Not built |
| Enter/click to drill in | Opens detail panel | Nothing happens | No interaction |

### Data Layer

| Feature | Bloomberg ECO | Our ECON | Gap |
|---------|--------------|----------|-----|
| Actual values post-release | Yes, from live feeds | No — ForexFactory feed lacks actuals | Need FRED backfill |
| Historical data | Full history via Bloomberg data | FRED API key saved but unused | Need FRED client |
| Multi-source | Multiple feeds | Single ForexFactory feed | Fragile |
| Caching | Persistent cross-session | In-memory, lost on restart | Should use ResourceStore |

---

## Implementation Plan

### Phase 1: Fix the Calendar Grid

**1.1 — Relative date grouping with separators and now marker**

Replace raw ISO dates with day group headers ("Today", "Tomorrow", "Thu Apr 10") rendered as separator rows. Insert a "NOW" marker row between the last past event and the first upcoming event.

**1.2 — Country filter**

Add a country filter that cycles through: All → US → G7 → EU. Keyboard shortcut: `c`. G7 = US, GB, EU, JP, CA. Show active filter in header next to impact filter.

**1.3 — Countdown to next release**

In the header bar, show "Next: CPI m/m in 2h 15m" for the nearest upcoming event. Update every minute.

**1.4 — Event count and last refresh time**

Show "47 events" count in header. Show "updated 3m ago" next to the refresh hint.

**1.5 — Flag emoji for countries**

Map country codes to flag emoji: US→🇺🇸, GB→🇬🇧, EU→🇪🇺, JP→🇯🇵, CA→🇨🇦, AU→🇦🇺, CH→🇨🇭, CN→🇨🇳, NZ→🇳🇿. Replace the CC column with the flag.

**1.6 — Impact indicators**

Replace "!!" text with colored bullet characters: ● ● ● (high/3 red), ● ● (medium/2 yellow), ● (low/1 dim). More visual, matches Bloomberg's bull icons.

### Phase 2: FRED Integration

**2.1 — FRED client**

Create `src/plugins/builtin/econ/fred-client.ts`:
- Uses the throttled-fetch utility (5 req/min for FRED's free tier limit)
- `fetchSeriesObservations(seriesId, startDate, endDate)` → returns `{ date: string, value: number }[]`
- `fetchSeriesInfo(seriesId)` → returns `{ title, units, frequency, source, notes }`
- Reads API key from plugin config state
- Caches responses in ResourceStore (FRED data changes at most monthly)

**2.2 — Event → FRED series mapping**

Create `src/plugins/builtin/econ/fred-series-map.ts`:
- Maps ForexFactory event titles to FRED series IDs
- Key mappings:
  - "CPI m/m" → CPIAUCSL (CPI All Urban Consumers)
  - "Core CPI m/m" → CPILFESL (CPI Less Food and Energy)
  - "CPI y/y" → CPIAUCSL (same series, display as YoY)
  - "GDP q/q" → GDP (Gross Domestic Product)
  - "Final GDP q/q" → GDP
  - "Unemployment Rate" → UNRATE
  - "Unemployment Claims" → ICSA (Initial Claims)
  - "Non-Farm Payrolls" → PAYEMS (Total Nonfarm)
  - "ADP Non-Farm" → NPPTTL (ADP)
  - "Core PCE Price Index m/m" → PCEPILFE
  - "PPI m/m" → PPIACO
  - "Retail Sales m/m" → RSAFS
  - "ISM Manufacturing PMI" → MANEMP
  - "ISM Services PMI" → NMFCI
  - "Consumer Confidence" → UMCSENT (Michigan) or CSCICP03USM665S
  - "FOMC Rate Decision" → FEDFUNDS
  - "Crude Oil Inventories" → WCOILWTICO
  - "Natural Gas Storage" → NATURALGAS
  - "Housing Starts" → HOUST
  - "Building Permits" → PERMIT
  - "Durable Goods Orders m/m" → DGORDER
  - "Factory Orders m/m" → AMTMNO
  - "Trade Balance" → BOPGSTB
  - "Industrial Production m/m" → INDPRO
  - "Personal Income m/m" → PI
  - "Personal Spending m/m" → PCE
- Fuzzy matching for event title variations (e.g., "Prelim UoM Consumer Sentiment" → UMCSENT)
- Export `resolveFredSeriesId(eventTitle: string, country: string): string | null` — returns null for non-US or unmapped events

**2.3 — Related tickers mapping**

Map indicators to reactive tickers:
- CPI/PCE → TIP, DXY, ^TNX (10yr yield)
- GDP → SPY, DXY
- FOMC/Fed Funds → ^TNX, TLT, DXY
- NFP/Unemployment → SPY, DXY
- Oil inventories → CL=F, USO
- Natural Gas → NG=F, UNG
- Housing → XHB, ITB

### Phase 3: Detail View

**3.1 — Split pane: list ↔ detail**

When user presses Enter or double-clicks an event, the pane splits into a list (left/top) and detail panel (right/bottom). Use the same pattern as `DetailFeedView` but custom-built for economic data. Escape returns to full list view.

**3.2 — Detail panel: historical chart**

For events with a FRED mapping:
- Fetch the last 5 years of observations from FRED
- Render as an inline area chart using the existing chart renderer (`renderChart`)
- Show the series title, units, and source below the chart
- Chart height: ~40% of the detail panel

For events without a FRED mapping:
- Show event name, scheduled time, forecast, prior
- "No historical data available for this indicator"

**3.3 — Detail panel: historical readings table**

Below the chart, show a table of the last 12 releases:
- DATE | ACTUAL | FORECAST | PRIOR | SURPRISE
- Surprise = actual - forecast, colored green/red
- This data comes from FRED observations aligned to the ForexFactory event dates

**3.4 — Detail panel: related tickers**

Below the readings table, show related tickers with current quotes:
- "Related: TIP +0.3% | DXY -0.1% | ^TNX 4.32%"
- Clickable — uses navigateTicker

**3.5 — Detail panel: next release**

Show "Next release: Fri Apr 11, 08:30 ET" at the bottom of the detail, pulled from the calendar data.

### Phase 4: Data Quality

**4.1 — Backfill actuals from FRED**

After calendar events load, for past US events with FRED mappings, fetch the corresponding FRED observation and populate the `actual` field. This makes the calendar grid show real actual values with beat/miss coloring.

**4.2 — Persistent cache**

Use ResourceStore for FRED data so it survives app restarts. Cache key: `fred:${seriesId}`. TTL: 24 hours for historical data (it doesn't change), 1 hour for the most recent observation.

---

## Priority Order

1. Phase 1.1 + 1.2 + 1.4 (date grouping, now marker, country filter, counts) — biggest usability wins
2. Phase 2.1 + 2.2 (FRED client + series mapping) — prerequisite for everything else
3. Phase 3.1 + 3.2 + 3.3 (detail view with chart + readings) — the signature Bloomberg feature
4. Phase 1.3 + 1.5 + 1.6 (countdown, flags, impact indicators) — polish
5. Phase 3.4 + 3.5 (related tickers, next release) — depth
6. Phase 4.1 + 4.2 (actual backfill, persistent cache) — data quality
7. Phase 2.3 (related ticker mapping) — nice to have
