import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { AppContext, createInitialState } from "../../state/app-context";
import { createDefaultConfig } from "../../types/config";
import type { PersistedResourceValue } from "../../types/persistence";
import type { PluginPersistence } from "../../types/plugin";
import { apiClient, type ChatMessage } from "../../utils/api-client";
import { setSharedDataProviderForTests, setSharedRegistryForTests } from "../registry";
import { ChatContent, ChatStatusWidget, gloomberbCloudPlugin } from "./chat";
import { ChatController } from "./chat-controller";

const TRANSCRIPT_KIND = "channel-transcript";
const TRANSCRIPT_KEY = "everyone";
const TRANSCRIPT_SOURCE = "server";
const TRANSCRIPT_SCHEMA_VERSION = 2;
const originalConnectChannel = apiClient.connectChannel.bind(apiClient);

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

class MemoryPersistence implements PluginPersistence {
  private readonly state = new Map<string, { schemaVersion: number; value: unknown }>();
  private readonly resources = new Map<string, PersistedResourceValue<unknown>>();

  getState<T = unknown>(key: string, options?: { schemaVersion?: number }): T | null {
    const record = this.state.get(key);
    if (!record) return null;
    if (options?.schemaVersion != null && record.schemaVersion !== options.schemaVersion) {
      this.state.delete(key);
      return null;
    }
    return record.value as T;
  }

  setState(key: string, value: unknown, options?: { schemaVersion?: number }): void {
    this.state.set(key, { schemaVersion: options?.schemaVersion ?? 1, value });
  }

  deleteState(key: string): void {
    this.state.delete(key);
  }

  getResource<T = unknown>(
    kind: string,
    key: string,
    options?: { sourceKey?: string; schemaVersion?: number; allowExpired?: boolean },
  ): PersistedResourceValue<T> | null {
    const record = this.resources.get(`${kind}:${key}:${options?.sourceKey ?? ""}`);
    if (!record) return null;
    if (options?.schemaVersion != null && record.schemaVersion !== options.schemaVersion) {
      this.resources.delete(`${kind}:${key}:${options.sourceKey ?? ""}`);
      return null;
    }
    return record as PersistedResourceValue<T>;
  }

  setResource<T = unknown>(
    kind: string,
    key: string,
    value: T,
    options: {
      cachePolicy: { staleMs: number; expireMs: number };
      sourceKey?: string;
      schemaVersion?: number;
      provenance?: unknown;
    },
  ): PersistedResourceValue<T> {
    const now = Date.now();
    const record: PersistedResourceValue<T> = {
      value,
      fetchedAt: now,
      staleAt: now + options.cachePolicy.staleMs,
      expiresAt: now + options.cachePolicy.expireMs,
      sourceKey: options.sourceKey ?? "",
      schemaVersion: options.schemaVersion ?? 1,
      provenance: options.provenance,
    };
    this.resources.set(`${kind}:${key}:${options.sourceKey ?? ""}`, record);
    return record;
  }

  deleteResource(kind: string, key: string, options?: { sourceKey?: string }): void {
    this.resources.delete(`${kind}:${key}:${options?.sourceKey ?? ""}`);
  }
}

function makeMessage(index: number): ChatMessage {
  return {
    id: `m${index}`,
    channelId: "everyone",
    content: `message ${index}`,
    replyToId: null,
    createdAt: `2026-03-30T00:00:${String(index).padStart(2, "0")}.000Z`,
    user: {
      id: `u${index}`,
      username: `user${index}`,
      displayName: `User ${index}`,
    },
  };
}

function createController(options: {
  messages?: ChatMessage[];
  sessionToken?: string | null;
  user?: { id: string; username: string; emailVerified: boolean } | null;
} = {}) {
  const messages = options.messages ?? [];
  const persistence = new MemoryPersistence();
  const controller = new ChatController();
  const user = Object.prototype.hasOwnProperty.call(options, "user")
    ? options.user ?? null
    : { id: "u0", username: "vince", emailVerified: true };
  persistence.setState("session", {
    sessionToken: options.sessionToken ?? null,
    user,
  }, { schemaVersion: 1 });
  persistence.setState("channel:everyone", {
    draft: "",
    replyToId: null,
    lastCursor: messages[messages.length - 1]?.id ?? null,
  }, { schemaVersion: 1 });
  if (messages.length > 0) {
    persistence.setResource(TRANSCRIPT_KIND, TRANSCRIPT_KEY, { messages }, {
      sourceKey: TRANSCRIPT_SOURCE,
      schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
      cachePolicy: { staleMs: 1_000, expireMs: 2_000 },
    });
  }
  controller.attachPersistence(persistence);
  controller.refreshSession = async () => {};
  controller.refreshMessages = async () => {};
  return controller;
}

