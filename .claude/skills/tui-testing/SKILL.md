---
name: tui-testing
description: >-
  Interactive testing of the Gloomberb TUI app using tmux. Use this skill when
  you need to manually test the app's UI — navigating tabs, opening the command
  bar, selecting items, typing input, verifying rendered output, etc. This
  covers starting the app, sending keystrokes, capturing the screen, and
  validating what's displayed.
---

# TUI Testing with tmux

Test the Gloomberb terminal UI interactively by running it inside a tmux session and capturing the rendered output.

## Prerequisites

- `tmux` must be installed (`brew install tmux`)
- Dependencies installed (`bun install`)

## Setup

Start the app in a detached tmux session:

```bash
# Kill any existing test session first
tmux kill-session -t test 2>/dev/null

# Start the app — use a fixed terminal size for consistent captures
tmux new-session -d -s test -x 120 -y 40 'bun run dev 2>&1'

# Wait for the app to render (2-3 seconds for initial load)
sleep 3
```

## Capturing the Screen

Use `tmux capture-pane` to read what's currently displayed:

```bash
tmux capture-pane -t test -p
```

This returns the full rendered text grid including box-drawing characters, tab indicators, column headers, and content. It does NOT capture colors or styling.

## Sending Input

### Keystrokes and shortcuts

```bash
# Special keys
tmux send-keys -t test C-p          # Ctrl+P — open command bar
tmux send-keys -t test Escape        # Escape — close dialogs
tmux send-keys -t test Enter         # Enter — select/confirm
tmux send-keys -t test Tab           # Tab — switch tabs
tmux send-keys -t test Up            # Arrow keys
tmux send-keys -t test Down
tmux send-keys -t test j             # j/k — navigate lists
tmux send-keys -t test k
tmux send-keys -t test r             # r — refresh
tmux send-keys -t test q             # q — quit

# Shift combos (uppercase letter)
tmux send-keys -t test C             # Shift+C — open chat
```

### Typing text

Use the `-l` (literal) flag to type text strings:

```bash
tmux send-keys -t test -l 'AAPL'         # Type "AAPL"
tmux send-keys -t test -l 'add pane'     # Type "add pane"
```

**Important:** Always use `-l` for text input. Without it, each character is interpreted as a key name.

## Typical Test Flow

Always add a short delay (`sleep 0.5` to `sleep 1`) after sending input to let the UI re-render before capturing.

```bash
# 1. Start the app
tmux kill-session -t test 2>/dev/null
tmux new-session -d -s test -x 120 -y 40 'bun run dev 2>&1'
sleep 3

# 2. Capture initial state
tmux capture-pane -t test -p

# 3. Open command bar
tmux send-keys -t test C-p
sleep 0.5
tmux capture-pane -t test -p

# 4. Search for something
tmux send-keys -t test -l 'AAPL'
sleep 0.5
tmux capture-pane -t test -p

# 5. Select it
tmux send-keys -t test Enter
sleep 1
tmux capture-pane -t test -p

# 6. Clean up when done
tmux kill-session -t test
```

## Common Commands in the Command Bar (Ctrl+P)

These can be searched by typing in the command bar:

| Command              | Description                              |
|----------------------|------------------------------------------|
| (ticker symbol)      | Jump to or add a ticker                  |
| Add Pane             | Add a pane to the layout                 |
| Remove Pane          | Remove a pane from the layout            |
| Float Pane           | Detach a docked pane into floating       |
| Dock Pane            | Dock a floating pane back                |
| New Portfolio        | Create a new portfolio                   |
| New Watchlist        | Create a new watchlist                   |
| Delete Portfolio     | Remove a portfolio                       |
| Delete Watchlist     | Remove a watchlist                       |
| Edit Columns         | Toggle visible table columns             |
| Change Theme         | Switch color theme                       |
| Toggle Status Bar    | Show/hide keyboard shortcuts bar         |
| Add Broker Account   | Connect a new broker profile             |
| Sync Broker Account  | Sync positions for a connected broker    |
| Manage Plugins       | Toggle plugins on/off                    |
| Export Config        | Save config to file                      |

## Tips

- **Timing:** If captures look incomplete or stale, increase the sleep duration. Network-dependent views (prices, news) take longer.
- **Terminal size:** Using `-x 120 -y 40` gives a consistent layout. Smaller sizes may cause content to wrap or truncate differently.
- **Multiple actions:** You can chain commands with `&&` and `sleep`:
  ```bash
  tmux send-keys -t test C-p && sleep 0.5 && tmux send-keys -t test -l 'theme' && sleep 0.5 && tmux send-keys -t test Enter && sleep 1 && tmux capture-pane -t test -p
  ```
- **Cleanup:** Always kill the tmux session when done testing: `tmux kill-session -t test`
- **Debugging crashes:** If the app crashes, the tmux pane will show the error output since we redirect stderr with `2>&1`.
