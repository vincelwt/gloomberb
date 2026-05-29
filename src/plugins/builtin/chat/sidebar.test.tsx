import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, type ReactElement, useCallback, useMemo, useRef, useState } from "react";
import { testRender } from "../../../renderers/opentui/test-utils";
import { AppContext, appReducer, createInitialState, PaneInstanceProvider } from "../../../state/app/context";
import { createConfigBackedTestPluginRuntime, createTestPluginRuntime } from "../../../test-support/plugin-runtime";
import { createDefaultConfig, findPaneInstance, type PaneInstanceConfig } from "../../../types/config";
import { TextAttributes } from "../../../ui";
import { PluginRenderProvider } from "../../runtime";
import { gloomberbCloudPlugin } from "../cloud";
import { ChatContent } from "../chat";
import { chatController } from "./controller";
import {
  cleanupChatTest,
  createChatTestControls,
  createController,
  createHarness,
  installChatApiTestDefaults,
  installServerChannels,
  lineText,
  MemoryPersistence,
  type ChatTestSetup,
} from "./test-harness";

let testSetup: ChatTestSetup | undefined;
function setup(): ChatTestSetup {
  if (!testSetup) throw new Error("chat sidebar test setup is missing");
  return testSetup;
}
const { flushFrame, emitKeypress } = createChatTestControls(setup);

beforeEach(() => {
  installChatApiTestDefaults();
});

afterEach(async () => {
  await cleanupChatTest(testSetup);
  testSetup = undefined;
});

function createChannelPane(controller: ReturnType<typeof createController>, initialChannelId = "equities") {
  const state = createInitialState(createDefaultConfig("/tmp/gloomberb-chat"));

  return function ChannelPane() {
    const [channelId, setChannelId] = useState(initialChannelId);
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
  };
}

