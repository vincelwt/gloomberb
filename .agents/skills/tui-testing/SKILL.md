---
name: tui-testing
description: >-
  Testing Gloomberb at every level: CLI commands for fast data/integration checks,
  OpenTUI's built-in test harness for component tests, and tmux for full end-to-end
  TUI testing. Use this skill when you need to verify features, write regression
  tests, or smoke-test the running app.
---

# Testing Gloomberb

Three testing approaches. **Start with the simplest level that covers your change** and escalate only when needed.

## Critical Rule

Cleanup is part of testing. If you start `tmux`, a dev server, a watcher, or any other background process while testing, stop it before you finish the task, even if the test fails.

- Prefer named `tmux` sessions and end them with `tmux kill-session -t <name>`.
- If you start a background process without `tmux`, capture its PID and terminate it explicitly with `kill <pid>` or the matching shutdown command.
- Do not leave test helpers running across iterations unless the workflow explicitly requires it and you clean them up before handoff.

```
What are you testing?
├─ Data flow, config, business logic, or integration with external sources
│  ├─ CLI command exists for it → Run the CLI command (fastest)
│  └─ No CLI command, but it makes sense as one → Add it, then use it
├─ A component's rendering, interaction, or visual regression
│  └─ OpenTUI test harness (.test.tsx file)
├─ Pure logic with no UI or data layer
│  └─ Unit test (bun:test, no renderer needed)
└─ Full app behavior across multiple views
   └─ tmux (last resort)
```

---

## 1. CLI Commands (fastest feedback loop)

Gloomberb doubles as a CLI tool. CLI commands are the **fastest way to verify data flow, config state, and business logic** — no renderer, no harness setup, just run and check output.

### Available commands

```bash
bun run dev help                        # Show all commands
bun run dev portfolio                   # List all portfolios/watchlists with ticker counts
bun run dev portfolio "Main Portfolio"  # Show detailed positions, P&L, quotes
bun run dev ticker AAPL                 # Show quote, fundamentals, positions
bun run dev plugins                     # List installed plugins
```

### When to use CLI testing

- **Verifying data layer changes** — After modifying config, ticker storage, or persistence, run `portfolio` or `ticker` to confirm data loads correctly.
- **Checking new data fields** — If you add a new field (e.g. earnings date), first expose it via the `ticker` CLI command and verify the output, before wiring it into the TUI.
- **Smoke-testing integrations** — `ticker AAPL` exercises the Yahoo Finance client, quote formatting, and fundamentals parsing in one command.
- **Testing plugin management** — `install`, `remove`, `update`, and `plugins` commands verify the plugin lifecycle.

### Adding new CLI commands

If you're building a feature and need to verify data that isn't exposed via CLI yet, consider adding a CLI command first when it makes sense (e.g. listing watchlists, showing config values, checking broker sync status). This gives you a fast feedback loop before building the TUI component.

The CLI dispatcher is in `src/cli.ts` — add a new case to the `switch` in `runCli()`.

### Example: verifying a data change via CLI

```bash
# After modifying how positions are calculated:
$ bun run dev portfolio "Main Portfolio"
Main Portfolio (USD)

TICKER    PRICE         CHG%    SHARES  AVG COST      P&L
------------------------------------------------------------
AMD         $201.99    -0.87%    100     $150.00    +$5,199.00
------------------------------------------------------------
                                              Total: +$5,199.00
```

---

## 2. OpenTUI Test Harness (component & snapshot tests)

Headless, deterministic component and integration tests using Bun's test runner and OpenTUI's built-in test renderer. **Use this for UI component tests and visual regressions.**

### Why use this

- **Deterministic** — `renderOnce()` guarantees the frame is complete before capture. No timing guesswork.
- **Fast** — Full suite runs in < 1 second.
- **Isolated** — Each test gets its own headless renderer. No shared state, no cleanup burden.
- **Composable** — Render individual components with controlled props/state.
- **Snapshotable** — Built-in `toMatchSnapshot()` for visual regression testing.

### Quick start

```typescript
import { test, expect, afterEach } from "bun:test";
import { testRender } from "@opentui/react/test-utils";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
});

test("renders my component", async () => {
  testSetup = await testRender(<MyComponent someProp="value" />, {
    width: 80,
    height: 24,
  });

  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();

  expect(frame).toContain("expected text");
  // or: expect(frame).toMatchSnapshot();
});
```

### Interaction testing

Use `mockInput` and React's `act()` to simulate user input:

```typescript
import { act } from "react";

test("arrow keys navigate the list", async () => {
  testSetup = await testRender(<MyList items={items} />, {
    width: 80,
    height: 24,
  });

  await testSetup.renderOnce();

  await act(async () => {
    testSetup!.mockInput.pressArrow("down");
    await testSetup!.renderOnce();
  });

  expect(testSetup.captureCharFrame()).toContain("▸ Second Item");
});
```

