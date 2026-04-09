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
  cliCommands: [
    {
      name: "my-plugin",
      description: "Run a plugin-owned CLI command",
      async execute(args, ctx) {
        console.log(`args: ${args.join(" ")}`);
      },
    },
  ],

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

Use `setup()` for interactive runtime registration, and `cliCommands` for root-level CLI commands that should be discoverable without running plugin setup.

The `setup()` function receives a context object with these capabilities:

### Registration methods

| Method | What it does |
|--------|-------------|
| `ctx.registerDetailTab(tab)` | Add a tab to the ticker detail pane |
| `ctx.registerCommand(cmd)` | Add a command to the command bar |
| `ctx.registerColumn(col)` | Add a custom column to the ticker list |
| `ctx.registerPane(pane)` | Add a full pane (left/right/bottom) |
| `ctx.registerPaneTemplate(template)` | Add a reusable pane template (see [Pane templates](#pane-templates)) |
| `ctx.registerBroker(broker)` | Add a broker integration |
| `ctx.registerDataProvider(provider)` | Add a data source |
| `ctx.registerShortcut(shortcut)` | Add a global keyboard shortcut |
| `ctx.registerTickerAction(action)` | Add a per-ticker action (shown via `a` key) |

### CLI commands

Plugins can also declare root CLI commands directly on the plugin object:

```typescript
import type { GloomPlugin } from "gloomberb/types/plugin";

export const myPlugin: GloomPlugin = {
  id: "my-plugin",
  name: "My Plugin",
  version: "1.0.0",
  cliCommands: [
    {
      name: "my-plugin",
      aliases: ["mp"],
      description: "Run a plugin-owned CLI command",
      help: {
        usage: ["my-plugin [action]"],
        sections: [{
          title: "My Plugin CLI",
          columns: [
            { header: "Action" },
            { header: "Example" },
          ],
          rows: [
            ["run", "gloomberb my-plugin run"],
          ],
        }],
      },
      async execute(args, ctx) {
        if (args[0] === "run") {
          const { config, persistence } = await ctx.initConfigData();
          console.log(`Using data dir ${config.dataDir}`);
          persistence.close();
          return;
        }
        ctx.fail("Usage: gloomberb my-plugin run");
      },
    },
  ],
};
```

Each CLI command owns one root namespace and parses its own subactions internally.

Available CLI context helpers:

| Field | What it does |
|------|---------------|
| `ctx.initConfigData()` | Load config, persistence, and ticker storage |
| `ctx.initMarketData()` | Load config plus the plugin-aware provider router |
| `ctx.fail(...)` | Print an error and exit |
| `ctx.closeAndFail(...)` | Close persistence, then print an error and exit |
| `ctx.output.*` | CLI formatting helpers (`cliStyles`, `renderSection`, `renderTable`, `renderStat`, `colorBySign`) |
| `ctx.log` | Scoped debug logger for the owning plugin |

CLI commands may also launch the TUI instead of exiting by returning:

```typescript
return {
  kind: "launch-ui",
  request: {
    applyConfig(config, env) {
      return { config };
    },
  },
};
```

### Data access

| Method | Returns |
|--------|---------|
| `ctx.getData(ticker)` | Cached financials for a ticker |
| `ctx.getTicker(ticker)` | Ticker metadata record |
| `ctx.getConfig()` | Current app config |
| `ctx.dataProvider` | The active data provider instance |
| `ctx.tickerRepository` | The ticker metadata persistence store |
| `ctx.log` | Scoped logger for debug output |

### Plugin storage

Persistent key-value storage scoped to your plugin (backed by SQLite). Use this for settings or small versioned blobs:

```typescript
ctx.storage.set("my-key", { count: 42 });
const data = ctx.storage.get<{ count: number }>("my-key"); // { count: 42 }
ctx.storage.delete("my-key");
ctx.storage.keys(); // ["my-key"]
```

### Plugin persistence

For richer cached data, use the explicit persistence API. State stores versioned plugin-local data; resources add cache metadata and TTLs:

```typescript
ctx.persistence.setState("draft", { text: "hello" }, { schemaVersion: 1 });
const draft = ctx.persistence.getState<{ text: string }>("draft", { schemaVersion: 1 });
ctx.persistence.deleteState("draft");

ctx.persistence.setResource("summary", "AAPL", "cached summary", {
  sourceKey: "provider",
  schemaVersion: 1,
  cachePolicy: { staleMs: 3600_000, expireMs: 7 * 24 * 3600_000 },
});

const summary = ctx.persistence.getResource<string>("summary", "AAPL", {
  sourceKey: "provider",
  schemaVersion: 1,
  allowExpired: true,
});

ctx.persistence.deleteResource("summary", "AAPL", { sourceKey: "provider" });
```

### Resume state (session-only)

Transient state that is cleared on app restart. Useful for ephemeral UI state you don't want to persist:

```typescript
ctx.resume.setState("scroll-pos", 42);
ctx.resume.getState<number>("scroll-pos"); // 42 (gone after restart)
ctx.resume.deleteState("scroll-pos");

// Per-pane session state
ctx.resume.setPaneState("my-pane:main", "expanded", true);
ctx.resume.getPaneState<boolean>("my-pane:main", "expanded");
ctx.resume.deletePaneState("my-pane:main", "expanded");
```

### Config state (persistent)

Persistent configuration scoped to your plugin. Unlike `storage`, values are part of the app config system:

```typescript
const apiKey = ctx.configState.get<string>("apiKey");
await ctx.configState.set("apiKey", "sk-...");
await ctx.configState.delete("apiKey");
ctx.configState.keys(); // ["apiKey"]
```

### Navigation

```typescript
ctx.selectTicker("AAPL");              // Select ticker + focus right panel
ctx.selectTicker("AAPL", "my-pane:1"); // Select in a specific pane
ctx.switchPanel("left");               // Switch active panel
ctx.switchTab("chart");                // Switch detail tab by id
ctx.switchTab("chart", "detail:1");    // Switch tab in a specific pane
ctx.openCommandBar();                  // Open the command bar
ctx.openCommandBar("export");          // Open with a pre-filled query
ctx.openPaneSettings();                // Open settings for the focused pane
ctx.openPaneSettings("my-pane:1");     // Open settings for a specific pane
ctx.showPane("my-pane");               // Show a hidden pane
ctx.hidePane("my-pane");               // Hide a pane
ctx.focusPane("my-pane");              // Move focus to a pane
ctx.pinTicker("AAPL");                 // Pin a ticker to its own detail pane
ctx.pinTicker("AAPL", { floating: true, paneType: "ticker-detail" });
ctx.createPaneFromTemplate("quote-monitor-new", { symbol: "AAPL" });
```

### Broker management

Plugins that register brokers can manage broker instances programmatically:

```typescript
const instance = await ctx.createBrokerInstance("ibkr", "My IBKR", { token: "..." });
await ctx.updateBrokerInstance(instance.id, { token: "new-token" });
await ctx.syncBrokerInstance(instance.id);  // Trigger position import
await ctx.removeBrokerInstance(instance.id);
```

### Pane settings

Panes can expose per-instance settings that persist with the layout. These settings are part of the pane definition, can be edited from the pane header or command bar, and are available to both first-party and external plugins.

```typescript
ctx.registerPane({
  id: "my-pane",
  name: "My Pane",
  component: MyPane,
  defaultPosition: "right",
  settings: {
    title: "My Pane Settings",
    fields: [
      {
        key: "symbol",
        label: "Ticker",
        type: "text",
        placeholder: "AAPL",
      },
      {
        key: "hideTabs",
        label: "Hide Tabs",
        type: "toggle",
      },
      {
        key: "columnIds",
        label: "Columns",
        type: "ordered-multi-select",
        options: [
          { value: "ticker", label: "Ticker" },
          { value: "price", label: "Price" },
        ],
      },
    ],
  },
});
```

Settings can also be dynamic — pass a function instead of an object to compute fields based on current state:

```typescript
settings: (context) => ({
  title: `Settings for ${context.paneId}`,
  fields: [/* fields based on context.config, context.settings, etc. */],
}),
```

Available field types:
- `toggle`
- `text`
- `select`
- `multi-select`
- `ordered-multi-select`

Imperative pane settings access is available on the plugin context:

```typescript
const symbol = ctx.paneSettings.get<string>("quote-monitor:main", "symbol");
await ctx.paneSettings.set("quote-monitor:main", "symbol", "MSFT");
await ctx.paneSettings.delete("quote-monitor:main", "symbol");
```

Inside pane components, use `usePaneSettingValue()` to read and update the current pane's persisted settings:

```typescript
import { usePaneSettingValue } from "gloomberb/components";

function MyPane() {
  const [hideTabs, setHideTabs] = usePaneSettingValue("hideTabs", false);
  // ...
}
```

### Events

Subscribe to and emit app events:

```typescript
ctx.on("ticker:selected", ({ symbol, previous }) => {
  console.log(`Selected ${symbol}`);
});

ctx.on("ticker:refreshed", ({ symbol, financials }) => {
  // React to new data
});

// Plugins can also emit events
ctx.emit("ticker:selected", { symbol: "AAPL", previous: null });
```

Available events: `ticker:selected`, `ticker:refreshed`, `ticker:added`, `ticker:removed`, `config:changed`, `plugin:registered`, `plugin:unregistered`.

### App notifications

```typescript
ctx.notify({
  title: "Chat mention",
  body: "@bob mentioned you",
  desktop: "when-inactive", // desktop only when the terminal loses focus
});

ctx.notify({ body: "Saved successfully", type: "success" });
ctx.notify({ body: "Something went wrong", type: "error", duration: 5000 });
ctx.notify({ body: "FYI..." }); // defaults to an in-app info toast
```

### Floating panes

Panes with `defaultMode: "floating"` open as draggable/resizable floating windows:

```typescript
ctx.registerPane({
  id: "my-pane",
  name: "My Pane",
  component: ({ paneId, paneType, width, height, focused, close }) => (
    <box flexDirection="column" width={width} height={height}>
      <text>Hello from pane!</text>
    </box>
  ),
  defaultPosition: "right",
  defaultMode: "floating",
  defaultFloatingSize: { width: 40, height: 10 },
});

// Show/hide as floating window programmatically
ctx.showWidget("my-pane");
ctx.hideWidget("my-pane");
```

### Pane templates

Pane templates let users create new pane instances from the command bar. This is useful when a plugin supports multiple independent instances (e.g., multiple chart panes for different tickers):

```typescript
ctx.registerPaneTemplate({
  id: "my-chart-new",
  paneId: "my-chart",       // references a registered pane
  label: "New Chart",
  description: "Open a new chart pane",
  keywords: ["chart", "new"],

  // Optional: command-bar shortcut prefix (e.g., typing "/chart AAPL")
  shortcut: {
    prefix: "/chart",
    argPlaceholder: "ticker",
    argKind: "ticker",
  },

  // Optional: wizard steps shown before creating the pane
  wizard: [
    { key: "interval", label: "Interval", type: "select", options: [
      { label: "1D", value: "1d" },
      { label: "1W", value: "1w" },
    ]},
  ],

  // Optional: control when the template is available
  canCreate(context, options) {
    return !!options?.symbol;
  },

  // Configure the new pane instance
  createInstance(context, options) {
    return {
      title: options?.symbol ?? "Chart",
      settings: { symbol: options?.symbol },
      binding: options?.symbol ? { type: "ticker", ticker: options.symbol } : undefined,
    };
  },
});
```

Create pane instances programmatically:

```typescript
ctx.createPaneFromTemplate("my-chart-new", { symbol: "AAPL" });
```

## Reusable components

Plugins can import the shared UI kit from `gloomberb/components`. Prefer these over ad hoc rows and controls so plugin screens feel native.

```typescript
import {
  StockChart,
  Tabs,
  TabBar,
  ListView,
  ToggleList,
  Button,
  IconButton,
  Checkbox,
  Switch,
  RadioGroup,
  SegmentedControl,
  TextField,
  SearchField,
  NumberField,
  StatusBadge,
  Notice,
  EmptyState,
  Section,
  FieldRow,
  DialogFrame,
  Spinner,
  ProgressBar,
  SkeletonRow,
  LoadingBlock,
  PriceSelectorDialog,
  colors,
  priceColor,
  hoverBg,
} from "gloomberb/components";
import {
  useAppState,
  useFocusedTicker,
  usePaneSettingValue,
  usePaneTicker,
  useSelectedTicker,
} from "gloomberb/components";
import {
  formatCurrency,
  formatCompact,
  formatPercent,
  formatPercentRaw,
  formatNumber,
  padTo,
} from "gloomberb/components";
```

Available components:
- `Tabs` / `TabBar` — horizontal tab navigation
- `ListView` — shared selectable list primitive with mouse support
- `StockChart` — interactive area, line, candlestick, and OHLC chart
- `ToggleList` — checkbox list with selection
- `Button` / `IconButton` — clickable actions for dialogs and toolbars
- `Checkbox`, `Switch`, `RadioGroup`, `SegmentedControl` — boolean and option controls
- `TextField`, `SearchField`, `NumberField` — input controls
- `StatusBadge`, `Notice`, `EmptyState` — status and empty/loading feedback
- `Section`, `FieldRow`, `DialogFrame` — shared framing/layout helpers
- `Spinner`, `ProgressBar`, `SkeletonRow`, `LoadingBlock` — loading states
- `PriceSelectorDialog` — ticker price picker dialog
- `colors` — theme color palette
- `priceColor(change)` — returns green/red/neutral color for a price change
- `hoverBg` — standard hover background color
- `useAppState()` — access full app state
- `usePaneTicker()` — get the ticker bound to the current pane
- `useFocusedTicker()` — get the currently focused ticker
- `useSelectedTicker()` — alias for `usePaneTicker()`
- `formatCurrency`, `formatCompact`, `formatPercent`, `formatPercentRaw`, `formatNumber`, `padTo` — number formatting utilities

### Plugin runtime hooks

These hooks are available inside pane and tab components rendered by a plugin. They provide reactive access to the plugin's storage layers:

```typescript
import { usePluginPaneState, usePluginState, usePluginConfigState } from "gloomberb/plugins/plugin-runtime";

// Per-pane transient state (scoped to the current pane instance)
const [expanded, setExpanded] = usePluginPaneState("expanded", false);

// Persistent plugin state (survives restarts)
const [cache, setCache] = usePluginState("cache", null, { schemaVersion: 1 });

// Plugin config state (persistent, part of app config)
const [apiKey, setApiKey] = usePluginConfigState("apiKey", "");
```

## Pane props

Pane components receive these props:

```typescript
interface PaneProps {
  paneId: string;    // unique instance id (e.g., "my-pane:main")
  paneType: string;  // pane definition id (e.g., "my-pane")
  focused: boolean;
  width: number;
  height: number;
  close?: () => void;  // present for closeable panes
}
```

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

Detail tabs can control their visibility based on the current ticker:

```typescript
ctx.registerDetailTab({
  id: "options",
  name: "Options",
  order: 50,
  component: OptionsTab,
  isVisible({ ticker, financials, hasOptionsChain }) {
    return hasOptionsChain;
  },
});
```

## Example: adding a detail tab

The simplest plugin type. This adds a new tab to the right-side detail pane:

```typescript
import React from "react";
import type { GloomPlugin, DetailTabProps } from "gloomberb/types/plugin";
import { EmptyState, FieldRow, Section, usePaneTicker, colors } from "gloomberb/components";

function SentimentTab({ width, height, focused }: DetailTabProps) {
  const { ticker } = usePaneTicker();
  if (!ticker) {
    return (
      <EmptyState
        title="No ticker selected."
        hint="Move the cursor in a list pane to populate this tab."
      />
    );
  }

  return (
    <box flexDirection="column" width={width} height={height}>
      <Section title={`Sentiment for ${ticker.metadata.ticker}`}>
        <FieldRow label="Signal" value="Bullish" valueColor={colors.positive} />
        <FieldRow label="Trend" value="Improving" />
      </Section>
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

## UI guidelines for plugins

- Prefer `ListView`, `Tabs`, `Button`, `Checkbox`, and `Notice` before custom rows.
- Support both mouse and keyboard for anything interactive.
- Use `colors` and the shared components instead of hard-coded palette values when possible.
- Use `usePaneTicker()` inside pane/tab components so multi-pane layouts keep working correctly.

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
      ctx.notify({ body: "Exported!", type: "success" });
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
    { key: "direction", label: "Direction", type: "select", options: [
      { label: "Above", value: "above" },
      { label: "Below", value: "below" },
    ]},
  ],
  wizardLayout: "form",  // "steps" (default) or "form" (all fields at once)
  async execute(values) {
    // values.price, values.direction
  },
});
```

Wizard step types: `text`, `password`, `number`, `select`, `info`. Steps can use `dependsOn` to conditionally appear based on a previous step's value.

Commands can require confirmation before executing:

```typescript
ctx.registerCommand({
  id: "delete-all",
  label: "Delete All Notes",
  keywords: ["delete", "notes"],
  category: "data",
  confirm: {
    title: "Delete all notes?",
    body: ["This cannot be undone."],
    confirmLabel: "Delete",
    tone: "danger",
  },
  async execute() { /* ... */ },
});
```

Commands can be conditionally hidden:

```typescript
ctx.registerCommand({
  id: "admin-tool",
  label: "Admin Tool",
  keywords: ["admin"],
  category: "config",
  hidden: () => !ctx.getConfig().debugMode,
  async execute() { /* ... */ },
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
      const score = ticker.metadata?.custom?.conviction ?? "-";
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
      ctx.notify({ body: "Snapshot saved" });
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
    // Optional: only show for certain tickers
    filter: (ticker) => ticker.metadata.exchange === "US",
    execute(ticker, financials) {
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
      <box><text>Extra info for {ticker.metadata.ticker}</text></box>
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

## Tips

- Look at the built-in plugins in `src/plugins/builtin/` for real-world examples
- Use `order` on detail tabs to control position (core tabs use 10, 20, 30)
- Toggleable plugins can be enabled/disabled by users from settings (`Ctrl+,`)
- The UI is built with [OpenTUI](https://github.com/anthropics/opentui) React — use `<box>`, `<text>`, and `<input>` for layout
- Use `ctx.storage` to persist data across app restarts
- Use `ctx.on()` to react to app events without polling
- Use `ctx.notify()` for non-intrusive user feedback and desktop notifications
