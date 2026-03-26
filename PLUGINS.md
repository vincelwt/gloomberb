# Building Plugins

Gloomberb is built on a plugin architecture — core features like the portfolio list and ticker detail view are plugins themselves. You can extend the app by writing your own.

## Installing plugins

Install plugins from GitHub:

```bash
gloomberb install user/repo        # from GitHub shorthand
gloomberb install https://github.com/user/repo  # from full URL
```

Manage installed plugins:

```bash
gloomberb plugins                  # list installed plugins
gloomberb update                   # update all plugins
gloomberb update my-plugin         # update a specific plugin
gloomberb remove my-plugin         # remove a plugin
```

Plugins are installed to `~/.gloomberb/plugins/`.

## Plugin structure

A plugin implements the `GloomPlugin` interface:

```typescript
import type { GloomPlugin } from "gloomberb/types/plugin";

export const myPlugin: GloomPlugin = {
  id: "my-plugin",
  name: "My Plugin",
  version: "1.0.0",
  description: "What it does",
  toggleable: true, // let users enable/disable from settings

  setup(ctx) {
    // Register tabs, commands, columns, etc.
  },

  dispose() {
    // Cleanup (optional)
  },
};

export default myPlugin;
```

For external plugins, create a directory in `~/.gloomberb/plugins/`:

```
~/.gloomberb/plugins/my-plugin/
  index.ts        # export default myPlugin
  package.json    # optional, for dependencies
```

## What plugins can do

The `setup()` function receives a context object with these capabilities:

### Registration methods

| Method | What it does |
|--------|-------------|
| `ctx.registerDetailTab(tab)` | Add a tab to the ticker detail pane |
| `ctx.registerCommand(cmd)` | Add a command to the command bar |
| `ctx.registerColumn(col)` | Add a custom column to the ticker list |
| `ctx.registerPane(pane)` | Add a full pane (left/right/bottom) |
| `ctx.registerBroker(broker)` | Add a broker integration |
| `ctx.registerDataProvider(provider)` | Add a data source |
| `ctx.registerShortcut(shortcut)` | Add a global keyboard shortcut |
| `ctx.registerTickerAction(action)` | Add a per-ticker action (shown via `a` key) |
| `ctx.registerFloatingWidget(widget)` | Add a floating overlay widget |

### Data access

| Method | Returns |
|--------|---------|
| `ctx.getData(ticker)` | Cached financials for a ticker |
| `ctx.getTicker(ticker)` | Ticker file metadata and notes |
| `ctx.getConfig()` | Current app config |
| `ctx.dataProvider` | The active data provider instance |
| `ctx.markdownStore` | The ticker persistence store |

### Plugin storage

Persistent key-value storage scoped to your plugin (backed by SQLite):

```typescript
ctx.storage.set("my-key", { count: 42 });
const data = ctx.storage.get<{ count: number }>("my-key"); // { count: 42 }
ctx.storage.delete("my-key");
ctx.storage.keys(); // ["my-key"]
```

### Navigation

```typescript
ctx.selectTicker("AAPL");          // Select ticker + focus right panel
ctx.switchPanel("left");           // Switch active panel
ctx.switchTab("chart");            // Switch detail tab by id
ctx.openCommandBar();              // Open the command bar
```

### Events

Subscribe to app events:

```typescript
ctx.on("ticker:selected", ({ symbol, previous }) => {
  console.log(`Selected ${symbol}`);
});

ctx.on("ticker:refreshed", ({ symbol, financials }) => {
  // React to new data
});
```

Available events: `ticker:selected`, `ticker:refreshed`, `ticker:added`, `ticker:removed`, `config:changed`, `plugin:registered`, `plugin:unregistered`.

### Toast notifications

```typescript
ctx.showToast("Saved successfully", { type: "success" });
ctx.showToast("Something went wrong", { type: "error", duration: 5000 });
ctx.showToast("FYI...");  // defaults to "info"
```

### Floating widgets

```typescript
ctx.registerFloatingWidget({
  id: "my-widget",
  name: "My Widget",
  position: "top-right",  // top-left, top-right, bottom-left, bottom-right, center
  width: 40,
  height: 10,
  component: ({ width, height, focused, close }) => (
    <Box flexDirection="column" width={width} height={height}>
      <Text>Hello from widget!</Text>
    </Box>
  ),
});

// Show/hide programmatically
ctx.showWidget("my-widget");
ctx.hideWidget("my-widget");
```

## Reusable components

Plugins can import built-in UI components:

```typescript
import { StockChart, TabBar, ToggleList, colors } from "gloomberb/components";
import { useAppState, useSelectedTicker } from "gloomberb/components";
import { formatCurrency, formatCompact, padTo } from "gloomberb/components";
```

Available components:
- `StockChart` — interactive area, line, candlestick, and OHLC chart
- `TabBar` — tab navigation bar
- `ToggleList` — checkbox list with selection
- `colors` — theme color palette
- `useAppState()` — access full app state
- `useSelectedTicker()` — get currently selected ticker + financials

