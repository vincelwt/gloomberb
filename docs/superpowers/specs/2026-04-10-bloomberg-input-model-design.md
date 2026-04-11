# Bloomberg Input Model Redesign

A fundamental redesign of the keyboard input model to match Bloomberg Launchpad's always-active command line pattern. Every pane gets a persistent command line. Letter keys always go to the command line. Arrow keys handle all in-content navigation.

**Status: PLANNED — execute after news system is complete.**

---

## Current Model (Problems)

- Global modal command palette (Ctrl+P to open, Escape to close)
- Letter keys consumed by pane content (j/k navigation, a for add, f for filter, r for refresh, d for delete)
- Each pane has different letter shortcuts — no consistency
- `SET_INPUT_CAPTURED` hack needed when panes want text input (alerts form, portfolio add)
- App-level letter key handlers conflict with pane-level handlers (the `a` key fight)
- Users must learn per-pane shortcuts — no discoverability

## Target Model (Bloomberg Launchpad)

### Core Principle: Letters → Command Line, Arrows → Content

| Key | Behavior |
|-----|----------|
| Letter keys, numbers, symbols | Always type into the active pane's command line |
| Arrow Up/Down | Navigate rows within pane content |
| Arrow Left/Right | Switch tabs within pane (or scroll horizontally) |
| Enter | Execute command line input, OR select current row if command line is empty |
| Escape | Clear command line, or close floating pane if already empty |
| Tab | Switch focus to next pane (equivalent to Bloomberg's `<PANEL>` key) |
| Page Up/Down | Scroll content by page |

### Per-Pane Command Line

Every pane renders a persistent command line at the top (below the title bar, above the content). It shows:
- The current input text with cursor
- Autocomplete suggestions as you type
- The pane's "loaded security" (if applicable)

```
┌─── :: Portfolios ─────────────────────────────────┐
│ > NVDA_                          [autocomplete...] │  ← command line
│ Main Portfolio   Research   Commodities            │  ← tabs
│ TICKER   LAST      CHG%     MCAP                   │  ← content
│ AAPL     261.35    +0.33%   3.76T                  │
│ NVDA     189.81    +3.21%   4.31T                  │  ← arrow keys navigate
└────────────────────────────────────────────────────┘
```

### Command Resolution

The command line accepts:

1. **Mnemonics** — `MOST`, `ECO`, `TOP`, `N`, `GC`, etc. → opens that function
2. **Ticker symbols** — `AAPL`, `NVDA` → navigates to that security (same as navigateTicker)
3. **Pane-local commands** — prefixed with `/`:
   - `/add` or `/a` — add ticker (replaces the `a` key shortcut)
   - `/filter` or `/f` — toggle filter
   - `/refresh` or `/r` — refresh data
   - `/delete` or `/d` — delete selected item
   - `/sort` — cycle sort
4. **Search** — any text that doesn't match a mnemonic or ticker → search

### Autocomplete

As the user types, the command line shows suggestions:
- Matching mnemonics (if input matches a known function code)
- Matching ticker symbols (from local database + provider search)
- Matching pane-local commands (if input starts with `/`)

### Pane-Specific Context

Some panes extend the command resolution:
- **Alerts pane**: `/add` opens the inline alert form, typing a ticker + condition resolves to alert creation
- **Portfolio pane**: `/add` adds a ticker, typing a ticker navigates to it
- **ECON pane**: `/filter` cycles impact filter, `/country` cycles country filter
- **Industry news (NI)**: typing a sector name filters to that sector

### Security Loading

When you type a ticker and press Enter in any pane:
- If the pane supports security context (detail pane, chart, etc.) → loads that security
- If the pane doesn't (ECON, MOST, etc.) → opens a detail pane for that security via navigateTicker

This matches Bloomberg's "loaded security" concept where typing a ticker + GO in any panel loads it.

---

## Migration Plan

### Phase 1: Command Line Component

Create a reusable `PaneCommandLine` component:
- Text input with cursor
- Autocomplete dropdown
- Mnemonic resolution
- Ticker resolution
- `/` command parsing
- Renders as a 1-row box at the top of every pane

### Phase 2: Arrow-Only Content Navigation

Migrate all panes from letter-key navigation to arrow-key-only:
- Replace `j`/`k` with `down`/`up` (many panes already support both — just remove `j`/`k`)
- Replace `h`/`l` with `left`/`right`
- Remove `a`, `f`, `r`, `d` single-letter shortcuts
- Remove `SET_INPUT_CAPTURED` hack entirely

Affected panes:
- Portfolio list (j/k/h/l/a)
- Market movers (j/k/h/l/r)
- World indices (j/k)
- Economic calendar (j/k/f/c/r)
- Alerts (j/k/a/d)
- Sector performance (j/k/r)
- Earnings (j/k/r)
- Correlation (none — already minimal)
- Analytics (j/k)
- FX matrix (r)
- Yield curve (r)
- Insider tab (j/k/f)
- All upstream panes (chat, ticker detail, options, etc.)

### Phase 3: Remove Global Command Bar

- Remove Ctrl+P modal overlay
- Remove the `CommandBar` component's role as the primary input method
- The command bar's search/autocomplete logic moves into `PaneCommandLine`
- Ticker search, command matching, and workflow wizards are triggered from the per-pane command line

### Phase 4: Upstream Pane Migration

Migrate upstream-owned panes to the new model:
- Chat pane (has its own text input — special case)
- Ticker detail (tab switching via arrow keys)
- Notes pane (has its own text editor — special case)
- Help pane

---

## Risks & Open Questions

1. **Chat and Notes panes** have their own text input areas. These need special handling — when typing in the chat input or notes editor, the command line should NOT intercept. Need a "text editing mode" concept.

2. **Upstream compatibility** — this changes the fundamental input model. Upstream maintainer may not want this. Consider making it opt-in via a config flag.

3. **Discoverability** — letter shortcuts (a for add, f for filter) are faster for power users than typing `/add`. But they're inconsistent and undiscoverable. The command line is always visible and consistent.

4. **Wizard flows** — the current command bar handles multi-step wizards (set alert, add to portfolio). These need to work from the per-pane command line too.

5. **Performance** — autocomplete on every keystroke needs to be fast. Debounce ticker search to avoid hammering the provider.

---

## Not In Scope

- Mouse-only navigation changes (mouse interaction stays the same)
- Terminal multiplexer integration (tmux pane switching)
- Custom key binding configuration (future enhancement)
