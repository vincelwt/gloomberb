import { afterEach, describe, expect, test } from "bun:test";
import { act, useReducer } from "react";
import { testRender } from "@opentui/react/test-utils";
import { DialogProvider } from "@opentui-ui/dialog/react";
import { CommandBar } from "./command-bar";
import { AppContext, type AppState, appReducer, createInitialState } from "../../state/app-context";
import { createTestDataProvider } from "../../test-support/data-provider";
import { cloneLayout, createDefaultConfig, type AppConfig } from "../../types/config";
import type { DataProvider } from "../../types/data-provider";
import type { TickerRecord } from "../../types/ticker";
import type { PluginRegistry } from "../../plugins/registry";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
});

async function waitForFrameToContain(text: string, attempts = 12, delayMs = 50): Promise<string> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const frame = testSetup!.captureCharFrame();
    if (frame.includes(text)) {
      return frame;
    }
    await Bun.sleep(delayMs);
    await testSetup!.renderOnce();
  }
  throw new Error(`Timed out waiting for frame to contain "${text}".`);
}

async function clickFrameText(text: string): Promise<void> {
  const frame = testSetup!.captureCharFrame();
  const rows = frame.split("\n");
  const row = rows.findIndex((line) => line.includes(text));
  const col = row >= 0 ? rows[row]!.indexOf(text) : -1;

  expect(row).toBeGreaterThanOrEqual(0);
  expect(col).toBeGreaterThanOrEqual(0);

  await act(async () => {
    await testSetup!.mockMouse.click(col + 1, row);
    await testSetup!.renderOnce();
  });
}

async function emitKeypress(
  renderer: Awaited<ReturnType<typeof testRender>>,
  event: { name?: string; sequence?: string; ctrl?: boolean; meta?: boolean; shift?: boolean; option?: boolean },
): Promise<void> {
  await act(async () => {
    renderer.renderer.keyInput.emit("keypress", {
      ctrl: false,
      meta: false,
      option: false,
      shift: false,
      eventType: "press",
      repeated: false,
      stopPropagation: () => {},
      preventDefault: () => {},
      ...event,
    } as any);
    await renderer.renderOnce();
  });
}

async function renderFrames(count = 2): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await testSetup!.renderOnce();
  }
}

function expectSingleBackControl(frame: string): void {
  expect(frame.match(/\bBack\b/g)?.length ?? 0).toBe(1);
}

function makeTicker(symbol: string, name: string, overrides: Partial<TickerRecord["metadata"]> = {}): TickerRecord {
  return {
    metadata: {
      ticker: symbol,
      exchange: "NASDAQ",
      currency: "USD",
      name,
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
      ...overrides,
    },
  };
}

function makeDataProvider(searchImpl: DataProvider["search"] = async () => []): DataProvider {
  return createTestDataProvider({
    id: "test",
    search: searchImpl,
  });
}

function makePluginRegistry(hasPaneSettings: (paneId: string) => boolean = () => false): PluginRegistry {
  return {
    panes: new Map<string, any>([
      ["portfolio-list", {
        id: "portfolio-list",
        name: "Portfolio List",
        component: () => null,
        defaultPosition: "left",
      }],
      ["ticker-detail", {
        id: "ticker-detail",
        name: "Ticker Detail",
        component: () => null,
        defaultPosition: "right",
      }],
      ["chat", {
        id: "chat",
        name: "Chat",
        component: () => null,
        defaultPosition: "right",
        defaultMode: "floating",
      }],
      ["quote-monitor", {
        id: "quote-monitor",
        name: "Quote Monitor",
        component: () => null,
        defaultPosition: "right",
        defaultMode: "floating",
      }],
      ["ibkr-trading", {
        id: "ibkr-trading",
        name: "IBKR Console",
        component: () => null,
        defaultPosition: "right",
        defaultMode: "floating",
      }],
    ]),
    paneTemplates: new Map<string, any>([
      ["new-portfolio-pane", {
        id: "new-portfolio-pane",
        paneId: "portfolio-list",
        label: "New Portfolio Pane",
        description: "Open another portfolio list pane",
        shortcut: { prefix: "PF" },
      }],
      ["new-watchlist-pane", {
        id: "new-watchlist-pane",
        paneId: "portfolio-list",
        label: "New Watchlist Pane",
        description: "Open another watchlist pane",
      }],
      ["new-ticker-detail-pane", {
        id: "new-ticker-detail-pane",
        paneId: "ticker-detail",
        label: "New Ticker Detail Pane",
        description: "Open another detail pane",
      }],
      ["new-chat-pane", {
        id: "new-chat-pane",
        paneId: "chat",
        label: "New Chat Pane",
        description: "Open another floating chat window",
        shortcut: { prefix: "CHAT" },
      }],
      ["quote-monitor-pane", {
        id: "quote-monitor-pane",
        paneId: "quote-monitor",
        label: "Quote Monitor",
        description: "Open a compact quote monitor for the selected ticker",
        shortcut: { prefix: "QQ", argPlaceholder: "ticker" },
      }],
      ["new-ibkr-trading-pane", {
        id: "new-ibkr-trading-pane",
        paneId: "ibkr-trading",
        label: "New IBKR Trading Pane",
        description: "Open another floating IBKR trading console",
        shortcut: { prefix: "IBKR" },
        canCreate: (context: any) => context.config.brokerInstances.some((instance: any) => (
          instance.brokerType === "ibkr"
          && instance.connectionMode === "gateway"
          && instance.enabled !== false
        )),
      }],
    ]),
    commands: new Map<string, any>([
      ["plugin:scan", {
        id: "plugin:scan",
        label: "Scan Movers",
        description: "Run a quick movers scan",
        category: "plugins",
        execute: async () => {},
      }],
    ]),
    tickerActions: new Map<string, any>([
      ["pin", {
        id: "pin",
        label: "Pin Ticker",
        execute: async () => {},
      }],
    ]),
    brokers: new Map(),
    allPlugins: new Map([
      ["news", { id: "news", name: "News", version: "1.0.0", description: "Latest headlines", toggleable: true }],
      ["notes", { id: "notes", name: "Notes", version: "1.0.0", description: "Ticker notes", toggleable: true }],
    ]),
    getCommandPluginId: () => "news",
    getPaneTemplatePluginId: (templateId: string) => (
      templateId === "new-chat-pane" ? "news" : "notes"
    ),
    getPluginPaneIds: () => [],
    getPluginPaneTemplateIds: () => [],
    hasPaneSettings,
    events: { emit: () => {} },
    hideWidget: () => {},
    pinTickerFn: () => {},
    showWidget: () => {},
    updateLayoutFn: () => {},
    getTermSizeFn: () => ({ width: 80, height: 24 }),
    showToastFn: () => {},
    createPaneFromTemplateFn: () => {},
    createPaneFromTemplateAsyncFn: async () => {},
    openPaneSettingsFn: () => {},
    applyPaneSettingValueFn: async () => {},
    resolvePaneSettings: () => null,
    createBrokerInstanceFn: async () => { throw new Error("unused"); },
    syncBrokerInstanceFn: async () => {},
    removeBrokerInstanceFn: async () => {},
    getConfigFn: () => createDefaultConfig("/tmp/gloomberb-test"),
  } as unknown as PluginRegistry;
}

