import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, useCallback, useMemo, useRef, useState } from "react";
import { PaneFooterBar, PaneFooterProvider } from "../../components/layout/pane-footer";
import { testRender } from "../../renderers/opentui/test-utils";
import { AppContext, appReducer, createInitialState, PaneInstanceProvider } from "../../state/app-context";
import { createConfigBackedTestPluginRuntime, createTestPluginRuntime } from "../../test-support/plugin-runtime";
import { colors } from "../../theme/colors";
import { createDefaultConfig, findPaneInstance, type PaneInstanceConfig } from "../../types/config";
import type { PersistedResourceValue } from "../../types/persistence";
import type { PluginPersistence } from "../../types/plugin";
import { Box, TextAttributes } from "../../ui";
import { apiClient, type ChatChannel, type ChatMessage } from "../../utils/api-client";
import { PluginRenderProvider, type PluginRuntimeAccess } from "../plugin-runtime";
import { setSharedMarketDataForTests, setSharedRegistryForTests } from "../registry";
import { ChatContent, ChatStatusWidget, gloomberbCloudPlugin } from "./chat";
import { chatController, ChatController } from "./chat-controller";

const TRANSCRIPT_KIND = "channel-transcript";
const TRANSCRIPT_KEY = "everyone";
const TRANSCRIPT_SOURCE = "server";
const TRANSCRIPT_SCHEMA_VERSION = 2;
const originalConnectChannel = apiClient.connectChannel.bind(apiClient);
const originalGetChannels = apiClient.getChannels.bind(apiClient);
const originalGetChatPresence = apiClient.getChatPresence.bind(apiClient);
const originalUpdateChatChannelState = apiClient.updateChatChannelState.bind(apiClient);

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

const TEST_CHAT_CHANNELS: ChatChannel[] = [
  { id: "everyone", name: "everyone", created_at: "2026-03-26T12:10:05.684Z" },
  { id: "equities", name: "equities", created_at: "2026-05-09T00:00:00.000Z" },
  { id: "options", name: "options", created_at: "2026-05-09T00:00:00.000Z" },
  { id: "macro", name: "macro", created_at: "2026-05-09T00:00:00.000Z" },
  { id: "crypto", name: "crypto", created_at: "2026-05-09T00:00:00.000Z" },
  { id: "energy", name: "energy", created_at: "2026-05-09T00:00:00.000Z" },
  { id: "help", name: "help", created_at: "2026-05-09T00:00:00.000Z" },
];

function installServerChannels(controller: ChatController, channels = TEST_CHAT_CHANNELS): void {
  (controller as any).channels = channels;
}

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
  replyToId?: string | null;
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
    replyToId: options.replyToId ?? null,
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
  controller.refreshPresence = async () => {};
  controller.refreshChatState = async () => {};
  return controller;
}

function createHarness(
  controller: ChatController,
  options?: {
    width?: number;
    height?: number;
    configureState?: (state: ReturnType<typeof createInitialState>) => void;
    close?: () => void;
    withFooter?: boolean;
    runtime?: PluginRuntimeAccess;
  },
) {
  const width = options?.width ?? 60;
  const height = options?.height ?? 12;
  const state = createInitialState(createDefaultConfig("/tmp/gloomberb-chat"));
  options?.configureState?.(state);

  const content = options?.withFooter ? (
    <PaneFooterProvider>
      {(footer) => (
        <Box flexDirection="column" width={width} height={height}>
          <ChatContent
            controller={controller}
            width={width}
            height={Math.max(1, height - 1)}
            focused
            close={options?.close}
          />
          <PaneFooterBar footer={footer} focused width={width} />
        </Box>
      )}
    </PaneFooterProvider>
  ) : (
    <ChatContent
      controller={controller}
      width={width}
      height={height}
      focused
      close={options?.close}
    />
  );

  return (
    <AppContext value={{ state, dispatch: () => {} }}>
      <PluginRenderProvider pluginId="gloomberb-cloud" runtime={options?.runtime ?? createTestPluginRuntime()}>
        {content}
      </PluginRenderProvider>
    </AppContext>
  );
}

async function flushFrame() {
  await act(async () => {
    await testSetup!.renderOnce();
    await testSetup!.renderOnce();
  });
}