function createHarness(
  controller: ChatController,
  options?: {
    width?: number;
    height?: number;
    configureState?: (state: ReturnType<typeof createInitialState>) => void;
  },
) {
  const width = options?.width ?? 60;
  const height = options?.height ?? 12;
  const state = createInitialState(createDefaultConfig("/tmp/gloomberb-chat"));
  options?.configureState?.(state);

  return (
    <AppContext value={{ state, dispatch: () => {} }}>
      <ChatContent
        controller={controller}
        width={width}
        height={height}
        focused
      />
    </AppContext>
  );
}

async function flushFrame() {
  await act(async () => {
    await testSetup!.renderOnce();
    await testSetup!.renderOnce();
  });
}

afterEach(async () => {
  setSharedRegistryForTests(undefined);
  setSharedDataProviderForTests(undefined);
  apiClient.connectChannel = originalConnectChannel;
  apiClient.setSessionToken(null);

  if (testSetup) {
    await act(async () => {
      testSetup!.renderer.destroy();
    });
    testSetup = undefined;
  }
});

describe("ChatContent", () => {
  test("focuses the prompt on click and preserves typing order", async () => {
    const controller = createController();

    await act(async () => {
      testSetup = await testRender(createHarness(controller), {
        width: 60,
        height: 12,
      });
    });

    await flushFrame();

    const frameBeforeClick = testSetup.captureCharFrame().split("\n");
    const inputRow = frameBeforeClick.findIndex((line) => line.includes("Type a message..."));
    const inputCol = frameBeforeClick[inputRow]?.indexOf("Type a message...") ?? -1;

    expect(inputRow).toBeGreaterThanOrEqual(0);
    expect(inputCol).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(inputCol + 1, inputRow);
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    await act(async () => {
      await testSetup!.mockInput.typeText("DCF");
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const frameAfterType = testSetup.captureCharFrame();
    expect(frameAfterType).toContain("> DCF");
    expect(frameAfterType).not.toContain("> FCD");
  });

  test("renders optimistic sends with a sending status", async () => {
    const controller = createController({
      messages: [{
        id: "local:1",
        channelId: "everyone",
        content: "hello",
        replyToId: null,
        createdAt: "2026-03-28T00:00:00.000Z",
        user: { id: "u0", username: "vince", displayName: "Vince" },
        clientStatus: "sending",
        clientError: null,
      }],
    });

    await act(async () => {
      testSetup = await testRender(createHarness(controller), {
        width: 60,
        height: 12,
      });
    });

    await flushFrame();

    const frameAfterSubmit = testSetup.captureCharFrame();
    expect(frameAfterSubmit).toContain("hello");
    expect(frameAfterSubmit).toContain("sending...");
  });

  test("auto-scrolls to newly appended messages while following the latest transcript", async () => {
    const controller = createController({
      messages: [
        makeMessage(1),
        makeMessage(2),
        makeMessage(3),
        makeMessage(4),
        makeMessage(5),
        makeMessage(6),
      ],
    });

    await act(async () => {
      testSetup = await testRender(createHarness(controller, { width: 60, height: 12 }), {
        width: 60,
        height: 12,
      });
    });

    await flushFrame();

    const frameBeforeUpdate = testSetup.captureCharFrame();
    expect(frameBeforeUpdate).toContain("message 6");
    expect(frameBeforeUpdate).not.toContain("message 1");

    await act(async () => {
      (controller as any).mergeMessages([makeMessage(7)]);
    });

    await flushFrame();

    const frameAfterUpdate = testSetup.captureCharFrame();
    expect(frameAfterUpdate).toContain("7 messages");
    expect(frameAfterUpdate).toContain("message 7");
    expect(frameAfterUpdate).not.toContain("message 1");
  });

  test("renders ticker badges and opens a floating detail pane on click", async () => {
    const controller = createController({
      messages: [{
        id: "m1",
        channelId: "everyone",
        content: "Watching $TSLA today",
        replyToId: null,
        createdAt: "2026-03-28T00:00:00.000Z",
        user: { id: "u1", username: "vince", displayName: "Vince" },
      }],
    });
    const opened: string[] = [];

    setSharedRegistryForTests({
      pinTickerFn(symbol: string) {
        opened.push(symbol);
      },
    } as any);

    await act(async () => {
      testSetup = await testRender(createHarness(controller, {
        width: 60,
        height: 12,
        configureState(state) {
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
        },
      }), {
        width: 60,
        height: 12,
      });
    });

    await flushFrame();

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

  test("shows a saved-login read-only footer when a session token is cached", async () => {
    const controller = createController({
      sessionToken: "token-123",
      user: null,
    });

    await act(async () => {
      testSetup = await testRender(createHarness(controller), {
        width: 60,
        height: 12,
      });
    });

    await flushFrame();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Saved login found.");
    expect(frame).toContain("Log in again to send.");
    expect(frame).toContain("No messages yet.");
    expect(frame).not.toContain("Type a message...");
  });

  test("keeps the transcript visible for logged-out users and blocks the composer", async () => {
    const controller = createController({
      sessionToken: null,
      user: null,
      messages: [makeMessage(1)],
    });

    await act(async () => {
      testSetup = await testRender(createHarness(controller), {
        width: 60,
        height: 12,
      });
    });

    await flushFrame();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("message 1");
    expect(frame).toContain("Read-only chat.");
    expect(frame).toContain("Login");
    expect(frame).toContain("Sign Up");
    expect(frame).not.toContain("Type a message...");
  });

  test("shows a logged-in icon in the cloud status widget for cached sessions", async () => {
    const controller = createController({
      sessionToken: "token-123",
      user: null,
    });
    const state = createInitialState(createDefaultConfig("/tmp/gloomberb-chat"));
    state.config.disabledPlugins = [];

    await act(async () => {
      testSetup = await testRender(
        <AppContext value={{ state, dispatch: () => {} }}>
          <ChatStatusWidget controller={controller} />
        </AppContext>,
        { width: 40, height: 1 },
      );
    });

    await flushFrame();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("@");
    expect(frame).not.toContain("Shift+C");
    expect(frame).not.toContain("vince");
  });

  test("shows clickable login actions instead of the cloud shortcut when logged out", async () => {
    const controller = createController({
      sessionToken: null,
      user: null,
    });
    const openedQueries: string[] = [];
    const state = createInitialState(createDefaultConfig("/tmp/gloomberb-chat"));
    state.config.disabledPlugins = [];

    setSharedRegistryForTests({
      openCommandBarFn(query?: string) {
        openedQueries.push(query ?? "");
      },
    } as any);

    await act(async () => {
      testSetup = await testRender(
        <AppContext value={{ state, dispatch: () => {} }}>
          <ChatStatusWidget controller={controller} />
        </AppContext>,
        { width: 40, height: 1 },
      );
    });

    await flushFrame();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("☁");
    expect(frame).toContain("Login");
    expect(frame).toContain("Sign Up");
    expect(frame).not.toContain("Shift+C");

    const line = frame.split("\n")[0] ?? "";
    const signUpCol = line.indexOf("Sign Up");

    expect(signUpCol).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(signUpCol + 1, 0);
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    expect(openedQueries).toEqual(["Sign Up"]);
  });

  test("shows an unread mention badge and opens chat from the status widget", async () => {
    const controller = createController({
      sessionToken: "token-123",
      user: { id: "u1", username: "vince", emailVerified: true },
    });
    const openedWidgets: string[] = [];
    const state = createInitialState(createDefaultConfig("/tmp/gloomberb-chat"));
    state.config.disabledPlugins = [];

    setSharedRegistryForTests({
      showWidget(paneId: string) {
        openedWidgets.push(paneId);
      },
    } as any);

    await act(async () => {
      (controller as any).mergeMessages([{
        id: "m1",
        channelId: "everyone",
        content: "pinging @vince before the bell",
        replyToId: null,
        createdAt: "2026-03-28T00:00:00.000Z",
        user: { id: "u2", username: "bob", displayName: "Bob" },
      } satisfies ChatMessage]);
    });

    await act(async () => {
      testSetup = await testRender(
        <AppContext value={{ state, dispatch: () => {} }}>
          <ChatStatusWidget controller={controller} />
        </AppContext>,
        { width: 40, height: 1 },
      );
    });

    await flushFrame();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("vince");
    expect(frame).toContain("[1]");

    const line = frame.split("\n")[0] ?? "";
    const badgeCol = line.indexOf("[1]");

    expect(badgeCol).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(badgeCol + 1, 0);
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    expect(openedWidgets).toEqual(["chat"]);
  });

  test("auth commands use a single-form layout and signup no longer prompts for display name", () => {
    const registeredCommands: Array<{ id: string; wizardLayout?: string; wizard?: Array<{ key: string }> }> = [];

    gloomberbCloudPlugin.setup({
      persistence: new MemoryPersistence(),
      resume: {
        getState: () => null,
        setState: () => {},
        deleteState: () => {},
      },
      registerPane: () => {},
      registerShortcut: () => {},
      registerCommand: (command: { id: string; wizardLayout?: string; wizard?: Array<{ key: string }> }) => {
        registeredCommands.push(command);
      },
      showWidget: () => {},
      hideWidget: () => {},
      showToast: () => {},
    } as any);

    const loginCommand = registeredCommands.find((command) => command.id === "auth-login");
    const signupCommand = registeredCommands.find((command) => command.id === "auth-signup");

    expect(loginCommand?.wizardLayout).toBe("form");
    expect(signupCommand?.wizardLayout).toBe("form");
    expect(signupCommand?.wizard?.map((step) => step.key)).toEqual([
      "email",
      "username",
      "password",
      "confirmPassword",
      "_validate",
    ]);
  });
});