function CommandBarHarness({
  query,
  disabledPlugins = [],
  selectedTicker,
  live = false,
  extraTickers = [],
  showQueryState = false,
  onSaveTicker,
  configureConfig,
  configureState,
  configurePluginRegistry,
  dataProvider = makeDataProvider(),
  hasPaneSettings,
  onCheckForUpdates,
}: {
  query: string;
  disabledPlugins?: string[];
  selectedTicker?: string;
  live?: boolean;
  extraTickers?: TickerRecord[];
  showQueryState?: boolean;
  onSaveTicker?: (ticker: TickerRecord) => void;
  configureConfig?: (config: AppConfig) => AppConfig;
  configureState?: (state: AppState) => AppState;
  configurePluginRegistry?: (pluginRegistry: PluginRegistry) => void;
  dataProvider?: DataProvider;
  hasPaneSettings?: (paneId: string) => boolean;
  onCheckForUpdates?: () => void | Promise<void>;
}) {
  let config = {
    ...createDefaultConfig("/tmp/gloomberb-test"),
    recentTickers: ["AAPL", "MSFT"],
    disabledPlugins,
  };
  if (configureConfig) {
    config = configureConfig(config);
  }
  const tickers = [makeTicker("AAPL", "Apple Inc."), makeTicker("MSFT", "Microsoft Corp."), ...extraTickers];
  let state: AppState = {
    ...createInitialState(config),
    commandBarOpen: true,
    commandBarQuery: query,
    tickers: new Map(tickers.map((ticker) => [ticker.metadata.ticker, ticker])),
    config: { ...config, disabledPlugins },
    paneState: selectedTicker
      ? {
        "portfolio-list:main": {
          collectionId: "main",
          cursorSymbol: selectedTicker,
        },
      }
      : createInitialState(config).paneState,
  };
  if (configureState) {
    state = configureState(state);
  }
  const tickerRepository = {
    loadTicker: async () => null,
    createTicker: async (metadata: TickerRecord["metadata"]) => ({
      metadata,
    }),
    saveTicker: async (ticker: TickerRecord) => {
      onSaveTicker?.(ticker);
    },
  };
  const pluginRegistry = makePluginRegistry(hasPaneSettings);
  configurePluginRegistry?.(pluginRegistry);
  const [liveState, dispatch] = useReducer(appReducer, state);
  const currentState = live ? liveState : state;
  const currentDispatch = live ? dispatch : () => {};

  return (
    <AppContext value={{ state: currentState, dispatch: currentDispatch }}>
      <DialogProvider dialogOptions={{ style: { backgroundColor: "#000000", borderColor: "#ffffff", borderStyle: "single" } }}>
        {live && <text>{`theme:${currentState.config.theme}`}</text>}
        {showQueryState && <text>{`query:${currentState.commandBarQuery}`}</text>}
        {currentState.commandBarOpen && (
          <CommandBar
            dataProvider={dataProvider}
            tickerRepository={tickerRepository as any}
            pluginRegistry={pluginRegistry}
            quitApp={() => {}}
            onCheckForUpdates={onCheckForUpdates}
          />
        )}
      </DialogProvider>
    </AppContext>
  );
}