describe("ChatContent channel sidebar", () => {
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
    expect(setup().captureCharFrame()).toContain("options");

    await act(async () => {
      testSetup?.renderer.destroy();
      testSetup = await testRender(renderChannelPane(60), {
        width: 60,
        height: 12,
      });
    });

    await flushFrame();
    expect(setup().captureCharFrame()).not.toContain("options");
  });

  test("selects a sidebar channel from a single text click", async () => {
    const controller = createController({ sessionToken: "token-123" });
    installServerChannels(controller);
    controller.refreshChannels = async () => {};
    controller.refreshChannelMessages = async () => {};
    const ChannelPane = createChannelPane(controller);

    await act(async () => {
      testSetup = await testRender(<ChannelPane />, {
        width: 90,
        height: 12,
      });
    });

    await flushFrame();
    expect(setup().captureCharFrame()).toContain("#equities");

    const lines = setup().captureCharFrame().split("\n");
    const row = lines.findIndex((line) => line.includes("options"));
    const col = lines[row]?.indexOf("options") ?? -1;

    expect(row).toBeGreaterThanOrEqual(0);
    expect(col).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await setup().mockMouse.click(col + 1, row);
      await setup().renderOnce();
      await setup().renderOnce();
    });
    await flushFrame();

    expect(setup().captureCharFrame()).toContain("#options");
  });

  test("renders unread sidebar channels in bold and clears them when opened", async () => {
    const controller = createController({ sessionToken: "token-123" });
    installServerChannels(controller);
    controller.refreshChannels = async () => {};
    controller.refreshChannelMessages = async () => {};
    const optionsState = (controller as any).ensureChannelState("options");
    optionsState.unreadCount = 2;
    const ChannelPane = createChannelPane(controller);

    await act(async () => {
      testSetup = await testRender(<ChannelPane />, {
        width: 90,
        height: 12,
      });
    });

    await flushFrame();
    const unreadLine = setup().captureSpans().lines.find((line) => lineText(line).includes("options"));
    const unreadSpan = unreadLine?.spans.find((span) => span.text.includes("options"));
    expect((unreadSpan?.attributes ?? 0) & TextAttributes.BOLD).toBe(TextAttributes.BOLD);

    const lines = setup().captureCharFrame().split("\n");
    const row = lines.findIndex((line) => line.includes("options"));
    const col = lines[row]?.indexOf("options") ?? -1;

    await act(async () => {
      await setup().mockMouse.click(col + 1, row);
      await setup().renderOnce();
      await setup().renderOnce();
    });
    await flushFrame();

    const readLine = setup().captureSpans().lines.find((line) => lineText(line).includes("#options"));
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
    const ChannelPane = createChannelPane(controller);

    await act(async () => {
      testSetup = await testRender(<ChannelPane />, {
        width: 90,
        height: 12,
      });
    });

    await flushFrame();
    const frame = setup().captureCharFrame();
    const lines = frame.split("\n");
    const row = lines.findIndex((line) => line.includes("options"));
    const col = lines[row]?.lastIndexOf("·") ?? -1;
    expect(row).toBeGreaterThanOrEqual(0);
    expect(col).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await setup().mockMouse.click(col, row);
      await setup().renderOnce();
      await setup().renderOnce();
    });
    await flushFrame();

    expect(toggles).toEqual([{ channelId: "options", enabled: true }]);
    expect(setup().captureCharFrame()).toContain("#equities");
    expect(setup().captureCharFrame()).not.toContain("#options");
  });

  test("shows the sidebar online count footer", async () => {
    const controller = createController({ sessionToken: "token-123" });
    installServerChannels(controller);
    controller.refreshChannels = async () => {};
    controller.refreshChannelMessages = async () => {};
    (controller as any).channelCatalog.onlineCount = 6;

    await act(async () => {
      testSetup = await testRender(createHarness(controller, { width: 90, height: 12 }), {
        width: 90,
        height: 12,
      });
    });

    await flushFrame();

    expect(setup().captureCharFrame()).toContain("● 6 online");
  });

  test("uses arrows to move between channel sidebar and chat content", async () => {
    const controller = createController({ sessionToken: "token-123" });
    installServerChannels(controller);
    controller.refreshChannels = async () => {};
    controller.refreshChannelMessages = async () => {};
    const ChannelPane = createChannelPane(controller);

    await act(async () => {
      testSetup = await testRender(<ChannelPane />, {
        width: 90,
        height: 12,
      });
    });

    await flushFrame();
    expect(setup().captureCharFrame()).toContain("#equities");
    const getActiveChannelBackgrounds = () => {
      const activeLine = setup().captureSpans().lines.find((line) => lineText(line).includes("#equities"));
      expect(activeLine).toBeDefined();
      return activeLine!.spans.map((span) => span.bg.toInts().join(","));
    };
    const getContentBackgrounds = () => {
      const contentLine = setup().captureSpans().lines.find((line) => lineText(line).includes("No messages yet"));
      expect(contentLine).toBeDefined();
      return contentLine!.spans.map((span) => span.bg.toInts().join(","));
    };
    const contentFocusedBackgrounds = getActiveChannelBackgrounds();
    const rightFocusedBackgrounds = getContentBackgrounds();

    await emitKeypress({ name: "down", sequence: "\u001b[B" });
    expect(setup().captureCharFrame()).toContain("#equities");

    await emitKeypress({ name: "left", sequence: "\u001b[D" });
    await flushFrame();
    expect(getActiveChannelBackgrounds()).not.toEqual(contentFocusedBackgrounds);
    expect(getContentBackgrounds()).not.toEqual(rightFocusedBackgrounds);
    await emitKeypress({ name: "down", sequence: "\u001b[B" });
    await flushFrame();
    expect(setup().captureCharFrame()).toContain("#options");

    await emitKeypress({ name: "up", sequence: "\u001b[A" });
    await flushFrame();
    expect(setup().captureCharFrame()).toContain("#equities");

    await emitKeypress({ name: "right", sequence: "\u001b[C" });
    await flushFrame();
    expect(getActiveChannelBackgrounds()).toEqual(contentFocusedBackgrounds);
    expect(getContentBackgrounds()).toEqual(rightFocusedBackgrounds);
    await emitKeypress({ name: "down", sequence: "\u001b[B" });
    await flushFrame();
    expect(setup().captureCharFrame()).toContain("#equities");
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

    const frame = setup().captureCharFrame();
    expect(frame).toContain("#options");
    expect(frame).toContain("Loading...");
  });

  test("persists a pane channel selection without the last-visited write reverting it", async () => {
    const registeredPanes: Array<{ id: string; component: (props: any) => ReactElement | null }> = [];
    gloomberbCloudPlugin.setup!({
      persistence: new MemoryPersistence(),
      resume: {
        getState: () => null,
        setState: () => {},
        deleteState: () => {},
      },
      registerPane: (pane: { id: string; component: (props: any) => ReactElement | null }) => {
        registeredPanes.push(pane);
      },
      registerPaneTemplate: () => {},
      registerTickerResearchTab: () => {},
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
      const lines = setup().captureCharFrame().split("\n");
      const row = lines.findIndex((line) => line.includes("options"));
      const col = lines[row]?.indexOf("options") ?? -1;

      expect(row).toBeGreaterThanOrEqual(0);
      expect(col).toBeGreaterThanOrEqual(0);

      await act(async () => {
        await setup().mockMouse.click(col + 1, row);
        await setup().renderOnce();
        await setup().renderOnce();
      });
      await flushFrame();

      expect(findPaneInstance(latestState.config.layout, paneInstanceId)?.settings?.channelId).toBe("options");
      expect(findPaneInstance(latestState.config.layout, paneInstanceId)?.title).toBe("#options");
      expect(latestState.config.pluginConfig["gloomberb-cloud"]?.lastChatChannelId).toBe("options");
      expect(setup().captureCharFrame()).toContain("#options");
    } finally {
      chatController.refreshChannels = originalRefreshChannels;
      chatController.refreshSession = originalRefreshSession;
      chatController.refreshChannelMessages = originalRefreshChannelMessages;
      installServerChannels(chatController, []);
      chatController.dispose();
    }
  });
});
