import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PiFileCredentialStore, resolvePiCredentialPath } from "./credential-store";

const tempDirs: string[] = [];

async function tempDataDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "gloomberb-pi-credentials-"));
  tempDirs.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("PiFileCredentialStore", () => {
  test("persists credentials outside AppConfig and never returns mutable storage references", async () => {
    const dataDir = await tempDataDir();
    const store = new PiFileCredentialStore(dataDir);
    await store.modify("anthropic", async () => ({
      type: "oauth",
      access: "access-one",
      refresh: "refresh-one",
      expires: 123,
      accountId: "account-one",
    }));

    const first = await store.read("anthropic");
    expect(first?.type).toBe("oauth");
    if (first?.type === "oauth") first.access = "mutated-only-in-memory";

    const reloaded = await new PiFileCredentialStore(dataDir).read("anthropic");
    expect(reloaded).toMatchObject({
      type: "oauth",
      access: "access-one",
      refresh: "refresh-one",
      expires: 123,
      accountId: "account-one",
    });
    expect(resolvePiCredentialPath(dataDir)).toBe(join(dataDir, "ai", "credentials.json"));

    if (process.platform !== "win32") {
      expect((await stat(resolvePiCredentialPath(dataDir))).mode & 0o777).toBe(0o600);
      expect((await stat(dirname(resolvePiCredentialPath(dataDir)))).mode & 0o777).toBe(0o700);
    }
  });

  test("serializes updates made through separate store instances", async () => {
    const dataDir = await tempDataDir();
    const first = new PiFileCredentialStore(dataDir);
    const second = new PiFileCredentialStore(dataDir);

    await Promise.all([
      first.modify("anthropic", async () => ({ type: "api_key", key: "anthropic-key" })),
      second.modify("openai", async () => ({ type: "api_key", key: "openai-key" })),
    ]);

    expect(await first.list()).toEqual([
      { providerId: "anthropic", type: "api_key" },
      { providerId: "openai", type: "api_key" },
    ]);
  });

  test("fails closed instead of overwriting a malformed credential file", async () => {
    const dataDir = await tempDataDir();
    const path = resolvePiCredentialPath(dataDir);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ version: 1, credentials: { anthropic: { type: "oauth" } } }), "utf8");

    const store = new PiFileCredentialStore(dataDir);
    await expect(store.read("anthropic")).rejects.toThrow("stored AI credential");
    await expect(store.modify("openai", async () => ({ type: "api_key", key: "key" }))).rejects.toThrow(
      "stored AI credential",
    );
    expect(await readFile(path, "utf8")).toContain('"type":"oauth"');
  });
});
