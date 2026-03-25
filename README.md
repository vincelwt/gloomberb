# Gloomberb Terminal

A Bloomberg-inspired stock portfolio tracker for your terminal. Built with [OpenTUI](https://github.com/msmps/opentui) + React + Bun.

```
+--[ GLOOMBERB TERMINAL ]----------[ 15:42:03 ]--[ USD ]--+
|                          |                               |
| [Main Portfolio|Tech WL] | [Overview|Financials|Chart]   |
| -------------------------|                               |
| TICKER  PRICE   CHG%  PE | AAPL - Apple Inc.            |
| AAPL   $189.50 +1.2% 29 | Price: $189.50  (+$2.24)     |
|>MSFT   $420.10 -0.3% 35 | ▁▂▃▄▅▆▅▄▅▆▇▆▅▆▇▆▅▆▇█▇▆▇    |
| GOOGL  $175.80 +0.8% 25 | MCap: $2.91T  P/E: 29.1     |
| NVDA   $875.30 +2.1% 62 | Revenue: $391B  FCF: $112B   |
+---[ Ctrl+P search | Tab switch | q quit ]---------------+
```

## Features

- **Two-panel Bloomberg layout** with amber-on-black theme
- **Yahoo Finance integration** for real-time quotes, fundamentals, and 5-year price history
- **Markdown-based storage** - one `.md` file per ticker with YAML frontmatter, perfect for LLM agents
- **Multiple portfolios & watchlists** with configurable columns
- **Plugin architecture** - everything is a plugin, including core panes and broker integrations
- **Prefix command bar** (`Ctrl+P`) for fast keyboard-driven workflow
- **Multi-currency** support with cached exchange rates
- **ASCII stock charts** using braille characters with price/time axes
- **Editable notes** per ticker, saved to markdown
- **Interactive Brokers** integration via Flex Queries
- **Local-first** - all data stays on your machine (SQLite cache + markdown files)

## Quick Start

```bash
# Install dependencies
bun install

# Run
bun dev
```

On first launch, data is stored in `~/gloomberb-data/`. Each ticker gets its own markdown file:

```markdown
---
ticker: AAPL
exchange: NASDAQ
currency: USD
name: Apple Inc.
sector: Technology
portfolios:
  - main
watchlists:
  - tech
---

## Notes

Strong services growth. Watch for Vision Pro adoption.
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+P` or `` ` `` | Open command bar |
| `Tab` | Switch between left/right panels |
| `j` / `k` | Navigate ticker list |
| `h` / `l` | Switch tabs |
| `r` | Refresh selected ticker |
| `Shift+R` | Refresh all tickers |
| `Ctrl+,` | Open settings |
| `q` | Quit |

## Command Bar Prefixes

The command bar uses a prefix system for fast actions:

| Prefix | Action |
|--------|--------|
| `T <query>` | Search Yahoo Finance for a ticker |
| `AW` | Add current ticker to watchlist |
| `AP` | Add current ticker to portfolio |
| `RW` | Remove from watchlist |
| `RP` | Remove from portfolio |
| `NP` | New portfolio |
| `NW` | New watchlist |
| `R` | Refresh current ticker |
| `RA` | Refresh all |
| `IB` | Import from Interactive Brokers |
| `S` | Open settings |

## Architecture

Everything is a plugin. Core features use the same `GloomPlugin` interface as external extensions.

```
src/
  plugins/
    registry.ts          # OpenTUI slot-based plugin system
    pane-manager.ts      # Customizable pane layout
    builtin/
      portfolio-list.tsx # Left pane (portfolios + watchlists)
      ticker-detail.tsx  # Right pane (overview, financials, chart, notes)
      ibkr-flex.tsx      # IBKR Flex Query broker plugin
      manual-entry.tsx   # Manual position entry
  sources/
    yahoo-finance.ts     # Yahoo Finance client with retry + caching
  data/
    markdown-store.ts    # Ticker markdown file read/write
    sqlite-cache.ts      # Bun SQLite cache for Yahoo data
```

### Plugin Slots

Plugins can extend the UI through defined slots:

- `detail:tab` / `detail:section` - Add tabs or sections to the detail pane
- `list:column` - Custom columns in the ticker list
- `command:extra` / `command:preset` - Extend the command bar
- `status:widget` - Status bar widgets
- `config:section` - Settings page sections
- `data:post-refresh` / `data:enricher` - Hook into data lifecycle

### Planned Plugins

- News feed pane
- Chat component
- Option chain viewer
- Analyst ratings
- Tweet/social scanner
- Crypto feeds
- Custom columns (conviction score, etc.)
- Live stock feeds

## Data Storage

| Data | Storage | Why |
|------|---------|-----|
| Ticker metadata, positions, notes | Markdown files | Agent-readable, version-controllable |
| Yahoo Finance cache | SQLite (`bun:sqlite`) | Fast TTL-based lookup |
| Exchange rates | SQLite | Cached with 1hr TTL |
| Price history | SQLite | Large dataset, bad fit for markdown |
| App config | `config.json` | User settings |

## Requirements

- [Bun](https://bun.sh) runtime
- A terminal with true color support

## License

MIT
