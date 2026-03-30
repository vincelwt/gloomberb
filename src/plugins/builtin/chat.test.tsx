import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { AppContext, createInitialState } from "../../state/app-context";
import { createDefaultConfig } from "../../types/config";
import { setSharedDataProviderForTests, setSharedRegistryForTests } from "../registry";
import { ChatPane } from "./chat";
import { chatController } from "./chat-controller";
import type { ChatMessage } from "../../utils/api-client";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

const originalGetSnapshot = chatController.getSnapshot.bind(chatController);
const originalSubscribe = chatController.subscribe.bind(chatController);
const originalRefreshSession = chatController.refreshSession.bind(chatController);

afterEach(() => {
  (chatController as any).getSnapshot = originalGetSnapshot;
  (chatController as any).subscribe = originalSubscribe;
  (chatController as any).refreshSession = originalRefreshSession;
  setSharedRegistryForTests(undefined);
  setSharedDataProviderForTests(undefined);
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
});

function makeSnapshot(messages: ChatMessage[]) {
  return {
    loading: false,
    user: {
      id: "u1",
      username: "vince",
      emailVerified: true,
    },
    messages,
    draft: "",
    replyToId: null,
  };
}

describe("ChatPane", () => {
  test("renders ticker badges and opens a floating detail pane on click", async () => {
    const opened: string[] = [];
    const messages: ChatMessage[] = [{
      id: "m1",
      channelId: "everyone",
      content: "Watching $TSLA today",
      replyToId: null,
      createdAt: "2026-03-28T00:00:00.000Z",
      user: { id: "u1", username: "vince", displayName: "Vince" },
    }];
    const snapshot = makeSnapshot(messages);

    (chatController as any).getSnapshot = () => snapshot;
    (chatController as any).subscribe = (listener: (next: typeof snapshot) => void) => {
      listener(snapshot);
      return () => {};
    };
    (chatController as any).refreshSession = async () => {};

    setSharedRegistryForTests({
      pinTickerFn(symbol: string) {
        opened.push(symbol);
      },
    } as any);

    const config = createDefaultConfig("/tmp/gloomberb-chat-test");
    const state = createInitialState(config);
    state.tickers = new Map([["TSLA", {
      metadata: {
        ticker: "TSLA",
        exchange: "NASDAQ",
        currency: "USD",
        name: "Tesla, Inc.",
        portfolios: [],
        watchlists: [],
        positions: [],
        custom: {},
        tags: [],
      },
    }]]);
    state.financials = new Map([["TSLA", {
      annualStatements: [],
      quarterlyStatements: [],
      priceHistory: [],
      quote: {
        symbol: "TSLA",
        price: 250,
        currency: "USD",
        change: -12.5,
        changePercent: -5,
        lastUpdated: Date.now(),
      },
    }]]);

    await act(async () => {
      testSetup = await testRender(
        <AppContext value={{ state, dispatch: () => {} }}>
          <ChatPane paneId="chat:test" paneType="chat" width={60} height={12} focused />
        </AppContext>,
        { width: 60, height: 12 },
      );
    });

    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const lines = testSetup.captureCharFrame().split("\n");
    const row = lines.findIndex((line) => line.includes("TSLA -5%"));
    const col = lines[row]?.indexOf("TSLA -5%") ?? -1;

    expect(row).toBeGreaterThanOrEqual(0);
    expect(col).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(col + 1, row);
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    expect(opened).toEqual(["TSLA"]);
  });
});
