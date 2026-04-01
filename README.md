<div align="center">

# 📉 Gloomberb

**Extensible financial terminal, for the terminal.**

> Why pay for Bloomberg when you can have Gloomberb?

<img src="https://gloomberb.com/landing-terminal.png" alt="Gloomberb terminal screenshot" width="720" />

</div>

## ✨ Features

- **Track portfolios & trade**
- **Real-time quotes & fundamentals**
- **Beautiful high-rez charts**
- **Fast & keyboard-driven**
- **Powerful layouts**
- **Extensible**
- **100% local**

For the best experience, use a [Kitty](https://sw.kovidgoyal.net/kitty/)-compatible terminal such as Ghostty, Kitty or WezTerm.

## 🚀 Install

```bash
bun install -g gloomberb
# or
npm install -g gloomberb
```

Then run `gloomberb` to start.

## 🧩 Plugins

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
| **IBKR** | Import positions from Flex Query or trade with Gateway API. |
| **Manual Entry** | Manually add positions, saved locally |

Toggleable plugins can be enabled/disabled from the command bar screen (`Ctrl+p`).

## ⌨️ Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+P` or `` ` `` | Open command bar |
| `Ctrl+x` | Close current window |
| `Tab` | Switch between panels |
 `j` / `k` | Navigate ticker list |
| `h` / `l` | Switch tabs |
| `Ctrl+,` | Open settings |
| `m` | Cycle chart mode in the chart tab |
| `q` | Quit |

## License

MIT