async function emitKeypress(event: {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  option?: boolean;
}) {
  await act(async () => {
    testSetup!.renderer.keyInput.emit("keypress", {
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
    await testSetup!.renderOnce();
  });
}

function lineText(line: { spans: Array<{ text: string }> }) {
  return line.spans.map((span) => span.text).join("");
}

function hexToRgbaInts(hex: string) {
  const normalized = hex.replace("#", "");
  return [
    parseInt(normalized.slice(0, 2), 16),
    parseInt(normalized.slice(2, 4), 16),
    parseInt(normalized.slice(4, 6), 16),
    255,
  ].join(",");
}

beforeEach(() => {
  apiClient.getChatPresence = async () => ({ onlineCount: 0 });
  apiClient.updateChatChannelState = async (channelId, body) => ({
    channelId,
    notificationsEnabled: body.notificationsEnabled ?? false,
    lastReadMessageId: body.readThroughMessageId ?? null,
    unreadCount: 0,
  });
});

afterEach(async () => {
  setSharedRegistryForTests(undefined);
  setSharedMarketDataForTests(undefined);
  apiClient.connectChannel = originalConnectChannel;
  apiClient.getChannels = originalGetChannels;
  apiClient.getChatPresence = originalGetChatPresence;
  apiClient.updateChatChannelState = originalUpdateChatChannelState;
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

  test("keeps appending typed text while transcript updates arrive", async () => {
    const controller = createController({
      messages: [makeMessage(1)],
    });

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
      await testSetup!.mockInput.typeText("alpha");
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    await act(async () => {
      (controller as any).mergeMessages([makeMessage(2)]);
    });

    await flushFrame();

    await act(async () => {
      await testSetup!.mockInput.typeText("beta");
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const frameAfterType = testSetup.captureCharFrame();
    expect(frameAfterType).toContain("> alphabeta");
    expect(frameAfterType).not.toContain("> betaalpha");
  });

  test("shows the channel sidebar on wide panes and hides it on narrow panes", async () => {
    const controller = createController({ sessionToken: "token-123" });
    installServerChannels(controller);
    controller.refreshChannels = async () => {};
    controller.refreshChannelMessages = async () => {};

    const state = createInitialState(createDefaultConfig("/tmp/gloomberb-chat"));
    const renderChannelPane = (width: number) => (
      <AppContext value={{ state, dispatch: () => {} }}>
        <PluginRenderProvider pluginId="gloomberb-cloud" runtime={createTestPluginRuntime()}>
          <ChatContent
            controller={controller}
            width={width}
            height={12}
            focused
            channelId="options"
            onChannelChange={() => {}}
          />
        </PluginRenderProvider>
      </AppContext>
    );

    await act(async () => {
      testSetup = await testRender(renderChannelPane(90), {
        width: 90,
        height: 12,
      });
    });

    await flushFrame();
    expect(testSetup.captureCharFrame()).toContain("options");

    await act(async () => {
      testSetup?.renderer.destroy();
      testSetup = await testRender(renderChannelPane(60), {
        width: 60,
        height: 12,
      });
    });

    await flushFrame();
    expect(testSetup.captureCharFrame()).not.toContain("options");
  });

  test("selects a sidebar channel from a single text click", async () => {
    const controller = createController({ sessionToken: "token-123" });
    installServerChannels(controller);
    controller.refreshChannels = async () => {};
    controller.refreshChannelMessages = async () => {};
    const state = createInitialState(createDefaultConfig("/tmp/gloomberb-chat"));

    function ChannelPane() {
      const [channelId, setChannelId] = useState("equities");
      return (
        <AppContext value={{ state, dispatch: () => {} }}>
          <PluginRenderProvider pluginId="gloomberb-cloud" runtime={createTestPluginRuntime()}>
            <ChatContent
              controller={controller}
              width={90}
              height={12}
              focused
              channelId={channelId}
              onChannelChange={setChannelId}
            />
          </PluginRenderProvider>
        </AppContext>
      );
    }

    await act(async () => {
      testSetup = await testRender(<ChannelPane />, {
        width: 90,
        height: 12,
      });
    });

    await flushFrame();
    expect(testSetup.captureCharFrame()).toContain("#equities");

    const lines = testSetup.captureCharFrame().split("\n");
    const row = lines.findIndex((line) => line.includes("options"));
    const col = lines[row]?.indexOf("options") ?? -1;

    expect(row).toBeGreaterThanOrEqual(0);
    expect(col).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(col + 1, row);
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });
    await flushFrame();

    expect(testSetup.captureCharFrame()).toContain("#options");
  });

  test("renders unread sidebar channels in bold and clears them when opened", async () => {
    const controller = createController({ sessionToken: "token-123" });
    installServerChannels(controller);
    controller.refreshChannels = async () => {};
    controller.refreshChannelMessages = async () => {};
    const optionsState = (controller as any).ensureChannelState("options");
    optionsState.unreadCount = 2;
    const state = createInitialState(createDefaultConfig("/tmp/gloomberb-chat"));

    function ChannelPane() {
      const [channelId, setChannelId] = useState("equities");
      return (
        <AppContext value={{ state, dispatch: () => {} }}>
          <PluginRenderProvider pluginId="gloomberb-cloud" runtime={createTestPluginRuntime()}>
            <ChatContent
              controller={controller}
              width={90}
              height={12}
              focused
              channelId={channelId}
              onChannelChange={setChannelId}
            />
          </PluginRenderProvider>
        </AppContext>
      );
    }

    await act(async () => {
      testSetup = await testRender(<ChannelPane />, {
        width: 90,
        height: 12,
      });
    });

    await flushFrame();
    const unreadLine = testSetup.captureSpans().lines.find((line) => lineText(line).includes("options"));
    const unreadSpan = unreadLine?.spans.find((span) => span.text.includes("options"));
    expect((unreadSpan?.attributes ?? 0) & TextAttributes.BOLD).toBe(TextAttributes.BOLD);

    const lines = testSetup.captureCharFrame().split("\n");
    const row = lines.findIndex((line) => line.includes("options"));
    const col = lines[row]?.indexOf("options") ?? -1;

    await act(async () => {
      await testSetup!.mockMouse.click(col + 1, row);
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });
    await flushFrame();

    const readLine = testSetup.captureSpans().lines.find((line) => lineText(line).includes("#options"));
    const readSpan = readLine?.spans.find((span) => span.text.includes("options"));
    expect((readSpan?.attributes ?? 0) & TextAttributes.BOLD).toBe(0);
  });

  test("toggles sidebar channel notifications without selecting the channel", async () => {
    const controller = createController({ sessionToken: "token-123" });
    installServerChannels(controller);
    controller.refreshChannels = async () => {};
    controller.refreshChannelMessages = async () => {};
    const toggles: Array<{ channelId: string; enabled: boolean }> = [];
    controller.setChannelNotificationsEnabled = (channelId: string, enabled: boolean) => {
      toggles.push({ channelId, enabled });
    };
    const state = createInitialState(createDefaultConfig("/tmp/gloomberb-chat"));

    function ChannelPane() {
      const [channelId, setChannelId] = useState("equities");
      return (
        <AppContext value={{ state, dispatch: () => {} }}>
          <PluginRenderProvider pluginId="gloomberb-cloud" runtime={createTestPluginRuntime()}>
            <ChatContent
              controller={controller}
              width={90}
              height={12}
              focused
              channelId={channelId}
              onChannelChange={setChannelId}
            />
          </PluginRenderProvider>
        </AppContext>
      );
    }

    await act(async () => {
      testSetup = await testRender(<ChannelPane />, {
        width: 90,
        height: 12,
      });
    });

    await flushFrame();
    const frame = testSetup.captureCharFrame();
    const lines = frame.split("\n");
    const row = lines.findIndex((line) => line.includes("options"));
    const col = lines[row]?.lastIndexOf("·") ?? -1;
    expect(row).toBeGreaterThanOrEqual(0);
    expect(col).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(col, row);
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });
    await flushFrame();

    expect(toggles).toEqual([{ channelId: "options", enabled: true }]);
    expect(testSetup.captureCharFrame()).toContain("#equities");
    expect(testSetup.captureCharFrame()).not.toContain("#options");
  });

  test("shows the sidebar online count footer", async () => {
    const controller = createController({ sessionToken: "token-123" });
    installServerChannels(controller);
    controller.refreshChannels = async () => {};
    controller.refreshChannelMessages = async () => {};
    (controller as any).onlineCount = 6;

    await act(async () => {
      testSetup = await testRender(createHarness(controller, { width: 90, height: 12 }), {
        width: 90,
        height: 12,
      });
    });

    await flushFrame();

    expect(testSetup.captureCharFrame()).toContain("● 6 online");
  });

  test("uses arrows to move between channel sidebar and chat content", async () => {
    const controller = createController({ sessionToken: "token-123" });
    installServerChannels(controller);
    controller.refreshChannels = async () => {};
    controller.refreshChannelMessages = async () => {};
    const state = createInitialState(createDefaultConfig("/tmp/gloomberb-chat"));

    function ChannelPane() {
      const [channelId, setChannelId] = useState("equities");
      return (
        <AppContext value={{ state, dispatch: () => {} }}>
          <PluginRenderProvider pluginId="gloomberb-cloud" runtime={createTestPluginRuntime()}>
            <ChatContent
              controller={controller}
              width={90}
              height={12}
              focused
              channelId={channelId}
              onChannelChange={setChannelId}
            />
          </PluginRenderProvider>
        </AppContext>
      );
    }

    await act(async () => {
      testSetup = await testRender(<ChannelPane />, {
        width: 90,
        height: 12,
      });
    });

    await flushFrame();
    expect(testSetup.captureCharFrame()).toContain("#equities");
    const getActiveChannelBackgrounds = () => {
      const activeLine = testSetup!.captureSpans().lines.find((line) => lineText(line).includes("#equities"));
      expect(activeLine).toBeDefined();
      return activeLine!.spans.map((span) => span.bg.toInts().join(","));
    };
    const getContentBackgrounds = () => {
      const contentLine = testSetup!.captureSpans().lines.find((line) => lineText(line).includes("No messages yet"));
      expect(contentLine).toBeDefined();
      return contentLine!.spans.map((span) => span.bg.toInts().join(","));
    };
    const contentFocusedBackgrounds = getActiveChannelBackgrounds();
    const rightFocusedBackgrounds = getContentBackgrounds();

    await emitKeypress({ name: "down", sequence: "\u001b[B" });
    expect(testSetup.captureCharFrame()).toContain("#equities");

    await emitKeypress({ name: "left", sequence: "\u001b[D" });
    await flushFrame();
    expect(getActiveChannelBackgrounds()).not.toEqual(contentFocusedBackgrounds);
    expect(getContentBackgrounds()).not.toEqual(rightFocusedBackgrounds);
    await emitKeypress({ name: "down", sequence: "\u001b[B" });
    await flushFrame();
    expect(testSetup.captureCharFrame()).toContain("#options");

    await emitKeypress({ name: "up", sequence: "\u001b[A" });
    await flushFrame();
    expect(testSetup.captureCharFrame()).toContain("#equities");

    await emitKeypress({ name: "right", sequence: "\u001b[C" });
    await flushFrame();
    expect(getActiveChannelBackgrounds()).toEqual(contentFocusedBackgrounds);
    expect(getContentBackgrounds()).toEqual(rightFocusedBackgrounds);
    await emitKeypress({ name: "down", sequence: "\u001b[B" });
    await flushFrame();
    expect(testSetup.captureCharFrame()).toContain("#equities");
  });

  test("keeps the channel sidebar visible while a channel loads", async () => {
    const controller = createController({ sessionToken: "token-123" });
    installServerChannels(controller);
    const getSnapshot = controller.getSnapshot.bind(controller);
    controller.getSnapshot = ((channelId?: string) => ({
      ...getSnapshot(channelId),
      loading: true,
      messages: [],
    })) as typeof controller.getSnapshot;
    controller.refreshChannels = async () => {};
    controller.refreshChannelMessages = async () => {};

    const state = createInitialState(createDefaultConfig("/tmp/gloomberb-chat"));

    await act(async () => {
      testSetup = await testRender(
        <AppContext value={{ state, dispatch: () => {} }}>
          <PluginRenderProvider pluginId="gloomberb-cloud" runtime={createTestPluginRuntime()}>
            <ChatContent
              controller={controller}
              width={90}
              height={12}
              focused
              channelId="options"
              onChannelChange={() => {}}
            />
          </PluginRenderProvider>
        </AppContext>,
        {
          width: 90,
          height: 12,
        },
      );
    });

    await flushFrame();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("#options");
    expect(frame).toContain("Loading...");
  });

  test("persists a pane channel selection without the last-visited write reverting it", async () => {
    const registeredPanes: Array<{ id: string; component: (props: any) => JSX.Element }> = [];
    gloomberbCloudPlugin.setup({
      persistence: new MemoryPersistence(),
      resume: {
        getState: () => null,
        setState: () => {},
        deleteState: () => {},
      },
      registerPane: (pane: { id: string; component: (props: any) => JSX.Element }) => {
        registeredPanes.push(pane);
      },
      registerPaneTemplate: () => {},
      registerDetailTab: () => {},
      registerShortcut: () => {},
      registerCommand: () => {},
      showPane: () => {},
      hidePane: () => {},
      notify: () => {},
    } as any);
    const ChatPaneComponent = registeredPanes.find((pane) => pane.id === "chat")?.component;
    expect(ChatPaneComponent).toBeDefined();
    const ResolvedChatPaneComponent = ChatPaneComponent!;

    const originalRefreshChannels = chatController.refreshChannels;
    const originalRefreshSession = chatController.refreshSession;
    const originalRefreshChannelMessages = chatController.refreshChannelMessages;
    installServerChannels(chatController);
    chatController.refreshChannels = async () => {};
    chatController.refreshSession = async () => {};
    chatController.refreshChannelMessages = async () => {};

    const paneInstanceId = "chat:test";
    const chatInstance: PaneInstanceConfig = {
      instanceId: paneInstanceId,
      paneId: "chat",
      settings: { channelId: "equities" },
    };
    const layout = {
      dockRoot: { kind: "pane" as const, instanceId: paneInstanceId },
      floating: [],
      detached: [],
      instances: [chatInstance],
    };
    const initialState = createInitialState(createDefaultConfig("/tmp/gloomberb-chat"));
    initialState.focusedPaneId = paneInstanceId;
    initialState.config = {
      ...initialState.config,
      layout,
      layouts: [{ name: "Test", layout }],
      pluginConfig: {
        "gloomberb-cloud": {
          lastChatChannelId: "equities",
        },
      },
    };
    let latestState = initialState;

    function ChatPaneHarness() {
      const [state, setState] = useState(initialState);
      const stateRef = useRef(state);
      stateRef.current = state;
      latestState = state;
      const dispatch = useCallback((action: any) => {
        setState((current) => {
          const next = appReducer(current, action);
          latestState = next;
          return next;
        });
      }, []);
      const runtime = useMemo(() => createConfigBackedTestPluginRuntime({
        getConfig: () => stateRef.current.config,
        setConfig: (config) => dispatch({ type: "SET_CONFIG", config }),
      }), [dispatch]);

      return (
        <AppContext value={{ state, dispatch }}>
          <PaneInstanceProvider paneId={paneInstanceId}>
            <PluginRenderProvider pluginId="gloomberb-cloud" runtime={runtime}>
              <ResolvedChatPaneComponent
                width={90}
                height={12}
                focused
                close={() => {}}
              />
            </PluginRenderProvider>
          </PaneInstanceProvider>
        </AppContext>
      );
    }

    try {
      await act(async () => {
        testSetup = await testRender(<ChatPaneHarness />, {
          width: 90,
          height: 12,
        });
      });

      await flushFrame();
      const lines = testSetup.captureCharFrame().split("\n");
      const row = lines.findIndex((line) => line.includes("options"));
      const col = lines[row]?.indexOf("options") ?? -1;

      expect(row).toBeGreaterThanOrEqual(0);
      expect(col).toBeGreaterThanOrEqual(0);

      await act(async () => {
        await testSetup!.mockMouse.click(col + 1, row);
        await testSetup!.renderOnce();
        await testSetup!.renderOnce();
      });
      await flushFrame();

      expect(findPaneInstance(latestState.config.layout, paneInstanceId)?.settings?.channelId).toBe("options");
      expect(latestState.config.pluginConfig["gloomberb-cloud"]?.lastChatChannelId).toBe("options");
      expect(testSetup.captureCharFrame()).toContain("#options");
    } finally {
      chatController.refreshChannels = originalRefreshChannels;
      chatController.refreshSession = originalRefreshSession;
      chatController.refreshChannelMessages = originalRefreshChannelMessages;
      installServerChannels(chatController, []);
      chatController.dispose();
    }
  });

  test("up arrow selects the newest message first when nothing is selected", async () => {
    const controller = createController({
      messages: [makeMessage(1), makeMessage(2)],
    });

    await act(async () => {
      testSetup = await testRender(createHarness(controller, {
        width: 72,
        height: 12,
      }), {
        width: 72,
        height: 12,
      });
    });

    await flushFrame();

    await emitKeypress({ name: "up", sequence: "\u001b[A" });
    await emitKeypress({ name: "return", sequence: "\r" });
    await flushFrame();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("replying to @user2");
    expect(frame).toContain("Reply to @user2...");
  });

  test("shows the reply action next to the selected message timestamp", async () => {
    const controller = createController({
      messages: [makeMessage(1), makeMessage(2)],
    });

    await act(async () => {
      testSetup = await testRender(createHarness(controller, {
        width: 72,
        height: 12,
      }), {
        width: 72,
        height: 12,
      });
    });

    await flushFrame();

    await emitKeypress({ name: "up", sequence: "\u001b[A" });
    await flushFrame();

    const lines = testSetup.captureCharFrame().split("\n");
    const headerLine = lines.find((line) => line.includes("user2"));
    const bodyLine = lines.find((line) => line.includes("message 2"));

    expect(headerLine).toContain("Reply");
    expect(bodyLine).not.toContain("Reply");
  });

  test("down arrow from the newest selected message returns focus to the composer", async () => {
    const controller = createController({
      messages: [makeMessage(1), makeMessage(2)],
    });

    await act(async () => {
      testSetup = await testRender(createHarness(controller, {
        width: 72,
        height: 12,
      }), {
        width: 72,
        height: 12,
      });
    });

    await flushFrame();

    await emitKeypress({ name: "up", sequence: "\u001b[A" });
    await flushFrame();
    await emitKeypress({ name: "down", sequence: "\u001b[B" });
    await flushFrame();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Type a message...");
    expect(frame).not.toContain("Reply to @user2...");
    expect(frame).not.toContain("replying to @user2");
  });

  test("up arrow leaves the composer and selects the latest message when the caret is already at the top", async () => {
    const controller = createController({
      messages: [makeMessage(1)],
    });

    await act(async () => {
      testSetup = await testRender(createHarness(controller, {
        width: 72,
        height: 12,
      }), {
        width: 72,
        height: 12,
      });
    });

    await flushFrame();

    const lines = testSetup.captureCharFrame().split("\n");
    const inputRow = lines.findIndex((line) => line.includes("Type a message..."));
    const inputCol = lines[inputRow]?.indexOf("Type a message...") ?? -1;

    expect(inputRow).toBeGreaterThanOrEqual(0);
    expect(inputCol).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(inputCol + 1, inputRow);
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    await act(async () => {
      testSetup!.mockInput.pressArrow("up");
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });
    await emitKeypress({ name: "return", sequence: "\r" });
    await flushFrame();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("replying to @user1");
    expect(frame).toContain("Reply to @user1...");
  });

  test("up arrow targets the newest bottom message when multiple messages share a timestamp", async () => {
    const controller = createController({
      messages: [
        {
          id: "z-older",
          channelId: "everyone",
          content: "older same timestamp",
          replyToId: null,
          createdAt: "2026-03-30T00:00:01.000Z",
          user: { id: "u1", username: "older", displayName: "Older" },
        },
        {
          id: "a-newer",
          channelId: "everyone",
          content: "newer same timestamp",
          replyToId: null,
          createdAt: "2026-03-30T00:00:01.000Z",
          user: { id: "u2", username: "newer", displayName: "Newer" },
        },
      ],
    });

    await act(async () => {
      testSetup = await testRender(createHarness(controller, {
        width: 72,
        height: 12,
      }), {
        width: 72,
        height: 12,
      });
    });

    await flushFrame();

    const lines = testSetup.captureCharFrame().split("\n");
    const inputRow = lines.findIndex((line) => line.includes("Type a message..."));
    const inputCol = lines[inputRow]?.indexOf("Type a message...") ?? -1;

    expect(inputRow).toBeGreaterThanOrEqual(0);
    expect(inputCol).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(inputCol + 1, inputRow);
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    await act(async () => {
      testSetup!.mockInput.pressArrow("up");
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });
    await emitKeypress({ name: "return", sequence: "\r" });
    await flushFrame();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("replying to @newer");
    expect(frame).toContain("Reply to @newer...");
  });

  test("shows a clear reply composer state when a reply target is active", async () => {
    const controller = createController({
      messages: [makeMessage(1)],
      replyToId: "m1",
    });

    await act(async () => {
      testSetup = await testRender(createHarness(controller, {
        width: 72,
        height: 12,
      }), {
        width: 72,
        height: 12,
      });
    });

    await flushFrame();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("replying to @user1");
    expect(frame).toContain("Cancel");
    expect(frame).toContain("Reply to @user1...");
  });

  test("uses selected text colors for selected message rows", async () => {
    const controller = createController({
      messages: [makeMessage(1), makeMessage(2)],
    });

    await act(async () => {
      testSetup = await testRender(createHarness(controller, {
        width: 72,
        height: 12,
      }), {
        width: 72,
        height: 12,
      });
    });

    await flushFrame();

    await emitKeypress({ name: "up", sequence: "\u001b[A" });
    await flushFrame();

    const expectedSelectedFg = hexToRgbaInts(colors.selectedText);
    const frame = testSetup.captureSpans();
    const headerLine = frame.lines.find((line) => lineText(line).includes("user2"));
    const bodyLine = frame.lines.find((line) => lineText(line).includes("message 2"));
    const headerSpan = headerLine?.spans.find((span) => span.text.includes("user2"));
    const bodySpan = bodyLine?.spans.find((span) => span.text.includes("message 2"));

    expect(headerSpan).toBeDefined();
    expect(bodySpan).toBeDefined();
    expect(headerSpan!.fg.toInts().join(",")).toBe(expectedSelectedFg);
    expect(bodySpan!.fg.toInts().join(",")).toBe(expectedSelectedFg);
  });

  test("grows the composer for multi-line drafts", async () => {
    const controller = createController();

    await act(async () => {
      testSetup = await testRender(createHarness(controller, {
        width: 32,
        height: 12,
      }), {
        width: 32,
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
      await testSetup!.mockInput.typeText("alpha bravo");
      await testSetup!.renderOnce();
    });

    await emitKeypress({ name: "return", sequence: "\r", shift: true });

    await act(async () => {
      await testSetup!.mockInput.typeText("charlie delta");
      await testSetup!.renderOnce();
    });

    await emitKeypress({ name: "return", sequence: "\r", shift: true });

    await act(async () => {
      await testSetup!.mockInput.typeText("echo foxtrot");
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const rows = testSetup.captureCharFrame().split("\n");
    const firstRow = rows.findIndex((line) => line.includes("alpha bravo"));
    const secondRow = rows.findIndex((line) => line.includes("charlie delta"));
    const thirdRow = rows.findIndex((line) => line.includes("echo foxtrot"));

    expect(firstRow).toBeGreaterThanOrEqual(0);
    expect(secondRow).toBeGreaterThan(firstRow);
    expect(thirdRow).toBeGreaterThan(secondRow);
  });

  test("keeps Enter as send and uses Shift+Enter for composer newlines", async () => {
    const controller = createController({ sessionToken: "token-123" });
    const sentMessages: string[] = [];
    apiClient.connectChannel = (() => ({
      send: async (content: string) => {
        sentMessages.push(content);
        return {
          id: `server:${sentMessages.length}`,
          channelId: "everyone",
          content,
          replyToId: null,
          createdAt: "2026-03-30T00:00:30.000Z",
          user: { id: "u0", username: "vince", displayName: "Vince" },
        };
      },
      close: () => {},
    })) as typeof apiClient.connectChannel;

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
      await testSetup!.mockInput.typeText("first line");
      await testSetup!.renderOnce();
    });

    await emitKeypress({ name: "return", sequence: "\r", shift: true });

    await act(async () => {
      await testSetup!.mockInput.typeText("second line");
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const frameAfterNewline = testSetup.captureCharFrame();
    expect(frameAfterNewline).toContain("first line");
    expect(frameAfterNewline).toContain("second line");
    expect(sentMessages).toEqual([]);

    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    expect(sentMessages).toEqual(["first line\nsecond line"]);
  });

  test("clears the composer locally after an accepted send", async () => {
    const controller = createController({ sessionToken: "token-123" });
    const sentMessages: string[] = [];
    (controller as any).send = (content: string) => {
      sentMessages.push(content);
      return true;
    };
    (controller as any).setDraft = () => {};

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
      await testSetup!.mockInput.typeText("hello");
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    expect(sentMessages).toEqual(["hello"]);
    expect(testSetup.captureCharFrame()).not.toContain("> hello");

    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    expect(sentMessages).toEqual(["hello"]);
  });

  test("keeps typed shortcut letters in the composer instead of moving message selection", async () => {
    const controller = createController({
      messages: Array.from({ length: 18 }, (_, index) => makeMessage(index + 1)),
    });

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
      await testSetup!.mockInput.typeText("g");
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const frameAfterType = testSetup.captureCharFrame();
    expect(frameAfterType).toContain("> g");
    expect(frameAfterType).not.toContain("user1 3/30/26");
    expect(frameAfterType).not.toContain("message 1 ");
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
      testSetup = await testRender(createHarness(controller, { width: 60, height: 13, withFooter: true }), {
        width: 60,
        height: 13,
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
    expect(frameAfterUpdate).not.toContain("7 messages");
    expect(frameAfterUpdate).toContain("message 7");
    expect(frameAfterUpdate).not.toContain("message 1");
  });

  test("loads older messages at the top without jumping away from the current transcript", async () => {
    const controller = createController({
      messages: [
        makeMessage(4),
        makeMessage(5),
        makeMessage(6),
        makeMessage(7),
        makeMessage(8),
        makeMessage(9),
        makeMessage(10),
      ],
    });
    let loadCount = 0;
    controller.loadOlderMessages = async () => {
      loadCount += 1;
      (controller as any).mergeMessages([
        makeMessage(1),
        makeMessage(2),
        makeMessage(3),
      ], { notifyMentions: false });
    };

    await act(async () => {
      testSetup = await testRender(createHarness(controller, { width: 60, height: 13 }), {
        width: 60,
        height: 13,
      });
    });

    await flushFrame();
    expect(testSetup.captureCharFrame()).toContain("message 10");

    await emitKeypress({ name: "g", sequence: "g" });
    await flushFrame();

    expect(loadCount).toBe(1);
    expect(controller.getSnapshot().messages.map((message) => message.id)).toEqual([
      "m1",
      "m2",
      "m3",
      "m4",
      "m5",
      "m6",
      "m7",
      "m8",
      "m9",
      "m10",
    ]);
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("message 4");
    expect(frame).not.toContain("message 1");
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
      pinTicker(symbol: string) {
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

  test("renders detected links in chat messages", async () => {
    const controller = createController({
      messages: [{
        id: "m1",
        channelId: "everyone",
        content: "Read https://example.com/story.",
        replyToId: null,
        createdAt: "2026-03-28T00:00:00.000Z",
        user: { id: "u1", username: "vince", displayName: "Vince" },
      }],
    });

    await act(async () => {
      testSetup = await testRender(createHarness(controller, {
        width: 60,
        height: 12,
      }), {
        width: 60,
        height: 12,
      });
    });

    await flushFrame();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("https://example.com/story.");
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
    expect(frame).toContain("Log In");
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
          <PluginRenderProvider pluginId="gloomberb-cloud" runtime={createTestPluginRuntime()}>
            <ChatStatusWidget controller={controller} />
          </PluginRenderProvider>
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

    const runtime = createTestPluginRuntime({
      openCommandBar(query?: string) {
        openedQueries.push(query ?? "");
      },
    });

    await act(async () => {
      testSetup = await testRender(
        <AppContext value={{ state, dispatch: () => {} }}>
          <PluginRenderProvider pluginId="gloomberb-cloud" runtime={runtime}>
            <ChatStatusWidget controller={controller} />
          </PluginRenderProvider>
        </AppContext>,
        { width: 40, height: 1 },
      );
    });

    await flushFrame();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("☁");
    expect(frame).toContain("Log In");
    expect(frame).not.toContain("Sign Up");
    expect(frame).not.toContain("Shift+C");

    const line = frame.split("\n")[0] ?? "";
    const loginCol = line.indexOf("Log In");

    expect(loginCol).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(loginCol + 1, 0);
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    expect(openedQueries).toEqual(["Log In"]);
  });

  test("shows an unread mention badge and opens chat from the status widget", async () => {
    const controller = createController({
      sessionToken: "token-123",
      user: { id: "u1", username: "vince", emailVerified: true },
    });
    const openedPanes: string[] = [];
    const state = createInitialState(createDefaultConfig("/tmp/gloomberb-chat"));
    state.config.disabledPlugins = [];

    const runtime = createTestPluginRuntime({
      showPane(paneId: string) {
        openedPanes.push(paneId);
      },
    });

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
          <PluginRenderProvider pluginId="gloomberb-cloud" runtime={runtime}>
            <ChatStatusWidget controller={controller} />
          </PluginRenderProvider>
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

    expect(openedPanes).toEqual(["chat"]);
  });

});