## Example: adding a detail tab

The simplest plugin type. This adds a new tab to the right-side detail pane:

```typescript
import React from "react";
import type { GloomPlugin, DetailTabProps } from "gloomberb/types/plugin";
import { useSelectedTicker, colors } from "gloomberb/components";

function SentimentTab({ width, height, focused }: DetailTabProps) {
  const { ticker } = useSelectedTicker();
  if (!ticker) return <text fg={colors.textDim}>No ticker selected</text>;

  return (
    <box flexDirection="column" width={width} height={height}>
      <text bold>Sentiment for {ticker.frontmatter.ticker}</text>
      <text>Your content here</text>
    </box>
  );
}

export default {
  id: "sentiment",
  name: "Sentiment",
  version: "1.0.0",
  description: "View market sentiment for each ticker",
  toggleable: true,
  setup(ctx) {
    ctx.registerDetailTab({
      id: "sentiment",
      name: "Sentiment",
      order: 60,
      component: SentimentTab,
    });
  },
} satisfies GloomPlugin;
```

## Example: adding a command

```typescript
setup(ctx) {
  ctx.registerCommand({
    id: "export-csv",
    label: "Export to CSV",
    keywords: ["export", "csv", "download"],
    category: "data",
    description: "Export current portfolio as CSV",
    async execute() {
      // your logic here
      ctx.showToast("Exported!", { type: "success" });
    },
  });
}
```

Commands can also define a multi-step wizard flow:

```typescript
ctx.registerCommand({
  id: "set-alert",
  label: "Set Price Alert",
  keywords: ["alert", "notify"],
  category: "data",
  wizard: [
    { key: "price", label: "Alert price", type: "text" },
    { key: "direction", label: "Direction", type: "select", options: ["above", "below"] },
  ],
  async execute(values) {
    // values.price, values.direction
  },
});
```

## Example: adding a custom column

```typescript
setup(ctx) {
  ctx.registerColumn({
    id: "conviction",
    label: "Conv.",
    width: 6,
    align: "right",
    render(ticker, financials) {
      const score = ticker.frontmatter?.conviction ?? "-";
      return String(score);
    },
  });
}
```

## Example: keyboard shortcut

```typescript
setup(ctx) {
  ctx.registerShortcut({
    id: "my-shortcut",
    key: "s",
    ctrl: true,
    description: "Save snapshot",
    execute() {
      // your logic
      ctx.showToast("Snapshot saved");
    },
  });
}
```

## Example: ticker action

```typescript
setup(ctx) {
  ctx.registerTickerAction({
    id: "open-in-browser",
    label: "Open in Yahoo Finance",
    keywords: ["open", "yahoo", "browser"],
    execute(ticker) {
      // open URL...
    },
  });
}
```

Ticker actions appear when pressing `a` with a ticker selected.

## Slot renderers

For advanced UI injection, plugins can provide slot renderers directly:

```typescript
export const myPlugin: GloomPlugin = {
  id: "my-plugin",
  name: "My Plugin",
  version: "1.0.0",
  slots: {
    "status:widget": () => <text> LIVE</text>,
    "detail:section": ({ ticker, financials }) => (
      <box><text>Extra info for {ticker.frontmatter.ticker}</text></box>
    ),
  },
};
```

Available slots:

| Slot | Props | Where it renders |
|------|-------|-----------------|
| `detail:tab` | `{ ticker, financials }` | Tab in the detail pane |
| `detail:section` | `{ ticker, financials }` | Section within detail view |
| `list:column` | `{ ticker, financials }` | Column in the ticker list |
| `command:extra` | `{ query }` | Extra items in command bar |
| `command:preset` | `{}` | Preset commands |
| `status:widget` | `{}` | Status bar widget |
| `config:section` | `{}` | Section in settings |
| `data:post-refresh` | `{ ticker, financials }` | After data refresh |
| `data:enricher` | `{ ticker }` | Enrich ticker data |

## Detail tab props

Tab components receive these props:

```typescript
interface DetailTabProps {
  width: number;
  height: number;
  focused: boolean;
  onCapture(capturing: boolean): void;
}
```

Call `onCapture(true)` when your tab needs exclusive keyboard input (e.g., a text editor or chat input) and `onCapture(false)` when done, so global shortcuts keep working.

## Tips

- Look at the built-in plugins in `src/plugins/builtin/` for real-world examples
- Use `order` on detail tabs to control position (core tabs use 10, 20, 30)
- Toggleable plugins can be enabled/disabled by users from settings (`Ctrl+,`)
- The UI is built with [OpenTUI](https://github.com/anthropics/opentui) React — use `<box>`, `<text>`, and `<input>` for layout
- Use `ctx.storage` to persist data across app restarts
- Use `ctx.on()` to react to app events without polling
- Use `ctx.showToast()` for non-intrusive user feedback
