# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
bun run dev          # Run with --watch (auto-restart on changes)
bun run start        # Run once
bun run build        # Build binary
bun run build:all    # Build for all platforms
bun test             # Run all tests
bun test src/utils/format.test.ts              # Run a single test file
bun test --test-name-pattern "formats currency" # Run tests matching a pattern
```

## Architecture

Gloomberb is a Bloomberg-style terminal stock tracker built with Bun and OpenTUI (a React-based TUI framework using `@opentui/core` and `@opentui/react`). Entry point is `src/index.tsx`.

### Plugin System

Everything is a plugin. The `PluginRegistry` (`src/plugins/registry.ts`) manages all extensibility: panes, pane templates, commands, columns, brokers, data providers, detail tabs, keyboard shortcuts, and ticker actions. Plugins implement the `GloomPlugin` interface (`src/types/plugin.ts`) and register via a context object.

- **Built-in plugins** (`src/plugins/builtin/`): chart, portfolio list, news, notes, chat/AI, SEC filings, options, help, comparison charts, screener, manual entry, debug
- **IBKR plugin** (`src/plugins/ibkr/`): Interactive Brokers gateway integration for live trading, positions, and real-time quotes
- **Prediction markets plugin** (`src/plugins/prediction-markets/`): Polymarket integration
- **External plugins** load from `~/.gloomberb/plugins/` at startup (`src/plugins/loader.ts`)

Plugins communicate via an `EventBus` (`src/plugins/event-bus.ts`). Layout is managed through a dock system (`src/plugins/pane-manager.ts`) with docked and floating panes.

### Data Flow

Market data flows through a layered provider system:

1. **ProviderRouter** (`src/sources/provider-router.ts`) orchestrates multiple data sources with fallback: Yahoo Finance, SEC EDGAR, Gloomberb Cloud, and broker adapters
2. **MarketDataCoordinator** (`src/market-data/coordinator.ts`) manages request deduplication, caching, and reactive state via `QueryStore`
3. **React hooks** (`src/market-data/hooks.ts`) expose coordinator state to components

### State Management

- **AppContext** (`src/state/app-context.tsx`): Central React context with `useReducer`-based state for layout, tickers, config, and UI state
- **SessionStore** (`src/data/session-store.ts`), **ResourceStore**, **PluginStateStore**: Zustand-like stores for different persistence scopes
- **Pane state**: Each pane has independent runtime state (`PaneRuntimeState`) tracked by instance ID
- Config persists to `~/.gloomberb/` as JSON; resource cache uses SQLite (`src/data/sqlite-database.ts`)

### Key Type Definitions

Core domain types live in `src/types/`: `ticker.ts` (instruments), `financials.ts` (quotes/prices), `config.ts` (app/layout config), `plugin.ts` (plugin API), `broker.ts` (broker adapters), `trading.ts` (orders/positions).

### Rendering

Charts use a dual renderer: Kitty graphics protocol for high-res rendering in supported terminals (`src/components/chart/native/`), with a Unicode fallback. The command bar (`src/components/command-bar/`) handles ticker search, plugin commands, and workflow-driven multi-step interactions.
