# Building Plugins

Gloomberb is built on a plugin architecture — core features like the portfolio list and ticker detail view are plugins themselves. You can extend the app by writing your own.

## Plugin structure

A plugin implements the `GloomPlugin` interface:

```typescript
import type { GloomPlugin } from "./types/plugin";

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
```

Then register it in `src/app.tsx`:

```typescript
import { myPlugin } from "./plugins/builtin/my-plugin";
pluginRegistry.register(myPlugin);
```

## What plugins can do

The `setup()` function receives a context object with these registration methods:

| Method | What it does |
|--------|-------------|
| `ctx.registerDetailTab(tab)` | Add a tab to the ticker detail pane |
| `ctx.registerCommand(cmd)` | Add a command to the command bar |
| `ctx.registerColumn(col)` | Add a custom column to the ticker list |
| `ctx.registerPane(pane)` | Add a full pane (left/right/bottom) |
| `ctx.registerBroker(broker)` | Add a broker integration |
| `ctx.registerDataProvider(provider)` | Add a data source |

The context also provides data accessors:

| Method | Returns |
|--------|---------|
| `ctx.getData(ticker)` | Cached financials for a ticker |
| `ctx.getTicker(ticker)` | Ticker file metadata and notes |
| `ctx.getConfig()` | Current app config |

## Example: adding a detail tab

The simplest plugin type. This adds a new tab to the right-side detail pane:

```typescript
import React, { useState } from "react";
import { Text, Box } from "@anthropic-ai/opentui/react";
import type { GloomPlugin, DetailTabProps } from "../types/plugin";
import { useTickerStore } from "../stores/ticker-store";

function SentimentTab({ width, height, focused }: DetailTabProps) {
  const selectedTicker = useTickerStore((s) => s.selectedTicker);

  if (!selectedTicker) {
    return <Text>No ticker selected</Text>;
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Text bold>Sentiment for {selectedTicker}</Text>
      <Text>Your content here</Text>
    </Box>
  );
}

export const sentimentPlugin: GloomPlugin = {
  id: "sentiment",
  name: "Sentiment",
  version: "1.0.0",
  description: "View market sentiment for each ticker",
  toggleable: true,

  setup(ctx) {
    ctx.registerDetailTab({
      id: "sentiment",
      name: "Sentiment",
      order: 60, // core tabs use 10/20/30, so 60+ for custom tabs
      component: SentimentTab,
    });
  },
};
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
      // Return a string to display in the column
      const score = ticker.frontmatter?.conviction ?? "-";
      return String(score);
    },
  });
}
```

## Slot renderers

For more advanced UI injection, plugins can provide slot renderers directly:

```typescript
export const myPlugin: GloomPlugin = {
  id: "my-plugin",
  name: "My Plugin",
  version: "1.0.0",

  slots: {
    "status:widget": () => <Text> LIVE</Text>,
    "detail:section": ({ ticker, financials }) => (
      <Box>
        <Text>Extra info for {ticker.frontmatter.ticker}</Text>
      </Box>
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
  width: number;          // Available width
  height: number;         // Available height
  focused: boolean;       // Whether this tab has focus
  onCapture(capturing: boolean): void; // Call when capturing keyboard input
}
```

Call `onCapture(true)` when your tab needs exclusive keyboard input (e.g., a text editor or chat input) and `onCapture(false)` when done, so global shortcuts keep working.

## Tips

- Look at the built-in plugins in `src/plugins/builtin/` for real-world examples
- Use `order` on detail tabs to control position (core tabs use 10, 20, 30)
- Toggleable plugins can be enabled/disabled by users from settings (`Ctrl+,`)
- The UI is built with [OpenTUI](https://github.com/anthropics/opentui) React — use `<Box>`, `<Text>`, and `<Input>` for layout
