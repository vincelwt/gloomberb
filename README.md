# Gloomberb

An open-source, extensible portfolio tracker and stock terminal for your command line.

<!-- screenshots go here -->

## Features

- **Track portfolios & watchlists** — manage multiple portfolios and watchlists with customizable, sortable columns
- **Real-time quotes & fundamentals** — powered by Yahoo Finance with automatic caching
- **Terminal stock charts** — interactive area, line, candlestick, and OHLC render modes
- **Multi-currency** — automatic exchange rate conversion
- **Keyboard-driven** — fast command bar (`Ctrl+P`) and vim-style navigation
- **Extensible via plugins** — everything is a plugin, including core features
- **100% local** — all your data stays on your machine. Ticker metadata, market data, chat state, and plugin state are stored in SQLite; notes stay as local markdown files. Nothing is sent anywhere.

## Install

```bash
bun install -g gloomberb
# or
npm install -g gloomberb
```

Then run `gloomberb` to start.

Your data is stored in `~/gloomberb-data/`. Ticker metadata and cached app state live in SQLite, and per-ticker notes are saved as markdown files next to the database.

## Plugins

Gloomberb has a plugin architecture where everything — from the portfolio list to broker integrations — is a plugin. Plugins can add tabs, columns, commands, status bar widgets, and more.

Plugins and built-in panes share a common TUI component kit for tabs, lists, toggles, buttons, dialogs, loading states, and status feedback. See **[PLUGINS.md](PLUGINS.md)** for the plugin API and the shared UI surface available through `gloomberb/components`.

### Core & UI plugins

| Plugin | Description | Toggleable |
|--------|-------------|------------|
| **Portfolio List** | Main ticker list with portfolios & watchlists | No (core) |
| **Ticker Detail** | Overview, financials, and chart tabs | No (core) |
| **News** | View latest news for each ticker (via Yahoo Finance) | Yes |
| **Notes** | Write and save markdown notes per ticker, stored locally | Yes |
| **Ask AI** | Chat with AI about tickers using local CLI tools | Yes |
| **Charts** | _WIP_ | — |

### Data providers

| Provider | Description |
|----------|-------------|
| **Yahoo Finance** | Real-time quotes, fundamentals, and historical data |
| **Options Data** | Options chain data |
| **Twitter** | _WIP_ |

### Brokers / Portfolio

| Plugin | Description |
|--------|-------------|
| **Manual Entry** | Manually add positions |
| **IBKR Flex Query** | Import positions from Interactive Brokers |

Toggleable plugins can be enabled/disabled from the settings screen (`Ctrl+,`).

See **[PLUGINS.md](PLUGINS.md)** for a guide on building your own plugins.

### Plugin slots

Plugins extend the UI through defined slots:

- `detail:tab` / `detail:section` — tabs or sections in the detail pane
- `list:column` — custom columns in the ticker list
- `command:extra` / `command:preset` — extend the command bar
- `status:widget` — status bar widgets
- `config:section` — settings page sections
- `data:post-refresh` / `data:enricher` — hook into the data lifecycle

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+P` or `` ` `` | Open command bar |
| `Tab` | Switch between panels |
| `j` / `k` | Navigate ticker list |
| `h` / `l` | Switch tabs |
| `r` | Refresh selected ticker |
| `Shift+R` | Refresh all tickers |
| `Ctrl+,` | Open settings |
| `m` | Cycle chart mode in the chart tab |
| `q` | Quit |

## License

MIT
