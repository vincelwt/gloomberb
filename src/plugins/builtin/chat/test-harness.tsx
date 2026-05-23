import { act } from "react";
import { PaneFooterBar, PaneFooterProvider } from "../../../components/layout/pane-footer";
import { testRender } from "../../../renderers/opentui/test-utils";
import { AppContext, createInitialState } from "../../../state/app-context";
import { createTestPluginRuntime } from "../../../test-support/plugin-runtime";
import { createDefaultConfig } from "../../../types/config";
import type { PersistedResourceValue } from "../../../types/persistence";
import type { PluginPersistence } from "../../../types/plugin";
import { Box } from "../../../ui";
import { apiClient, type ChatChannel, type ChatMessage } from "../../../utils/api-client";
import { PluginRenderProvider, type PluginRuntimeAccess } from "../../plugin-runtime";
import { setSharedMarketDataForTests, setSharedRegistryForTests } from "../../registry";
import { ChatContent } from "../chat";
import { ChatController } from "./controller";

const TRANSCRIPT_KIND = "channel-transcript";
const TRANSCRIPT_KEY = "everyone";
const TRANSCRIPT_SOURCE = "server";
const TRANSCRIPT_SCHEMA_VERSION = 2;
const originalConnectChannel = apiClient.connectChannel.bind(apiClient);
const originalGetChannels = apiClient.getChannels.bind(apiClient);
const originalGetChatPresence = apiClient.getChatPresence.bind(apiClient);
const originalUpdateChatChannelState = apiClient.updateChatChannelState.bind(apiClient);

export type ChatTestSetup = Awaited<ReturnType<typeof testRender>>;

const TEST_CHAT_CHANNELS: ChatChannel[] = [
  { id: "everyone", name: "everyone", created_at: "2026-03-26T12:10:05.684Z" },
  { id: "equities", name: "equities", created_at: "2026-05-09T00:00:00.000Z" },
  { id: "options", name: "options", created_at: "2026-05-09T00:00:00.000Z" },
  { id: "macro", name: "macro", created_at: "2026-05-09T00:00:00.000Z" },
  { id: "crypto", name: "crypto", created_at: "2026-05-09T00:00:00.000Z" },
  { id: "energy", name: "energy", created_at: "2026-05-09T00:00:00.000Z" },
  { id: "help", name: "help", created_at: "2026-05-09T00:00:00.000Z" },
];

export function installChatApiTestDefaults(): void {
  apiClient.getChatPresence = async () => ({ onlineCount: 0 });
  apiClient.updateChatChannelState = async (channelId, body) => ({
    channelId,
    notificationsEnabled: body.notificationsEnabled ?? false,
    lastReadMessageId: body.readThroughMessageId ?? null,
    unreadCount: 0,
  });
}

export async function cleanupChatTest(testSetup: ChatTestSetup | undefined): Promise<void> {
  setSharedRegistryForTests(undefined);
  setSharedMarketDataForTests(undefined);
  apiClient.connectChannel = originalConnectChannel;
  apiClient.getChannels = originalGetChannels;
  apiClient.getChatPresence = originalGetChatPresence;
  apiClient.updateChatChannelState = originalUpdateChatChannelState;
  apiClient.setSessionToken(null);

  if (testSetup) {
    await act(async () => {
      testSetup.renderer.destroy();
    });
  }
}

export function installServerChannels(controller: ChatController, channels = TEST_CHAT_CHANNELS): void {
  (controller as any).channelCatalog.channels = channels;
}

export class MemoryPersistence implements PluginPersistence {
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

export function makeMessage(index: number): ChatMessage {
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

export function createController(options: {
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

export function createHarness(
  controller: ChatController,
  options?: {
    width?: number;
    height?: number;
    configureState?: (state: ReturnType<typeof createInitialState>) => void;
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

export function createChatTestControls(getSetup: () => ChatTestSetup) {
  return {
    async flushFrame() {
      await act(async () => {
        await getSetup().renderOnce();
        await getSetup().renderOnce();
      });
    },
    async emitKeypress(event: {
      name?: string;
      sequence?: string;
      ctrl?: boolean;
      meta?: boolean;
      shift?: boolean;
      option?: boolean;
    }) {
      await act(async () => {
        getSetup().renderer.keyInput.emit("keypress", {
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
        await getSetup().renderOnce();
      });
    },
  };
}

export function lineText(line: { spans: Array<{ text: string }> }) {
  return line.spans.map((span) => span.text).join("");
}

export function hexToRgbaInts(hex: string) {
  const normalized = hex.replace("#", "");
  return [
    parseInt(normalized.slice(0, 2), 16),
    parseInt(normalized.slice(2, 4), 16),
    parseInt(normalized.slice(4, 6), 16),
    255,
  ].join(",");
}