describe("CommandBar", () => {
  test("renders the default layout with opencode-style chrome", async () => {
    testSetup = await testRender(<CommandBarHarness query="" selectedTicker="AAPL" />, {
      width: 80,
      height: 24,
    });

    await testSetup.renderOnce();

    expect(testSetup.captureCharFrame()).toMatchSnapshot();
  });

  test("runs check for updates from the command bar", async () => {
    const calls = [];

    testSetup = await testRender(<CommandBarHarness query="check for updates" live onCheckForUpdates={() => { calls.push(Date.now()); }} />, {
      width: 80,
      height: 24,
    });

    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain("Check for Updates");

    await clickFrameText("Check for Updates");
    await Bun.sleep(0);
    await testSetup.renderOnce();

    expect(calls).toHaveLength(1);
    expect(testSetup.captureCharFrame()).not.toContain("Commands");
  });

  test("renders theme prefix results in the root query", async () => {
    testSetup = await testRender(<CommandBarHarness query="TH " />, {
      width: 80,
      height: 24,
    });

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Commands");
    expect(frame).toContain("TH");
    expect(frame).toContain("Themes");
    expect(frame).toMatchSnapshot();
  });

  test("renders plugin toggle state", async () => {
    testSetup = await testRender(<CommandBarHarness query="PL " disabledPlugins={["notes"]} />, {
      width: 80,
      height: 24,
    });

    await testSetup.renderOnce();

    expect(testSetup.captureCharFrame()).toMatchSnapshot();
  });

  test("only surfaces PS when the focused pane exposes settings", async () => {
    testSetup = await testRender(
      <CommandBarHarness query="PS" hasPaneSettings={(paneId) => paneId === "portfolio-list:main"} />,
      { width: 80, height: 24 },
    );

    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain("Pane Settings");

    testSetup.renderer.destroy();
    testSetup = await testRender(<CommandBarHarness query="PS" hasPaneSettings={() => false} />, {
      width: 80,
      height: 24,
    });

    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).not.toContain("Pane Settings");
  });

  test("collapses the trailing column on narrow terminals", async () => {
    testSetup = await testRender(<CommandBarHarness query="" selectedTicker="AAPL" />, {
      width: 42,
      height: 20,
    });

    await testSetup.renderOnce();

    expect(testSetup.captureCharFrame()).toMatchSnapshot();
  });

  test("moves the theme selector with arrow keys", async () => {
    testSetup = await testRender(<CommandBarHarness query="TH " live />, {
      width: 80,
      height: 24,
    });

    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressArrow("down");
      await testSetup!.renderOnce();
    });
    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("theme:green");
  });

  test("keeps the selected theme after pressing enter in root theme mode", async () => {
    testSetup = await testRender(<CommandBarHarness query="TH " live />, {
      width: 80,
      height: 24,
    });

    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressArrow("down");
      await testSetup!.renderOnce();
    });
    await testSetup.renderOnce();

    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await Bun.sleep(0);
      await testSetup!.renderOnce();
    });
    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("theme:green");
    expect(frame).not.toContain("theme:amber");
    expect(frame).not.toContain("Commands");
  });

  test("keeps typed prefixes in the root query until a result is activated", async () => {
    testSetup = await testRender(<CommandBarHarness query="T " />, {
      width: 80,
      height: 24,
    });

    await testSetup.renderOnce();

    let frame = testSetup.captureCharFrame();
    expect(frame).toContain("Commands");
    expect(frame).toContain("T");
    expect(frame).toContain("Type a ticker symbol");
    expect(frame).not.toContain("Back");
  });

  test("QQ without an active ticker opens inline ticker search on enter", async () => {
    testSetup = await testRender(<CommandBarHarness query="QQ" />, {
      width: 100,
      height: 20,
    });

    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain("Quote Monitor");
    expect(testSetup.captureCharFrame()).not.toContain("Back");

    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Back");
    expect(frame).toContain("Search Ticker");
  });

  test("QQ with an active ticker shows ghost completion and tab inserts the symbol", async () => {
    testSetup = await testRender(<CommandBarHarness query="QQ" live selectedTicker="AAPL" showQueryState />, {
      width: 100,
      height: 20,
    });

    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain("QQ AAPL");
    expect(testSetup.captureCharFrame()).toContain("Shortcut: Quote Monitor for AAPL");
    expect(testSetup.captureCharFrame()).toContain("query:QQ");

    await act(async () => {
      testSetup!.mockInput.pressTab();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("query:QQ AAPL");
  });

  test("typing a shorthand and pressing enter executes the inferred quote monitor shortcut", async () => {
    const created: Array<{ templateId: string; options?: Record<string, unknown> }> = [];

    testSetup = await testRender(<CommandBarHarness
      query=""
      live
      selectedTicker="AAPL"
      configurePluginRegistry={(pluginRegistry) => {
        pluginRegistry.createPaneFromTemplateAsyncFn = async (templateId, options) => {
          created.push({ templateId, options });
        };
      }}
    />, {
      width: 100,
      height: 20,
    });

    await testSetup.renderOnce();

    await act(async () => {
      await testSetup!.mockInput.typeText("QQ");
      testSetup!.mockInput.pressEnter();
      await Bun.sleep(0);
      await testSetup!.renderOnce();
    });

    expect(created).toEqual([{
      templateId: "quote-monitor-pane",
      options: {
        arg: "AAPL",
        symbol: "AAPL",
        ticker: makeTicker("AAPL", "Apple Inc."),
      },
    }]);
  });

  test("clears the root query with cmd-backspace", async () => {
    testSetup = await testRender(<CommandBarHarness query="T AMD" />, {
      width: 80,
      height: 24,
    });

    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain("T AMD");

    await act(async () => {
      testSetup!.mockInput.pressKey("backspace", { meta: true });
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Commands");
    expect(frame).toContain("Search");
    expect(frame).not.toContain("T AMD");
  });

  test("pressing the close shortcut at the root closes the command bar", async () => {
    testSetup = await testRender(<CommandBarHarness query="" live />, {
      width: 80,
      height: 24,
    });

    await testSetup.renderOnce();

    await act(async () => {
      testSetup!.mockInput.pressKey("`");
      await testSetup!.renderOnce();
    });

    expect(testSetup.captureCharFrame()).not.toContain("Commands");
  });

  test("loads provider-backed ticker search results in the root command results", async () => {
    testSetup = await testRender(
      <CommandBarHarness
        query="T appl"
        dataProvider={makeDataProvider(async () => [
          { providerId: "yahoo", symbol: "IVSX", name: "Invsivx Holdings", exchange: "NYSE", type: "ETF" },
          { providerId: "yahoo", symbol: "AAPL", name: "Apple Inc", exchange: "NASDAQ", type: "EQUITY" },
          { providerId: "yahoo", symbol: "AMAT", name: "Applied Materials", exchange: "NASDAQ", type: "EQUITY" },
          { providerId: "yahoo", symbol: "AAOI", name: "Applied Optoelectronics", exchange: "NASDAQ", type: "EQUITY" },
          { providerId: "yahoo", symbol: "APP", name: "AppLovin Corp", exchange: "NASDAQ", type: "EQUITY" },
        ])}
      />,
      { width: 80, height: 24 },
    );

    await testSetup.renderOnce();
    const frame = await waitForFrameToContain("AAOI");
    expect(frame).toContain("Saved");
    expect(frame).toContain("Other Listings");
    expect(frame).toContain("APP");
    expect(frame).toContain("AAOI");
  });

  test("T MSFT opens an exact ticker directly", async () => {
    const pinned: string[] = [];

    testSetup = await testRender(
      <CommandBarHarness
        query="T MSFT"
        configurePluginRegistry={(pluginRegistry) => {
          pluginRegistry.pinTickerFn = (symbol) => {
            pinned.push(symbol);
          };
        }}
      />,
      { width: 100, height: 20 },
    );

    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await Bun.sleep(0);
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    expect(pinned).toEqual(["MSFT"]);
  });

  test("AW AAPL uses the active watchlist target by default", async () => {
    const saved: TickerRecord[] = [];

    testSetup = await testRender(
      <CommandBarHarness
        query="AW AAPL"
        onSaveTicker={(ticker) => {
          saved.push(ticker);
        }}
        configureState={(state) => ({
          ...state,
          paneState: {
            ...state.paneState,
            "portfolio-list:main": {
              collectionId: "watchlist",
            },
          },
        })}
      />,
      { width: 100, height: 20 },
    );

    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await Bun.sleep(0);
      await testSetup!.renderOnce();
    });

    expect(saved.at(-1)?.metadata.watchlists).toEqual(["watchlist"]);
  });

  test("bare AW without a compatible active target opens inline target selection", async () => {
    testSetup = await testRender(
      <CommandBarHarness
        query="AW"
        selectedTicker="AAPL"
      />,
      { width: 100, height: 20 },
    );

    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Add AAPL to Watchlist");
    expect(frame).toContain("Watchlist");
    expect(frame).toContain("Back");
  });

  test("typing add still surfaces Add to Portfolio for a ticker already in the active manual portfolio", async () => {
    testSetup = await testRender(
      <CommandBarHarness
        query="add"
        selectedTicker="AAPL"
        configureConfig={(config) => ({
          ...config,
          portfolios: [{ id: "research", name: "Research", currency: "USD" }],
        })}
        configureState={(state) => ({
          ...state,
          paneState: {
            ...state.paneState,
            "portfolio-list:main": {
              collectionId: "research",
              cursorSymbol: "AAPL",
            },
          },
        })}
        extraTickers={[makeTicker("AAPL", "Apple Inc.", {
          portfolios: ["research"],
        })]}
      />,
      { width: 100, height: 20 },
    );

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Add AAPL to Portfolio");
    expect(frame).toContain('in "Research"');
  });

  test("AP opens the add-to-portfolio workflow and prefills avg cost from the current price", async () => {
    testSetup = await testRender(
      <CommandBarHarness
        query="AP AAPL"
        selectedTicker="AAPL"
        configureConfig={(config) => ({
          ...config,
          portfolios: [{ id: "research", name: "Research", currency: "USD" }],
        })}
        configureState={(state) => ({
          ...state,
          paneState: {
            ...state.paneState,
            "portfolio-list:main": {
              collectionId: "research",
              cursorSymbol: "AAPL",
            },
          },
          financials: new Map([["AAPL", {
            annualStatements: [],
            quarterlyStatements: [],
            priceHistory: [],
            quote: {
              symbol: "AAPL",
              price: 205.5,
              currency: "USD",
              change: 1.25,
              changePercent: 0.61,
              lastUpdated: Date.now(),
            },
          }]]),
        })}
        extraTickers={[makeTicker("AAPL", "Apple Inc.", {
          portfolios: ["research"],
        })]}
      />,
      { width: 100, height: 30 },
    );

    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await testSetup!.renderOnce();
    });

    const frame = await waitForFrameToContain("Avg Cost");
    expect(frame).toContain("Shares");
    expect(frame).toContain("Avg Cost");
    expect(frame).toContain("205.5");
    expectSingleBackControl(frame);
  });

  test("add-to-portfolio can still add membership without entering a position", async () => {
    const saved: TickerRecord[] = [];

    testSetup = await testRender(
      <CommandBarHarness
        query="AP AAPL"
        selectedTicker="AAPL"
        onSaveTicker={(ticker) => {
          saved.push(ticker);
        }}
        configureConfig={(config) => ({
          ...config,
          portfolios: [{ id: "research", name: "Research", currency: "USD" }],
        })}
        configureState={(state) => ({
          ...state,
          paneState: {
            ...state.paneState,
            "portfolio-list:main": {
              collectionId: "research",
              cursorSymbol: "AAPL",
            },
          },
        })}
      />,
      { width: 100, height: 30 },
    );

    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await testSetup!.renderOnce();
    });

    const frame = await waitForFrameToContain("Avg Cost");
    expect(frame).toContain("Shares");
    expect(frame).toContain("Avg Cost");

    await clickFrameText("Add to Portfolio");
    await act(async () => {
      await Bun.sleep(0);
      await testSetup!.renderOnce();
    });

    expect(saved.at(-1)?.metadata.portfolios).toEqual(["research"]);
    expect(saved.at(-1)?.metadata.positions).toEqual([]);
  });

  test("only surfaces Set Portfolio Position when a manual portfolio exists", async () => {
    testSetup = await testRender(
      <CommandBarHarness query="Set Portfolio Position" />,
      { width: 100, height: 20 },
    );

    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain("Set Portfolio Position");

    testSetup.renderer.destroy();
    testSetup = await testRender(
      <CommandBarHarness
        query="Set Portfolio Position"
        configureConfig={(config) => ({
          ...config,
          portfolios: [{
            id: "broker:ibkr",
            name: "IBKR Account",
            currency: "USD",
            brokerId: "ibkr",
            brokerInstanceId: "ibkr-live",
          }],
        })}
      />,
      { width: 100, height: 20 },
    );

    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain('No matches for "Set Portfolio Position"');
    expect(frame).not.toContain("Create or update a manual position in a portfolio");
  });

  test("matches set portfolio position when searching edit position", async () => {
    testSetup = await testRender(
      <CommandBarHarness
        query="edit position"
        selectedTicker="AAPL"
        configureConfig={(config) => ({
          ...config,
          portfolios: [{ id: "research", name: "Research", currency: "USD" }],
        })}
        configureState={(state) => ({
          ...state,
          paneState: {
            ...state.paneState,
            "portfolio-list:main": {
              collectionId: "research",
              cursorSymbol: "AAPL",
            },
          },
        })}
      />,
      { width: 100, height: 20 },
    );

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Set Position for AAPL");
    expect(frame).toContain('in "Research"');
  });

  test("prefills the portfolio position workflow from the active manual portfolio and ticker", async () => {
    testSetup = await testRender(
      <CommandBarHarness
        query="Set Position for AAPL"
        selectedTicker="AAPL"
        configureConfig={(config) => ({
          ...config,
          portfolios: [{ id: "research", name: "Research", currency: "USD" }],
        })}
        configureState={(state) => ({
          ...state,
          paneState: {
            ...state.paneState,
            "portfolio-list:main": {
              collectionId: "research",
              cursorSymbol: "AAPL",
            },
          },
        })}
        extraTickers={[makeTicker("AAPL", "Apple Inc.", {
          portfolios: ["research"],
          positions: [{
            portfolio: "research",
            shares: 10,
            avgCost: 180,
            currency: "USD",
            broker: "manual",
          }],
        })]}
      />,
      { width: 100, height: 30 },
    );

    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await testSetup!.renderOnce();
    });

    const frame = await waitForFrameToContain("Avg Cost");
    expect(frame).toContain("Research");
    expect(frame).toContain("AAPL");
    expect(frame).toContain("10");
    expect(frame).toContain("180");
    expectSingleBackControl(frame);
  });

  test("submits the portfolio position workflow and persists a manual position", async () => {
    const saved: TickerRecord[] = [];

    testSetup = await testRender(
      <CommandBarHarness
        query="Set Position for AAPL"
        selectedTicker="AAPL"
        onSaveTicker={(ticker) => {
          saved.push(ticker);
        }}
        configureConfig={(config) => ({
          ...config,
          portfolios: [{ id: "research", name: "Research", currency: "USD" }],
        })}
        configureState={(state) => ({
          ...state,
          paneState: {
            ...state.paneState,
            "portfolio-list:main": {
              collectionId: "research",
              cursorSymbol: "AAPL",
            },
          },
        })}
      />,
      { width: 100, height: 30 },
    );

    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await testSetup!.renderOnce();
    });

    await act(async () => {
      testSetup!.mockInput.pressTab();
      await testSetup!.renderOnce();
    });
    await act(async () => {
      testSetup!.mockInput.pressTab();
      await testSetup!.renderOnce();
    });
    await act(async () => {
      await testSetup!.mockInput.typeText("10");
      await testSetup!.renderOnce();
    });
    await act(async () => {
      testSetup!.mockInput.pressTab();
      await testSetup!.renderOnce();
    });
    await act(async () => {
      await testSetup!.mockInput.typeText("180");
      await testSetup!.renderOnce();
    });
    await act(async () => {
      testSetup!.mockInput.pressTab();
      await testSetup!.renderOnce();
    });
    await act(async () => {
      await testSetup!.mockInput.typeText("EUR");
      await testSetup!.renderOnce();
    });
    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await Bun.sleep(0);
      await testSetup!.renderOnce();
    });

    expect(saved.at(-1)?.metadata.portfolios).toEqual(["research"]);
    expect(saved.at(-1)?.metadata.positions).toEqual([{
      portfolio: "research",
      shares: 10,
      avgCost: 180,
      currency: "EUR",
      broker: "manual",
    }]);
  });

  test("removing a ticker from a manual portfolio also removes its position", async () => {
    const saved: TickerRecord[] = [];

    testSetup = await testRender(
      <CommandBarHarness
        query="RP AAPL"
        selectedTicker="AAPL"
        onSaveTicker={(ticker) => {
          saved.push(ticker);
        }}
        configureConfig={(config) => ({
          ...config,
          portfolios: [{ id: "research", name: "Research", currency: "USD" }],
        })}
        configureState={(state) => ({
          ...state,
          paneState: {
            ...state.paneState,
            "portfolio-list:main": {
              collectionId: "research",
              cursorSymbol: "AAPL",
            },
          },
        })}
        extraTickers={[makeTicker("AAPL", "Apple Inc.", {
          portfolios: ["research"],
          positions: [{
            portfolio: "research",
            shares: 4,
            avgCost: 175,
            currency: "USD",
            broker: "manual",
          }],
        })]}
      />,
      { width: 100, height: 20 },
    );

    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await Bun.sleep(0);
      await testSetup!.renderOnce();
    });

    expect(saved.at(-1)?.metadata.portfolios).toEqual([]);
    expect(saved.at(-1)?.metadata.positions).toEqual([]);
  });

  test("deleting a manual portfolio also cleans saved ticker positions", async () => {
    const saved: TickerRecord[] = [];

    testSetup = await testRender(
      <CommandBarHarness
        query="Delete Portfolio"
        onSaveTicker={(ticker) => {
          saved.push(ticker);
        }}
        configureConfig={(config) => ({
          ...config,
          portfolios: [{ id: "research", name: "Research", currency: "USD" }],
        })}
        configureState={(state) => ({
          ...state,
          paneState: {
            ...state.paneState,
            "portfolio-list:main": {
              collectionId: "research",
              cursorSymbol: "AAPL",
            },
          },
        })}
        extraTickers={[makeTicker("AAPL", "Apple Inc.", {
          portfolios: ["research"],
          positions: [{
            portfolio: "research",
            shares: 2,
            avgCost: 160,
            currency: "USD",
            broker: "manual",
          }],
        })]}
      />,
      { width: 100, height: 20 },
    );

    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await testSetup!.renderOnce();
    });
    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await testSetup!.renderOnce();
    });
    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await Bun.sleep(0);
      await testSetup!.renderOnce();
    });

    expect(saved.at(-1)?.metadata.portfolios).toEqual([]);
    expect(saved.at(-1)?.metadata.positions).toEqual([]);
  });

  test("pressing enter after arrow navigation ignores stale mouse hover", async () => {
    const pinned: string[] = [];

    testSetup = await testRender(
      <CommandBarHarness
        query=""
        configurePluginRegistry={(pluginRegistry) => {
          pluginRegistry.pinTickerFn = (symbol) => {
            pinned.push(symbol);
          };
        }}
      />,
      { width: 80, height: 24 },
    );

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    const rows = frame.split("\n");
    const hoveredRow = rows.findIndex((line) => line.includes("AAPL"));
    const hoveredCol = rows[hoveredRow]?.indexOf("AAPL") ?? -1;

    expect(hoveredRow).toBeGreaterThanOrEqual(0);
    expect(hoveredCol).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.moveTo(hoveredCol + 1, hoveredRow);
      await testSetup!.renderOnce();
    });

    await act(async () => {
      testSetup!.mockInput.pressArrow("down");
      await testSetup!.renderOnce();
    });

    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await Bun.sleep(0);
      await testSetup!.renderOnce();
    });

    expect(pinned).toEqual(["MSFT"]);
  });

  test("pressing enter follows the displayed grouped order and opens confirm for the highlighted destructive item", async () => {
    const executed: string[] = [];

    testSetup = await testRender(
      <CommandBarHarness
        query="delete"
        configurePluginRegistry={(pluginRegistry) => {
          (pluginRegistry.commands as Map<string, any>).set("delete-layout", {
            id: "delete-layout",
            label: "Delete Layout",
            description: "Delete the current layout preset",
            category: "Layout Manager",
            execute: async () => {
              executed.push("delete-layout");
            },
          });
        }}
      />,
      { width: 100, height: 20 },
    );

    await testSetup.renderOnce();
    const initialFrame = testSetup.captureCharFrame();
    expect(initialFrame).toContain("Delete Layout");
    expect(initialFrame).toContain("Danger");

    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await testSetup!.renderOnce();
    });

    let frame = testSetup.captureCharFrame();
    expect(frame).toContain("Delete Layout");
    expect(frame).toContain("Back");
    expectSingleBackControl(frame);
    expect(executed).toEqual([]);

    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await Bun.sleep(0);
      await testSetup!.renderOnce();
    });

    expect(executed).toEqual(["delete-layout"]);
  });

  test("uses backspace to leave confirm routes", async () => {
    testSetup = await testRender(
      <CommandBarHarness
        query="delete"
        configurePluginRegistry={(pluginRegistry) => {
          (pluginRegistry.commands as Map<string, any>).set("delete-layout", {
            id: "delete-layout",
            label: "Delete Layout",
            description: "Delete the current layout preset",
            category: "Layout Manager",
            execute: async () => {},
          });
        }}
      />,
      { width: 100, height: 20 },
    );

    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await testSetup!.renderOnce();
    });
    await renderFrames();

    await act(async () => {
      testSetup!.mockInput.pressBackspace();
      await testSetup!.renderOnce();
    });
    await renderFrames();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Delete Layout");
    expect(frame).not.toContain("Back  Delete Layout");
  });

  test("moves through long result lists with the mouse wheel", async () => {
    testSetup = await testRender(
      <CommandBarHarness
        query="NP scratch"
        configurePluginRegistry={(pluginRegistry) => {
          const paneTemplates = pluginRegistry.paneTemplates as Map<string, any>;
          for (let index = 0; index < 20; index++) {
            const suffix = String(index).padStart(2, "0");
            paneTemplates.set(`scratch-${suffix}`, {
              id: `scratch-${suffix}`,
              paneId: "chat",
              label: `Scratch Pane ${suffix}`,
              description: `Open scratch pane ${suffix}`,
            });
          }
        }}
      />,
      { width: 100, height: 18 },
    );

    await testSetup.renderOnce();

    const initialFrame = testSetup.captureCharFrame();
    expect(initialFrame).toContain("Scratch Pane 00");
    expect(initialFrame).not.toContain("Scratch Pane 12");

    const rows = initialFrame.split("\n");
    const scrollRow = rows.findIndex((line) => line.includes("Scratch Pane 00"));
    const scrollCol = rows[scrollRow]?.indexOf("Scratch Pane 00") ?? -1;

    expect(scrollRow).toBeGreaterThanOrEqual(0);
    expect(scrollCol).toBeGreaterThanOrEqual(0);

    await act(async () => {
      for (let index = 0; index < 12; index++) {
        await testSetup!.mockMouse.scroll(scrollCol + 1, scrollRow, "down");
        await testSetup!.renderOnce();
      }
    });

    const scrolledFrame = testSetup.captureCharFrame();
    expect(scrolledFrame).not.toContain("Scratch Pane 00");
    expect(scrolledFrame).toContain("Scratch Pane 12");
  });

  test("closes when clicking outside the command bar", async () => {
    testSetup = await testRender(<CommandBarHarness query="" live />, {
      width: 80,
      height: 24,
    });

    await testSetup.renderOnce();

    await act(async () => {
      await testSetup!.mockMouse.click(0, 0);
      await testSetup!.renderOnce();
    });
    await testSetup.renderOnce();

    expect(testSetup.captureCharFrame()).not.toContain("Commands");
  });

  const layoutModeConfig = (config: AppConfig): AppConfig => {
    const research = cloneLayout(config.layout);
    research.dockRoot = { kind: "pane", instanceId: "portfolio-list:main" };
    research.floating = [{ instanceId: "ticker-detail:main", x: 8, y: 2, width: 36, height: 12 }];
    return {
      ...config,
      layouts: [
        { name: "Default", layout: cloneLayout(config.layout) },
        { name: "Research", layout: research },
      ],
    };
  };

  const layoutModeState = (state: AppState): AppState => ({
    ...state,
    layoutHistory: {
      0: {
        past: [cloneLayout(state.config.layout)],
        future: [],
      },
    },
  });

  test("renders layout mode with focused pane actions", async () => {
    testSetup = await testRender(<CommandBarHarness
      query="LAY "
      configureConfig={layoutModeConfig}
      configureState={layoutModeState}
    />, {
      width: 90,
      height: 28,
    });

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Focused Pane");
    expect(frame).toContain("Float Pane");
    expect(frame).toContain("Undo Layout Change");
    expect(frame).toContain("Current Layout");
  });

  test("renders filtered saved layouts with textual previews", async () => {
    testSetup = await testRender(<CommandBarHarness
      query="LAY Research"
      configureConfig={layoutModeConfig}
      configureState={layoutModeState}
    />, {
      width: 120,
      height: 18,
    });

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Research");
    expect(frame).toContain("1c / 1d");
  });

  test("renders new pane mode with plugin-defined pane templates", async () => {
    testSetup = await testRender(<CommandBarHarness query="NP chat" />, {
      width: 100,
      height: 18,
    });

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Chat");
    expect(frame).not.toContain("float");
  });

  test("shows pane shortcuts in the default browse results", async () => {
    testSetup = await testRender(<CommandBarHarness query="" selectedTicker="AAPL" />, {
      width: 100,
      height: 24,
    });

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Panes");
    expect(frame).toContain("Quote Monitor");
    expect(frame).toContain("QQ");
  });

  test("matches direct pane shortcut queries", async () => {
    testSetup = await testRender(<CommandBarHarness query="QQ MSFT" selectedTicker="AAPL" />, {
      width: 100,
      height: 18,
    });

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Quote Monitor");
    expect(frame).toContain("QQ");
  });

  test("opens plugin command wizards inline inside the command bar", async () => {
    let submittedValues: Record<string, string> | undefined;

    testSetup = await testRender(<CommandBarHarness
      query="Plugin Login"
      configurePluginRegistry={(pluginRegistry) => {
        (pluginRegistry.commands as Map<string, any>).set("plugin:login", {
          id: "plugin:login",
          label: "Plugin Login",
          description: "Authenticate without leaving the command bar",
          category: "config",
          wizard: [
            { key: "username", label: "Username", type: "text", placeholder: "vince" },
            { key: "password", label: "Password", type: "password", placeholder: "secret" },
            { key: "_validate", label: "Validating", type: "info", body: ["Validating…", "Connected."] },
          ],
          execute: async (values?: Record<string, string>) => {
            submittedValues = values;
          },
        } as any);
        pluginRegistry.getCommandPluginId = (commandId: string) => (
          commandId === "plugin:login" ? "notes" : "news"
        );
      }}
    />, {
      width: 100,
      height: 24,
    });

    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await testSetup!.renderOnce();
    });

    let frame = testSetup.captureCharFrame();
    expect(frame).toContain("Plugin Login");
    expect(frame).toContain("Username");
    expect(frame).toContain("Password");

    await act(async () => {
      await testSetup!.mockInput.typeText("vince");
      await testSetup!.renderOnce();
    });
    await act(async () => {
      testSetup!.mockInput.pressTab();
      await testSetup!.renderOnce();
    });
    await act(async () => {
      await testSetup!.mockInput.typeText("secret");
      await testSetup!.renderOnce();
    });

    frame = await waitForFrameToContain("******");
    expect(frame).toContain("******");
    expect(frame).not.toContain("secret");
    expectSingleBackControl(frame);

    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await Bun.sleep(0);
      await testSetup!.renderOnce();
    });

    expect(submittedValues).toEqual({
      username: "vince",
      password: "secret",
    });
  });

  test("does not treat backspace as Back inside workflow text fields", async () => {
    testSetup = await testRender(<CommandBarHarness
      query="Plugin Login"
      configurePluginRegistry={(pluginRegistry) => {
        (pluginRegistry.commands as Map<string, any>).set("plugin:login", {
          id: "plugin:login",
          label: "Plugin Login",
          description: "Authenticate without leaving the command bar",
          category: "config",
          wizard: [
            { key: "username", label: "Username", type: "text", placeholder: "vince" },
          ],
          execute: async () => {},
        } as any);
        pluginRegistry.getCommandPluginId = () => "notes";
      }}
    />, {
      width: 100,
      height: 24,
    });

    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await testSetup!.renderOnce();
    });

    await act(async () => {
      await testSetup!.mockInput.typeText("vince");
      await testSetup!.renderOnce();
    });
    await act(async () => {
      testSetup!.mockInput.pressBackspace();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Plugin Login");
    expect(frame).toContain("vinc");
    expect(frame).toContain("Back");
  });

  test("QQ MSFT executes directly without opening a secondary workflow", async () => {
    const created: Array<{ templateId: string; options?: Record<string, unknown> }> = [];

    testSetup = await testRender(<CommandBarHarness
      query="QQ MSFT"
      selectedTicker="AAPL"
      configurePluginRegistry={(pluginRegistry) => {
        pluginRegistry.createPaneFromTemplateAsyncFn = async (templateId, options) => {
          created.push({ templateId, options });
        };
      }}
    />, {
      width: 100,
      height: 20,
    });

    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await Bun.sleep(0);
      await testSetup!.renderOnce();
    });

    expect(created).toEqual([{
      templateId: "quote-monitor-pane",
      options: {
        arg: "MSFT",
        symbol: "MSFT",
        ticker: makeTicker("MSFT", "Microsoft Corp."),
      },
    }]);
  });

  test("CMP AAPL,MSFT creates the comparison chart directly", async () => {
    const created: Array<{ templateId: string; options?: Record<string, unknown> }> = [];

    testSetup = await testRender(<CommandBarHarness
      query="CMP AAPL,MSFT"
      configurePluginRegistry={(pluginRegistry) => {
        (pluginRegistry.panes as Map<string, any>).set("comparison-chart", {
          id: "comparison-chart",
          name: "Comparison Chart",
          component: () => null,
          defaultPosition: "right",
        });
        (pluginRegistry.paneTemplates as Map<string, any>).set("comparison-chart-pane", {
          id: "comparison-chart-pane",
          paneId: "comparison-chart",
          label: "Comparison Chart",
          description: "Compare multiple symbols in one pane",
          shortcut: { prefix: "CMP", argPlaceholder: "tickers", argKind: "ticker-list" },
        });
        pluginRegistry.createPaneFromTemplateAsyncFn = async (templateId, options) => {
          created.push({ templateId, options });
        };
      }}
    />, {
      width: 100,
      height: 20,
    });

    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await Bun.sleep(0);
      await testSetup!.renderOnce();
    });

    expect(created).toEqual([{
      templateId: "comparison-chart-pane",
      options: {
        arg: "AAPL,MSFT",
        symbols: ["AAPL", "MSFT"],
      },
    }]);
  });

  test("CMP AAPL, opens inline completion when the ticker list is incomplete", async () => {
    testSetup = await testRender(<CommandBarHarness
      query="CMP AAPL,"
      configurePluginRegistry={(pluginRegistry) => {
        (pluginRegistry.panes as Map<string, any>).set("comparison-chart", {
          id: "comparison-chart",
          name: "Comparison Chart",
          component: () => null,
          defaultPosition: "right",
        });
        (pluginRegistry.paneTemplates as Map<string, any>).set("comparison-chart-pane", {
          id: "comparison-chart-pane",
          paneId: "comparison-chart",
          label: "Comparison Chart",
          description: "Compare multiple symbols in one pane",
          shortcut: { prefix: "CMP", argPlaceholder: "tickers", argKind: "ticker-list" },
        });
      }}
    />, {
      width: 100,
      height: 20,
    });

    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Comparison Chart");
    expect(frame).toContain("Tickers");
    expect(frame).toContain("AAPL,");
  });

  test("AI <prompt> opens the inline workflow and prefills the textarea prompt", async () => {
    const created: Array<{ templateId: string; options?: Record<string, unknown> }> = [];

    testSetup = await testRender(<CommandBarHarness
      query="AI quality compounders"
      configurePluginRegistry={(pluginRegistry) => {
        (pluginRegistry.panes as Map<string, any>).set("ai-screener", {
          id: "ai-screener",
          name: "AI Screener",
          component: () => null,
          defaultPosition: "right",
          defaultMode: "floating",
        });
        (pluginRegistry.paneTemplates as Map<string, any>).set("new-ai-screener-pane", {
          id: "new-ai-screener-pane",
          paneId: "ai-screener",
          label: "AI Screener",
          description: "Create a prompt-driven screener pane.",
          shortcut: { prefix: "AI", argPlaceholder: "prompt", argKind: "text" },
          wizard: [
            {
              key: "providerId",
              label: "AI Provider",
              type: "select",
              defaultValue: "claude",
              options: [{ label: "Claude", value: "claude" }],
            },
            {
              key: "prompt",
              label: "Screener Prompt",
              type: "textarea",
            },
          ],
        });
        pluginRegistry.createPaneFromTemplateAsyncFn = async (templateId, options) => {
          created.push({ templateId, options });
        };
      }}
    />, {
      width: 100,
      height: 24,
    });

    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("AI Screener");
    expect(frame).toContain("AI Provider");
    expect(frame).toContain("quality compounders");
    expect(created).toEqual([]);
  });

  test("submits typed AI screener prompts from the textarea field", async () => {
    const created: Array<{ templateId: string; options?: Record<string, unknown> }> = [];

    testSetup = await testRender(<CommandBarHarness
      query="AI"
      configurePluginRegistry={(pluginRegistry) => {
        (pluginRegistry.panes as Map<string, any>).set("ai-screener", {
          id: "ai-screener",
          name: "AI Screener",
          component: () => null,
          defaultPosition: "right",
          defaultMode: "floating",
        });
        (pluginRegistry.paneTemplates as Map<string, any>).set("new-ai-screener-pane", {
          id: "new-ai-screener-pane",
          paneId: "ai-screener",
          label: "AI Screener",
          description: "Create a prompt-driven screener pane.",
          shortcut: { prefix: "AI", argPlaceholder: "prompt", argKind: "text" },
          wizard: [
            {
              key: "providerId",
              label: "AI Provider",
              type: "select",
              defaultValue: "claude",
              options: [{ label: "Claude", value: "claude" }],
            },
            {
              key: "prompt",
              label: "Screener Prompt",
              type: "textarea",
            },
          ],
        });
        pluginRegistry.createPaneFromTemplateAsyncFn = async (templateId, options) => {
          created.push({ templateId, options });
        };
      }}
    />, {
      width: 100,
      height: 24,
    });

    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await testSetup!.renderOnce();
    });
    await act(async () => {
      testSetup!.mockInput.pressTab();
      await testSetup!.renderOnce();
    });
    await act(async () => {
      await testSetup!.mockInput.typeText("humanoid robot suppliers");
      await testSetup!.renderOnce();
    });
    await clickFrameText("Create Pane");
    await act(async () => {
      await Bun.sleep(0);
      await testSetup!.renderOnce();
    });

    expect(created).toEqual([{
      templateId: "new-ai-screener-pane",
      options: {
        arg: "humanoid robot suppliers",
        values: {
          providerId: "claude",
          prompt: "humanoid robot suppliers",
        },
      },
    }]);
  });

  test("edits pane settings inline inside the command bar", async () => {
    const appliedValues: Array<{ paneId: string; key: string; value: unknown }> = [];

    testSetup = await testRender(<CommandBarHarness
      query="PS"
      configureState={(state) => ({
        ...state,
        focusedPaneId: "quote-monitor:main",
      })}
      hasPaneSettings={(paneId) => paneId === "quote-monitor:main"}
      configurePluginRegistry={(pluginRegistry) => {
        pluginRegistry.resolvePaneSettings = () => ({
          paneId: "quote-monitor:main",
          pane: {
            instanceId: "quote-monitor:main",
            paneId: "quote-monitor",
            title: "Quote Monitor",
            settings: {},
          },
          paneDef: pluginRegistry.panes.get("quote-monitor")!,
          settingsDef: {
            title: "Quote Monitor Settings",
            fields: [{
              key: "symbol",
              label: "Symbol",
              type: "text",
              description: "Ticker symbol to track",
            }],
          },
          context: {
            config: createDefaultConfig("/tmp/gloomberb-test"),
            layout: cloneLayout(createDefaultConfig("/tmp/gloomberb-test").layout),
            paneId: "quote-monitor:main",
            paneType: "quote-monitor",
            pane: {
              instanceId: "quote-monitor:main",
              paneId: "quote-monitor",
              title: "Quote Monitor",
              settings: {},
            },
            settings: {},
            paneState: {},
            activeTicker: "AAPL",
            activeCollectionId: "main",
          },
        }) as any;
        pluginRegistry.applyPaneSettingValueFn = async (paneId, field, value) => {
          appliedValues.push({ paneId, key: field.key, value });
        };
      }}
    />, {
      width: 100,
      height: 20,
    });

    await testSetup.renderOnce();

    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await testSetup!.renderOnce();
    });
    let frame = testSetup.captureCharFrame();
    expect(frame).toContain("Quote Monitor Settings");
    expect(frame).toContain("Symbol");

    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await testSetup!.renderOnce();
    });
    frame = testSetup.captureCharFrame();
    await clickFrameText("Symbol");
    frame = testSetup.captureCharFrame();
    expect(frame).toContain("Apply");
    expect(frame).toContain("Symbol");

    await act(async () => {
      await testSetup!.mockInput.typeText("MSFT");
      await testSetup!.renderOnce();
    });
    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await Bun.sleep(0);
      await testSetup!.renderOnce();
    });

    expect(appliedValues).toEqual([{
      paneId: "quote-monitor:main",
      key: "symbol",
      value: "MSFT",
    }]);
  });

  test("uses backspace as back only when a pane-settings route query is empty", async () => {
    testSetup = await testRender(<CommandBarHarness
      query="PS"
      configureState={(state) => ({
        ...state,
        focusedPaneId: "quote-monitor:main",
      })}
      hasPaneSettings={(paneId) => paneId === "quote-monitor:main"}
      configurePluginRegistry={(pluginRegistry) => {
        pluginRegistry.resolvePaneSettings = () => ({
          paneId: "quote-monitor:main",
          pane: {
            instanceId: "quote-monitor:main",
            paneId: "quote-monitor",
            title: "Quote Monitor",
            settings: {},
          },
          paneDef: pluginRegistry.panes.get("quote-monitor")!,
          settingsDef: {
            title: "Quote Monitor Settings",
            fields: [{
              key: "symbol",
              label: "Symbol",
              type: "text",
              description: "Ticker symbol to track",
            }],
          },
          context: {
            config: createDefaultConfig("/tmp/gloomberb-test"),
            layout: cloneLayout(createDefaultConfig("/tmp/gloomberb-test").layout),
            paneId: "quote-monitor:main",
            paneType: "quote-monitor",
            pane: {
              instanceId: "quote-monitor:main",
              paneId: "quote-monitor",
              title: "Quote Monitor",
              settings: {},
            },
            settings: {},
            paneState: {},
            activeTicker: "AAPL",
            activeCollectionId: "main",
          },
        }) as any;
      }}
    />, {
      width: 100,
      height: 20,
    });

    await testSetup.renderOnce();

    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await testSetup!.renderOnce();
    });
    await renderFrames();

    let frame = testSetup.captureCharFrame();
    expect(frame).toContain("Quote Monitor Settings");

    await act(async () => {
      await testSetup!.mockInput.typeText("s");
      await testSetup!.renderOnce();
    });

    frame = testSetup.captureCharFrame();
    expect(frame).toContain("Quote Monitor Settings");

    await emitKeypress(testSetup, { name: "backspace", sequence: "\b" });

    frame = testSetup.captureCharFrame();
    expect(frame).toContain("Quote Monitor Settings");

    await act(async () => {
      testSetup!.mockInput.pressBackspace();
      await testSetup!.renderOnce();
    });
    await renderFrames();
    await act(async () => {
      testSetup!.mockInput.pressBackspace();
      await testSetup!.renderOnce();
    });
    await renderFrames();

    frame = testSetup.captureCharFrame();
    expect(frame).not.toContain("Quote Monitor Settings");
    expect(frame).not.toContain("Back  Pane Settings");
  });

  test("renders pane-setting multi-select pickers only once inside the command bar", async () => {
    testSetup = await testRender(<CommandBarHarness
      query="PS"
      configureState={(state) => ({
        ...state,
        focusedPaneId: "quote-monitor:main",
      })}
      hasPaneSettings={(paneId) => paneId === "quote-monitor:main"}
      configurePluginRegistry={(pluginRegistry) => {
        pluginRegistry.resolvePaneSettings = () => ({
          paneId: "quote-monitor:main",
          pane: {
            instanceId: "quote-monitor:main",
            paneId: "quote-monitor",
            title: "Quote Monitor",
            settings: {},
          },
          paneDef: pluginRegistry.panes.get("quote-monitor")!,
          settingsDef: {
            title: "Quote Monitor Settings",
            fields: [{
              key: "columns",
              label: "Columns",
              type: "ordered-multi-select",
              description: "Visible columns",
              options: [
                { value: "volume", label: "AAA", description: "Volume column" },
                { value: "spread", label: "BBB", description: "Spread column" },
                { value: "beta", label: "CCC", description: "Beta column" },
              ],
            }],
          },
          context: {
            config: createDefaultConfig("/tmp/gloomberb-test"),
            layout: cloneLayout(createDefaultConfig("/tmp/gloomberb-test").layout),
            paneId: "quote-monitor:main",
            paneType: "quote-monitor",
            pane: {
              instanceId: "quote-monitor:main",
              paneId: "quote-monitor",
              title: "Quote Monitor",
              settings: {},
            },
            settings: {
              columns: ["volume", "spread"],
            },
            paneState: {},
            activeTicker: "AAPL",
            activeCollectionId: "main",
          },
        }) as any;
      }}
    />, {
      width: 100,
      height: 20,
    });

    await testSetup.renderOnce();

    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await testSetup!.renderOnce();
    });
    await clickFrameText("Columns");

    const frame = await waitForFrameToContain("Done");
    expect(frame).toContain("Columns");
    expect(frame).toContain("Done");
    expect(frame).not.toContain("Options");
    expectSingleBackControl(frame);
  });

  test("matches the IBKR trading shortcut when a gateway profile exists", async () => {
    testSetup = await testRender(<CommandBarHarness
      query="IBKR"
      configureConfig={(config) => ({
        ...config,
        brokerInstances: [{
          id: "ibkr-paper",
          brokerType: "ibkr",
          label: "Paper",
          connectionMode: "gateway",
          config: { connectionMode: "gateway", gateway: { host: "127.0.0.1", port: 4002, clientId: 1 } },
          enabled: true,
        }],
      })}
    />, {
      width: 100,
      height: 18,
    });

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("IBKR Trading");
    expect(frame).toContain("IBKR");
  });

  test("matches the direct help command", async () => {
    testSetup = await testRender(<CommandBarHarness query="help" />, {
      width: 80,
      height: 18,
    });

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Help");
    expect(frame).toContain("Navigation");
  });

  test("skips pane templates whose canCreate throws", async () => {
    testSetup = await testRender(<CommandBarHarness
      query=""
      selectedTicker="AAPL"
      configurePluginRegistry={(pluginRegistry) => {
        (pluginRegistry.paneTemplates as Map<string, any>).set("broken-pane", {
          id: "broken-pane",
          paneId: "chat",
          label: "Broken Pane",
          description: "Should not crash the command bar",
          shortcut: { prefix: "IBKR" },
          canCreate: () => {
            throw new ReferenceError("getIbkrInstances is not defined");
          },
        });
      }}
    />, {
      width: 100,
      height: 24,
    });

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Quote Monitor");
    expect(frame).not.toContain("Broken Pane");
  });

  test("groups ticker search sections and keeps saved matches above looser provider results", async () => {
    testSetup = await testRender(
      <CommandBarHarness
        query="T appl"
        dataProvider={makeDataProvider(async () => [
          { providerId: "yahoo", symbol: "IVSX", name: "Invsivx Holdings", exchange: "NYSE", type: "ETF" },
          { providerId: "yahoo", symbol: "AAPL", name: "Apple Inc", exchange: "NASDAQ", type: "EQUITY" },
          { providerId: "yahoo", symbol: "AMAT", name: "Applied Materials", exchange: "NASDAQ", type: "EQUITY" },
          { providerId: "yahoo", symbol: "AAOI", name: "Applied Optoelectronics", exchange: "NASDAQ", type: "EQUITY" },
          { providerId: "yahoo", symbol: "APP", name: "AppLovin Corp", exchange: "NASDAQ", type: "EQUITY" },
        ])}
      />,
      { width: 80, height: 24 },
    );

    await testSetup.renderOnce();
    await waitForFrameToContain("AAOI");

    const frame = testSetup.captureCharFrame();
    const rows = frame.split("\n");
    const savedHeadings = frame.split("\n").filter((line) => line.trim() === "Saved");
    const otherListingsHeadings = frame.split("\n").filter((line) => line.trim() === "Other Listings");
    const aaplRow = rows.findIndex((line) => line.trimStart().startsWith("AAPL") && line.includes("NASDAQ"));
    const appRow = rows.findIndex((line) => line.trimStart().startsWith("APP") && line.includes("NASDAQ"));
    expect(savedHeadings).toHaveLength(1);
    expect(otherListingsHeadings).toHaveLength(1);
    expect(aaplRow).toBeGreaterThanOrEqual(0);
    expect(appRow).toBeGreaterThanOrEqual(0);
    expect(aaplRow).toBeLessThan(appRow);
    expect(frame).toMatchSnapshot();
  });

  test("renders form-layout wizard fields together on one screen", async () => {
    testSetup = await testRender(
      <CommandBarHarness
        query="auth login"
        live
        configurePluginRegistry={(pluginRegistry) => {
          pluginRegistry.commands.set("auth-login", {
            id: "auth-login",
            label: "Auth Login",
            description: "Log in to your account",
            keywords: ["login", "auth"],
            category: "config",
            wizardLayout: "form",
            wizard: [
              { key: "email", label: "Email", type: "text", placeholder: "email@example.com" },
              { key: "password", label: "Password", type: "password", placeholder: "Your password" },
            ],
            execute: async () => {},
          } as any);
        }}
      />,
      { width: 80, height: 24 },
    );

    await testSetup.renderOnce();
    await clickFrameText("Auth Login");
    await act(async () => {
      await testSetup!.renderOnce();
    });

    let frame = testSetup.captureCharFrame();
    expect(frame).toContain("Back");
    expect(frame).toContain("Email");
    expect(frame).toContain("Password");
    expect(frame).toContain("Your password");
    expectSingleBackControl(frame);
  });

  test("submits single-field form-layout wizards", async () => {
    const submitted: Array<Record<string, string> | undefined> = [];

    testSetup = await testRender(
      <CommandBarHarness
        query="workspace"
        live
        configurePluginRegistry={(pluginRegistry) => {
          pluginRegistry.commands.set("new-workspace", {
            id: "new-workspace",
            label: "Workspace",
            description: "Create a workspace",
            keywords: ["workspace"],
            category: "config",
            wizardLayout: "form",
            wizard: [
              { key: "name", label: "Name", type: "text", placeholder: "Research" },
            ],
            execute: async (values) => {
              submitted.push(values);
            },
          } as any);
        }}
      />,
      { width: 80, height: 24 },
    );

    await testSetup.renderOnce();

    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await Bun.sleep(0);
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    await act(async () => {
      await testSetup!.mockInput.typeText("Research");
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await Bun.sleep(0);
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    expect(submitted).toEqual([{ name: "Research" }]);
  });
});
