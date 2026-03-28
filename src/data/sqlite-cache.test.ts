import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { AppPersistence } from "./app-persistence";

const tempPaths: string[] = [];

function createTempDbPath(name: string): string {
  const path = join(tmpdir(), `gloomberb-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  tempPaths.push(path);
  return path;
}

afterEach(() => {
  for (const path of tempPaths.splice(0)) {
    if (existsSync(path)) rmSync(path, { force: true });
  }
});

describe("AppPersistence", () => {
  test("stores and returns cached resources", () => {
    const dbPath = createTempDbPath("resource-cache");
    const persistence = new AppPersistence(dbPath);
    persistence.resources.set({
      namespace: "market",
      kind: "quote",
      entityKey: "AAPL",
      sourceKey: "provider:yahoo",
    }, {
      price: 123,
    }, {
      cachePolicy: { staleMs: 60_000, expireMs: 120_000 },
      schemaVersion: 1,
    });

    expect(persistence.resources.get<{ price: number }>({
      namespace: "market",
      kind: "quote",
      entityKey: "AAPL",
      sourceKey: "provider:yahoo",
    }, { allowExpired: true })?.value.price).toBe(123);
    persistence.close();
  });

  test("invalidates plugin state when schema versions differ", () => {
    const dbPath = createTempDbPath("plugin-version");
    const persistence = new AppPersistence(dbPath);
    persistence.pluginState.set("ask-ai", "conversation", { messages: ["hello"] }, 2);

    expect(persistence.pluginState.get("ask-ai", "conversation", 1)).toBeNull();
    expect(persistence.pluginState.get("ask-ai", "conversation", 2)).toBeNull();
    persistence.close();
  });

  test("stores and returns session snapshots", () => {
    const dbPath = createTempDbPath("session-snapshot");
    const persistence = new AppPersistence(dbPath);
    persistence.sessions.set("app", { focusedPaneId: "ticker-detail:main" }, 1);

    expect(persistence.sessions.get<{ focusedPaneId: string }>("app", 1)?.value.focusedPaneId).toBe("ticker-detail:main");
    persistence.close();
  });
});
