# Gloomberb

An open-source, extensible portfolio tracker and stock terminal for your command line.

<!-- screenshots go here -->

## Features

- **Track portfolios & watchlists** — manage multiple portfolios and watchlists with customizable, sortable columns
- **Real-time quotes & fundamentals** — powered by Yahoo Finance with automatic caching
- **ASCII stock charts** — 5-year price history rendered with braille characters
- **Multi-currency** — automatic exchange rate conversion
- **Keyboard-driven** — fast command bar (`Ctrl+P`) and vim-style navigation
- **Extensible via plugins** — everything is a plugin, including core features
- **100% local** — all your data stays on your machine. Ticker data is stored as markdown files, market data is cached in SQLite. Nothing is sent anywhere.

## Install

Requires [Bun](https://bun.sh).

```bash
git clone https://github.com/vincelwt/gloomberb.git
cd gloomberb
bun install
bun dev
```

Your data is stored in `~/gloomberb-data/`. Each ticker gets its own markdown file with YAML frontmatter — easy to read, edit, and version control.

## Plugins

Gloomberb has a plugin architecture where everything — from the portfolio list to broker integrations — is a plugin. Plugins can add tabs, columns, commands, status bar widgets, and more.

### Default plugins

| Plugin | Description | Toggleable |
|--------|-------------|------------|
| **Portfolio List** | Main ticker list with portfolios & watchlists | No (core) |
| **Ticker Detail** | Overview, financials, and chart tabs | No (core) |
| **Manual Entry** | Manually add positions | No (core) |
| **IBKR Flex Query** | Import positions from Interactive Brokers | No (core) |
| **News** | View latest news for each ticker | Yes |
| **Notes** | Write and save notes per ticker | Yes |
| **Ask AI** | Chat with AI about tickers using local CLI tools | Yes |

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
| `q` | Quit |

## License

MIT
