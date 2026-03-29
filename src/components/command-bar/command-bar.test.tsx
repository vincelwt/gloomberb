import { afterEach, describe, expect, test } from "bun:test";
import { act, useReducer } from "react";
import { testRender } from "@opentui/react/test-utils";
import { DialogProvider } from "@opentui-ui/dialog/react";
import { CommandBar } from "./command-bar";
import { AppContext, appReducer, createInitialState } from "../../state/app-context";
import { createDefaultConfig } from "../../types/config";
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

function makePluginRegistry(): PluginRegistry {
  return {
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
    getPluginPaneIds: () => [],
    hideWidget: () => {},
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
  dataProvider = makeDataProvider(),
}: {
  query: string;
  disabledPlugins?: string[];
  selectedTicker?: string;
  live?: boolean;
  dataProvider?: DataProvider;
}) {
  const config = {
    ...createDefaultConfig("/tmp/gloomberb-test"),
    recentTickers: ["AAPL", "MSFT"],
    disabledPlugins,
  };
  const tickers = [makeTicker("AAPL", "Apple Inc."), makeTicker("MSFT", "Microsoft Corp.")];
  const state = {
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
});
