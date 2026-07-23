import { afterEach, describe, expect, test } from "bun:test";
import {
  connectAiRuntimeProvider,
  disconnectAiRuntimeProvider,
  getAiRuntimeCatalog,
  getAiRuntimeCatalogSnapshot,
  runAiPrompt,
  setAiRunHost,
  setAiRuntimeCatalog,
  subscribeAiRuntimeCatalog,
  type AiRunHost,
  type AiRuntimeCatalog,
} from "./runner";

function catalog(connectionState: "connected" | "not_connected"): AiRuntimeCatalog {
  const connected = connectionState === "connected";
  return {
    providers: [{
      providerId: "openai-codex",
      label: "OpenAI (ChatGPT)",
      status: connected ? "ready" : "not_authenticated",
      ...(!connected ? { unavailableReason: "Not connected." } : {}),
      outputModes: ["plain", "structured", "screener"],
      defaultModelId: "gpt-5.6-sol",
    }],
    accounts: [{
      providerId: "openai-codex",
      providerLabel: "OpenAI (ChatGPT)",
      connectionState,
      connectionLabel: connected ? "Connected with OAuth" : "Not connected.",
      ...(connected
        ? { credentialSource: "OAuth", credentialOrigin: "stored" as const }
        : {}),
      authMethods: [{ type: "oauth", label: "ChatGPT Plus/Pro", canLogin: true }],
      canLogin: true,
      canDisconnect: connected,
      loginType: "oauth",
    }],
    models: [{
      id: "gpt-5.6-sol",
      providerId: "openai-codex",
      label: "GPT-5.6 Sol",
      available: connected,
    }],
  };
}

afterEach(() => {
  setAiRunHost(null);
  setAiRuntimeCatalog({ providers: [], accounts: [], models: [] });
});

describe("AI runtime catalog", () => {
  test("publishes stable snapshots for set, connect, and disconnect", async () => {
    const connected = catalog("connected");
    const disconnected = catalog("not_connected");
    const snapshots: AiRuntimeCatalog[] = [];
    const authEvents: unknown[] = [];
    const unsubscribe = subscribeAiRuntimeCatalog(() => {
      snapshots.push(getAiRuntimeCatalogSnapshot());
    });
    setAiRunHost({
      run: () => ({ done: Promise.resolve("unused"), cancel() {} }),
      connect: async (_providerId, _authType, onAuthEvent) => {
        onAuthEvent?.({
          type: "device_code",
          userCode: "ABCD-EFGH",
          verificationUri: "https://github.com/login/device",
        });
        return connected;
      },
      disconnect: async () => disconnected,
    });

    const initialSnapshot = getAiRuntimeCatalogSnapshot();
    setAiRuntimeCatalog(disconnected);
    const setSnapshot = getAiRuntimeCatalogSnapshot();
    expect(setSnapshot).not.toBe(initialSnapshot);
    expect(getAiRuntimeCatalogSnapshot()).toBe(setSnapshot);

    await connectAiRuntimeProvider("codex", undefined, (event) => {
      authEvents.push(event);
    });
    const connectSnapshot = getAiRuntimeCatalogSnapshot();
    expect(connectSnapshot.accounts[0]?.connectionState).toBe("connected");
    expect(connectSnapshot).not.toBe(setSnapshot);
    expect(authEvents).toEqual([{
      type: "device_code",
      userCode: "ABCD-EFGH",
      verificationUri: "https://github.com/login/device",
    }]);

    await disconnectAiRuntimeProvider("openai-codex");
    expect(getAiRuntimeCatalogSnapshot().accounts[0]?.connectionState).toBe("not_connected");
    expect(snapshots).toHaveLength(3);

    unsubscribe();
    setAiRuntimeCatalog(connected);
    expect(snapshots).toHaveLength(3);
  });

  test("returns a defensive imperative copy including nested auth methods", () => {
    setAiRuntimeCatalog(catalog("connected"));
    const copy = getAiRuntimeCatalog();
    copy.providers[0]!.outputModes.length = 0;
    copy.accounts[0]!.authMethods[0]!.label = "mutated";

    expect(getAiRuntimeCatalogSnapshot().providers[0]?.outputModes).toEqual([
      "plain",
      "structured",
      "screener",
    ]);
    expect(getAiRuntimeCatalogSnapshot().accounts[0]?.authMethods[0]?.label)
      .toBe("ChatGPT Plus/Pro");
  });
});

describe("AI runner", () => {
  test("delegates canonical provider id, model, and structured history to the native host", async () => {
    type RunOptions = Parameters<AiRunHost["run"]>[0];
    const received: RunOptions[] = [];
    let cancelled = false;
    setAiRunHost({
      run(options) {
        received.push(options);
        return {
          done: Promise.resolve("host output"),
          cancel: () => { cancelled = true; },
        };
      },
    });

    const run = runAiPrompt({
      // Legacy values are accepted only at this migration boundary.
      providerId: "codex",
      prompt: "Current request",
      messages: [
        { role: "user", content: "Earlier request" },
        { role: "assistant", content: "Earlier response" },
      ],
      modelId: "gpt-5.6-sol",
      outputMode: "structured",
    });
    run.cancel();

    expect(await run.done).toBe("host output");
    expect(received).toEqual([{
      providerId: "openai-codex",
      prompt: "Current request",
      messages: [
        { role: "user", content: "Earlier request" },
        { role: "assistant", content: "Earlier response" },
      ],
      modelId: "gpt-5.6-sol",
      onChunk: undefined,
      outputMode: "structured",
    }]);
    expect(cancelled).toBe(true);
  });

  test("fails clearly when the native runtime is unavailable or provider id is unknown", async () => {
    await expect(runAiPrompt({
      providerId: "anthropic",
      prompt: "hello",
    }).done).rejects.toThrow("native AI runtime is unavailable");

    setAiRunHost({
      run: () => ({ done: Promise.resolve("unused"), cancel() {} }),
    });
    await expect(runAiPrompt({
      providerId: "opencode",
      prompt: "hello",
    }).done).rejects.toThrow("Unknown AI provider: opencode");
  });
});