### Testing components that need app context

Many components require `AppContext`, `DialogProvider`, etc. Create a harness wrapper:

```typescript
function TestHarness({ children, overrides = {} }) {
  const config = { ...createDefaultConfig("/tmp/test"), ...overrides };
  const state = { ...createInitialState(config), ...overrides };
  return (
    <AppContext value={{ state, dispatch: () => {} }}>
      <DialogProvider>{children}</DialogProvider>
    </AppContext>
  );
}
```

See `src/components/command-bar/command-bar.test.tsx` for a full example of this pattern.

### Test setup return object

| Property | Type | Description |
|----------|------|-------------|
| `renderer` | `Renderer` | The headless renderer instance |
| `renderOnce` | `() => Promise<void>` | Trigger a single render cycle |
| `captureCharFrame` | `() => string` | Capture current output as text |
| `resize` | `(w, h) => void` | Resize the virtual terminal |
| `mockInput` | `MockInput` | Simulate keyboard input (e.g. `pressArrow("down")`) |

### Running tests

```bash
bun test                              # Run all tests
bun test src/components/ui/ui.test.tsx # Run a specific file
bun test --filter "CommandBar"        # Filter by name
bun test --update-snapshots           # Update snapshot files
```

### Conventions

- Test files live next to source: `foo.tsx` → `foo.test.tsx`
- Always call `renderer.destroy()` in `afterEach`
- Always call `renderOnce()` before `captureCharFrame()`
- Use consistent dimensions for snapshot stability (80×24 default)

---

## 3. tmux (full end-to-end TUI testing)

Run the actual app in a tmux session, send keystrokes, and capture the rendered screen. **Use this as a last resort** — for verifying full-app behavior that can't be tested with the harness or CLI.

### When to use tmux

- Verifying layout and pane arrangement with real data
- Testing keyboard navigation flows across multiple views
- Smoke-testing after major refactors
- Debugging rendering issues that only appear with the full app

### Setup

```bash
# Kill any existing test session first
tmux kill-session -t test 2>/dev/null

# Start the app — use a fixed terminal size for consistent captures
tmux new-session -d -s test -x 120 -y 40 'bun run dev 2>&1'

# Wait for the app to render (2-3 seconds for initial load)
sleep 3
```

If you need to run the app without `tmux`, keep the process handle so you can shut it down:

```bash
bun run dev > /tmp/gloomberb-test.log 2>&1 &
app_pid=$!

# ... test whatever you need ...

kill "$app_pid"
wait "$app_pid" 2>/dev/null
```

### Capturing the screen

```bash
tmux capture-pane -t test -p
```

Returns the full rendered text grid including box-drawing characters. Does NOT capture colors or styling.

### Sending input

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

# Typing text (always use -l flag for literal strings)
tmux send-keys -t test -l 'AAPL'
```

**Important:** Always use `-l` for text input. Without it, each character is interpreted as a key name.

### Typical test flow

Always add `sleep 0.5` to `sleep 1` after sending input to let the UI re-render.

```bash
# 1. Start the app
tmux kill-session -t test 2>/dev/null
tmux new-session -d -s test -x 120 -y 40 'bun run dev 2>&1'
sleep 3

# 2. Capture initial state
tmux capture-pane -t test -p

# 3. Open command bar and search
tmux send-keys -t test C-p
sleep 0.5
tmux send-keys -t test -l 'AAPL'
sleep 0.5
tmux capture-pane -t test -p

# 4. Select and verify
tmux send-keys -t test Enter
sleep 1
tmux capture-pane -t test -p

# 5. Always clean up
tmux kill-session -t test
```

### Common command bar actions (Ctrl+P)

| Command              | Description                              |
|----------------------|------------------------------------------|
| (ticker symbol)      | Jump to or add a ticker                  |
| Add Pane / Remove Pane | Manage panes in layout                 |
| New Portfolio / New Watchlist | Create collections                |
| Delete Portfolio / Delete Watchlist | Remove collections         |
| Edit Columns         | Toggle visible table columns             |
| Change Theme         | Switch color theme                       |
| Manage Plugins       | Toggle plugins on/off                    |

### Tips

- **Timing:** If captures look incomplete, increase sleep duration. Network-dependent views take longer.
- **Terminal size:** `-x 120 -y 40` gives consistent layout. Smaller sizes may cause wrapping.
- **Cleanup:** Always kill the `tmux` session or any other background process you started when done.
- **Debugging crashes:** stderr is captured via `2>&1` so crash output is visible.
