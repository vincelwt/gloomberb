import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { AppContext, createInitialState } from "../../state/app-context";
import { createDefaultConfig } from "../../types/config";
import type { PluginPersistence } from "../../types/plugin";
import type { PersistedResourceValue } from "../../types/persistence";
import type { ChatMessage } from "../../utils/api-client";
import { ChatContent } from "./chat";
import { ChatController } from "./chat-controller";

const TRANSCRIPT_KIND = "channel-transcript";
const TRANSCRIPT_KEY = "everyone";
const TRANSCRIPT_SOURCE = "server";

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

function createController(messages: ChatMessage[] = []) {
  const persistence = new MemoryPersistence();
  const controller = new ChatController();
  persistence.setState("session", {
    sessionToken: null,
    user: { id: "u0", username: "vince", emailVerified: true },
  }, { schemaVersion: 1 });
  persistence.setState("channel:everyone", {
    draft: "",
    replyToId: null,
    lastCursor: messages[messages.length - 1]?.createdAt ?? null,
  }, { schemaVersion: 1 });
  if (messages.length > 0) {
    persistence.setResource(TRANSCRIPT_KIND, TRANSCRIPT_KEY, { messages }, {
      sourceKey: TRANSCRIPT_SOURCE,
      schemaVersion: 1,
      cachePolicy: { staleMs: 1_000, expireMs: 2_000 },
    });
  }
  controller.attachPersistence(persistence);
  controller.refreshSession = async () => {};
  return controller;
}

function createHarness(controller: ChatController, width = 60, height = 12) {
  const state = createInitialState(createDefaultConfig("/tmp/gloomberb-chat"));
  return (
    <AppContext value={{ state, dispatch: () => {} }}>
      <ChatContent
        controller={controller}
        width={width}
        height={height}
        focused
        selectTicker={() => {}}
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

  test("auto-scrolls to newly appended messages while following the latest transcript", async () => {
    const controller = createController([
      makeMessage(1),
      makeMessage(2),
      makeMessage(3),
      makeMessage(4),
      makeMessage(5),
      makeMessage(6),
    ]);

    await act(async () => {
      testSetup = await testRender(createHarness(controller, 60, 12), {
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
});
