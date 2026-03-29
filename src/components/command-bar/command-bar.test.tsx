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

function makeDataProvider(): DataProvider {
  return {
    id: "test",
    name: "Test Provider",
    getTickerFinancials: async () => { throw new Error("unused"); },
    getQuote: async () => { throw new Error("unused"); },
    getExchangeRate: async () => 1,
    search: async () => [],
    getNews: async () => [],
    getArticleSummary: async () => null,
    getPriceHistory: async () => [],
  };
}

function makePluginRegistry(): PluginRegistry {
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
    ]),
    paneTemplates: new Map([
      ["new-portfolio-pane", {
        id: "new-portfolio-pane",
        paneId: "portfolio-list",
        label: "New Portfolio Pane",
        description: "Open another portfolio list pane",
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
    hideWidget: () => {},
    updateLayoutFn: () => {},
    getTermSizeFn: () => ({ width: 80, height: 24 }),
    createPaneFromTemplateFn: () => {},
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
}: {
  query: string;
  disabledPlugins?: string[];
  selectedTicker?: string;
  live?: boolean;
  configureConfig?: (config: AppConfig) => AppConfig;
  configureState?: (state: AppState) => AppState;
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
  const dataProvider = makeDataProvider();
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
  const pluginRegistry = makePluginRegistry();
  const [liveState, dispatch] = useReducer(appReducer, state);

  return (
    <AppContext value={{ state: live ? liveState : state, dispatch: live ? dispatch : () => {} }}>
      <DialogProvider dialogOptions={{ style: { backgroundColor: "#000000", borderColor: "#ffffff", borderStyle: "single" } }}>
        {live && <text>{`theme:${liveState.config.theme}`}</text>}
        <CommandBar
          dataProvider={dataProvider}
          tickerRepository={tickerRepository as any}
          pluginRegistry={pluginRegistry}
          quitApp={() => {}}
        />
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
});
