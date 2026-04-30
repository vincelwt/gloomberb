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

## Renderer-neutral UI

Plugins should treat Gloomberb's UI APIs as the renderer contract. Official plugins may render panes, detail tabs, and slot widgets with React, but plugin UI should import shared Gloom APIs such as `gloomberb/ui`, `gloomberb/react`, or the plugin runtime hooks instead of importing OpenTUI, Electrobun, DOM, or terminal renderer packages directly. Renderer-specific details like terminal keyboard events, kitty images, DOM pointer behavior, dialogs, and notifications belong in the renderer adapters.

React plugin panes and detail tabs are wrapped in a plugin render context. Use plugin runtime hooks for app services from render code.

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
| `ctx.registerDataSource(source)` | Add a data source |
| `ctx.registerShortcut(shortcut)` | Add a global keyboard shortcut |
| `ctx.registerTickerAction(action)` | Add a per-ticker action (shown via `a` key) |
| `ctx.registerContextMenuProvider(provider)` | Add renderer-neutral context menu items |

### Context menus

Plugins can contribute items to native desktop context menus without importing Electrobun, the DOM, or OpenTUI directly. Use Gloomberb APIs from the plugin context, and let the renderer decide whether a native menu is available.

```typescript
ctx.registerContextMenuProvider({
  id: "ticker-tools",
  contexts: ["ticker"],
  order: 10,
  getItems(context) {
    if (context.kind !== "ticker") return null;
    return [{
      id: "my-plugin:open-report",
      label: `Open ${context.symbol} Report`,
      onSelect: () => ctx.openCommandBar(`report ${context.symbol}`),
    }];
  },
});
```

Pane menus receive the pane instance id, pane type, title, and whether the pane is floating:

```typescript
ctx.registerContextMenuProvider({
  id: "pane-tools",
  contexts: ["pane"],
  getItems(context) {
    if (context.kind !== "pane") return null;
    return [{
      id: "my-plugin:focus-pane",
      label: "Focus Pane",
      onSelect: () => ctx.focusPane(context.paneId),
    }];
  },
});
```

Available context kinds are `pane`, `ticker`, `link`, `editable-text`, `selected-text`, `layout`, and `app`. Return `null` or an empty array when your plugin has nothing useful for a context. Keep actions renderer-neutral: call plugin context methods such as `ctx.openCommandBar()`, `ctx.selectTicker()`, `ctx.pinTicker()`, `ctx.focusPane()`, and `ctx.notify()` instead of using renderer-specific APIs.

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
| `ctx.marketData` | The active market data router |
| `ctx.tickerRepository` | The ticker metadata persistence store |
| `ctx.log` | Scoped logger for debug output |

### Data sources

Plugins may contribute data through `dataSources` or `ctx.registerDataSource(source)`. A data source can expose `market`, `news`, or both. Plugins remain feature modules; the source is the provider identity used for routing, cache policy, and provenance.

```typescript
import type { GloomPlugin } from "gloomberb/types/plugin";
import type { DataSource } from "gloomberb/types/data-source";

const source: DataSource = {
  id: "my-source",
  name: "My Source",
  priority: 100,
  market: myMarketProvider,
  news: {
    supports: (query) => query.feed === "ticker",
    fetchNews: async (query) => [],
  },
};

export const myPlugin: GloomPlugin = {
  id: "my-plugin",
  name: "My Plugin",
  version: "1.0.0",
  dataSources: [source],
};
```

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
import { Box, Text } from "gloomberb/ui";

