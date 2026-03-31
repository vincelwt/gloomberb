import { afterEach, describe, expect, test } from "bun:test";
import { act, useReducer } from "react";
import { testRender } from "@opentui/react/test-utils";
import { DialogProvider } from "@opentui-ui/dialog/react";
import { CommandBar } from "./command-bar";
import { AppContext, type AppState, appReducer, createInitialState } from "../../state/app-context";
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

function makeTicker(symbol: string, name: string): TickerRecord {
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
    },
  };
}

function makeDataProvider(searchImpl: DataProvider["search"] = async () => []): DataProvider {
  return {
    id: "test",
    name: "Test Provider",
    getTickerFinancials: async () => { throw new Error("unused"); },
    getQuote: async () => { throw new Error("unused"); },
    getExchangeRate: async () => 1,
    search: searchImpl,
    getNews: async () => [],
    getArticleSummary: async () => null,
    getPriceHistory: async () => [],
  };
}

function makePluginRegistry(hasPaneSettings: (paneId: string) => boolean = () => false): PluginRegistry {
  return {
    panes: new Map([
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
    paneTemplates: new Map([
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
        canCreate: (context) => context.config.brokerInstances.some((instance) => (
          instance.brokerType === "ibkr"
          && instance.connectionMode === "gateway"
          && instance.enabled !== false
        )),
      }],
    ]),
    commands: new Map([
      ["plugin:scan", {
        id: "plugin:scan",
        label: "Scan Movers",
        description: "Run a quick movers scan",
        category: "plugins",
        execute: async () => {},
      }],
    ]),
    tickerActions: new Map([
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
    createPaneFromTemplateFn: () => {},
    openPaneSettingsFn: () => {},
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
  configureConfig,
  configureState,
  configurePluginRegistry,
  dataProvider = makeDataProvider(),
  hasPaneSettings,
}: {
  query: string;
  disabledPlugins?: string[];
  selectedTicker?: string;
  live?: boolean;
  configureConfig?: (config: AppConfig) => AppConfig;
  configureState?: (state: AppState) => AppState;
  configurePluginRegistry?: (pluginRegistry: PluginRegistry) => void;
  dataProvider?: DataProvider;
  hasPaneSettings?: (paneId: string) => boolean;
}) {
  let config = {
    ...createDefaultConfig("/tmp/gloomberb-test"),
    recentTickers: ["AAPL", "MSFT"],
    disabledPlugins,
  };
  if (configureConfig) {
    config = configureConfig(config);
  }
  const tickers = [makeTicker("AAPL", "Apple Inc."), makeTicker("MSFT", "Microsoft Corp.")];
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
    saveTicker: async () => {},
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
        {currentState.commandBarOpen && (
          <CommandBar
            dataProvider={dataProvider}
            tickerRepository={tickerRepository as any}
            pluginRegistry={pluginRegistry}
            quitApp={() => {}}
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

  test("renders theme mode with the query line visible", async () => {
    testSetup = await testRender(<CommandBarHarness query="TH " />, {
      width: 80,
      height: 24,
    });

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("TH");
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

  test("pressing enter respects the highlighted search result", async () => {
    const pinned: string[] = [];

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
        configurePluginRegistry={(pluginRegistry) => {
          pluginRegistry.pinTickerFn = (symbol) => {
            pinned.push(symbol);
          };
        }}
      />,
      { width: 80, height: 24 },
    );

    await testSetup.renderOnce();
    await Bun.sleep(300);
    await testSetup.renderOnce();

    await act(async () => {
      testSetup!.mockInput.pressArrow("down");
      await testSetup!.renderOnce();
    });

    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await Bun.sleep(0);
      await testSetup!.renderOnce();
    });

    expect(pinned).toEqual(["APP"]);
  });

  test("moves through long result lists with the mouse wheel", async () => {
    testSetup = await testRender(
      <CommandBarHarness
        query="NP scratch"
        configurePluginRegistry={(pluginRegistry) => {
          for (let index = 0; index < 20; index++) {
            const suffix = String(index).padStart(2, "0");
            pluginRegistry.paneTemplates.set(`scratch-${suffix}`, {
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
    expect(frame).toContain("New Chat Pane");
    expect(frame).toContain("float");
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
    expect(frame).toContain("New IBKR Trading Pane");
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
        pluginRegistry.paneTemplates.set("broken-pane", {
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

  test("groups ticker search sections and keeps exact open matches above loose provider results", async () => {
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
    await Bun.sleep(300);
    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame.match(/Open/g)?.length).toBe(1);
    expect(frame.match(/Search Results/g)?.length).toBe(1);
    expect(frame.indexOf("AAPL")).toBeLessThan(frame.indexOf("APP"));
    expect(frame).toMatchSnapshot();
  });

  test("renders form-layout wizard fields together on one screen", async () => {
    testSetup = await testRender(
      <CommandBarHarness
        query="login"
        live
        configurePluginRegistry={(pluginRegistry) => {
          pluginRegistry.commands.set("auth-login", {
            id: "auth-login",
            label: "Login",
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

    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await Bun.sleep(0);
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    let frame = testSetup.captureCharFrame();
    expect(frame).toContain("Email");
    expect(frame).toContain("Password");
    expect(frame).toContain("Enter advances");
    expect(frame).toContain("Your password");
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
