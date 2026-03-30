<center>
# Gloomberb

Extensible financial terminal, for the terminal.

> Why pay for Bloomberg when you can have Gloomberb?

<!-- screenshots go here -->
</center>

## Features

- **Track portfolios & trade**
- **Real-time quotes & fundamentals**
- **Beautiful terminal charts**
- **Keyboard-driven**
- **Extensible**
- **100% local**

## Install

```bash
bun install -g gloomberb
# or
npm install -g gloomberb
```

Then run `gloomberb` to start.

## Plugins

Gloomberb has a plugin architecture where everything, from the portfolio list to broker integrations, is a plugin. 

Plugins can add tabs, columns, commands, status bar widgets, and more.

See **[PLUGINS.md](PLUGINS.md)** for the plugin API and the shared UI surface available through `gloomberb/components`.

### Core plugins

| Plugin | Description |
|--------|-------------|
| **Portfolio List** | Main ticker list with portfolios & watchlists |
| **Ticker Detail** | Overview, financials, and chart tabs |
| **News** | View latest news for each ticker (via Yahoo Finance) |
| **SEC** | View recent SEC filings for supported US equities |
| **Notes** | Write and save markdown notes, stored locally |
| **Options** | View US equity options chains |
| **Ask AI** | Chat with AI about tickers using local CLI tools |
| **Compare Charts** | Compare multiple ticker charts overlaid on one shared chart |
| **X Scanner** | WIP |
| **Alerts** | WIP |
| **Scanner** | WIP |

### Data providers

| Provider | Description |
|----------|-------------|
| **Gloomberb Cloud** | Real-time data (recommended, free) |
| **Yahoo Finance** | Delayed data, rate-limiting |

### Brokers connectors

| Plugin | Description |
|--------|-------------|
| **IBKR** | Import positions from Interactive Brokers (Flex Query or Gateway API) |
| **Manual Entry** | Manually add positions, saved locally |

Toggleable plugins can be enabled/disabled from the command bar screen (`Ctrl+p`).

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