ctx.registerPane({
  id: "my-pane",
  name: "My Pane",
  component: ({ paneId, paneType, width, height, focused, close }) => (
    <Box flexDirection="column" width={width} height={height}>
      <Text>Hello from pane!</Text>
    </Box>
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

Plugins can import renderer-neutral layout primitives from `gloomberb/ui` and shared controls from `gloomberb/components`. Prefer these public APIs over ad hoc rows, custom controls, or renderer internals so plugin screens feel native across hosts.

```typescript
import { Box, Text } from "gloomberb/ui";
import {
  StockChart,
  Tabs,
  TabBar,
  ListView,
  DataTable,
  DataTableView,
  DataTableStackView,
  FeedDataTableStackView,
  TickerListTable,
  TickerListTableView,
  ToggleList,
  Button,
  MultiSelectDialogButton,
  MultiSelectDialogContent,
  SegmentedControl,
  TextField,
  NumberField,
  EmptyState,
  DialogFrame,
  ChoiceDialog,
  ExternalLink,
  ExternalLinkText,
  openUrl,
  PageStackView,
  Spinner,
  PriceSelectorDialog,
  PaneFooterBar,
  usePaneFooter,
  usePaneHints,
  useExternalLinkFooter,
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
- `Tabs` — horizontal tab navigation
- `TabBar` — alias for `Tabs` used by older plugin code
- `ListView` — shared selectable list primitive with mouse support
- `DataTable` — low-level table primitive when a plugin owns table state
- `DataTableView` — shared sortable table wrapper with keyboard navigation and synchronized scrolling
- `DataTableStackView`, `FeedDataTableStackView` — stacked table views for dense list panes
- `TickerListTable`, `TickerListTableView` — ticker table primitives used by market list panes
- `StockChart` — interactive area, line, candlestick, and OHLC chart
- `ToggleList` — checkbox list with selection
- `Button` — clickable actions for dialogs and toolbars
- `MultiSelectDialogButton`, `MultiSelectDialogContent` — multi-select dialog controls
- `SegmentedControl` — compact option selector
- `TextField`, `NumberField` — input controls
- `EmptyState` — empty or unavailable-state feedback
- `DialogFrame` — shared dialog framing
- `ChoiceDialog` — shared single-choice dialog with keyboard and mouse selection
- `ExternalLink`, `ExternalLinkText`, `openUrl` — renderer-neutral link helpers
- `PageStackView` — stacked page navigation view
- `Spinner` — loading indicator
- `PriceSelectorDialog` — ticker price picker dialog
- `PaneFooterBar` — shared pane footer renderer used by the shell
- `usePaneFooter(registrationId, factory, deps)` — register pane footer info and action hints from a pane or detail tab
- `usePaneHints(registrationId, factory, deps)` — register only footer hints
- `useExternalLinkFooter(options)` — register footer help for an external link
- `colors` — theme color palette
- `priceColor(change)` — returns green/red/neutral color for a price change
- `hoverBg` — standard hover background color
- `useAppState()` — access full app state
- `usePaneSettingValue()` — read and update the current pane's persisted settings
- `usePaneTicker()` — get the ticker bound to the current pane
- `useFocusedTicker()` — get the currently focused ticker
- `useSelectedTicker()` — alias for `usePaneTicker()`
- `formatCurrency`, `formatCompact`, `formatPercent`, `formatPercentRaw`, `formatNumber`, `padTo` — number formatting utilities

For layout that is not represented above, compose `Box` and `Text` from `gloomberb/ui` rather than importing renderer-specific primitives or unexported shared components.

Pane footers are the shared place for pane status and non-obvious keyboard actions. Register informational segments on the left and hints on the right:

```typescript
usePaneFooter("my-pane", () => ({
  info: [
    { id: "status", parts: [{ text: "12 rows", tone: "muted" }] },
  ],
  hints: [
    { id: "refresh", key: "r", label: "efresh", onPress: refresh },
    { id: "filter", key: "f", label: "ilter", onPress: openFilter },
  ],
}), [refresh, openFilter]);
```

Do not register basic navigation hints. Pane hints must omit `Esc`, `Enter`, arrows, `up/down`, `left/right`, `j`, `k`, `j/k`, and tab-switching hints such as `h/l`. Keep only pane-specific actions such as `[r]efresh`, `[/]search`, `[f]ilter`, `[Ctrl+S]save`, `[Shift+R]force refresh`, or chart controls.

### Plugin runtime hooks

These hooks are available inside pane and tab components rendered by a plugin. They provide app actions, market data access, and reactive access to the plugin's storage layers:

```typescript
import {
  useMarketData,
  usePluginPaneState,
  usePluginState,
  usePluginConfigState,
  usePluginTickerActions,
  usePluginAppActions,
} from "gloomberb/plugins/plugin-runtime";

const marketData = useMarketData();
const { navigateTicker, pinTicker } = usePluginTickerActions();
const { openCommandBar, showWidget, hideWidget, notify } = usePluginAppActions();

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
import { Box, Text } from "gloomberb/ui";
import type { GloomPlugin, DetailTabProps } from "gloomberb/types/plugin";
import { EmptyState, usePaneTicker, colors } from "gloomberb/components";

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
    <Box flexDirection="column" width={width} height={height}>
      <Box height={1}>
        <Text fg={colors.text}>{`Sentiment for ${ticker.metadata.ticker}`}</Text>
      </Box>
      <Box height={1} />
      <Box flexDirection="row" height={1}>
        <Text fg={colors.textDim}>Signal  </Text>
        <Text fg={colors.positive}>Bullish</Text>
      </Box>
      <Box flexDirection="row" height={1}>
        <Text fg={colors.textDim}>Trend   </Text>
        <Text fg={colors.text}>Improving</Text>
      </Box>
    </Box>
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

- Prefer `ListView`, `Tabs`, `Button`, `SegmentedControl`, `TextField`, and `EmptyState` before custom rows.
- Support both mouse and keyboard for anything interactive.
- Put pane status and non-obvious shortcuts in `usePaneFooter()` / `usePaneHints()` instead of ad hoc body rows.
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
import { Box, Text } from "gloomberb/ui";

export const myPlugin: GloomPlugin = {
  id: "my-plugin",
  name: "My Plugin",
  version: "1.0.0",
  slots: {
    "status:widget": () => <Text> LIVE</Text>,
    "detail:section": ({ ticker, financials }) => (
      <Box>
        <Text>Extra info for {ticker.metadata.ticker}</Text>
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

## Tips

- Look at the built-in plugins in `src/plugins/builtin/` for real-world examples
- Use `order` on detail tabs to control position (core tabs use 10, 20, 30)
- Toggleable plugins can be enabled/disabled by users from settings (`Ctrl+,`)
- The terminal renderer is backed by [OpenTUI](https://opentui.com/) packages such as `@opentui/core` and `@opentui/react`; plugin UI should stay on `gloomberb/ui` and `gloomberb/components`
- Use `ctx.storage` to persist data across app restarts
- Use `ctx.on()` to react to app events without polling
- Use `ctx.notify()` for non-intrusive user feedback and desktop notifications
