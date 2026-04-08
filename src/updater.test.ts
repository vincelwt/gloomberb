import { afterEach, describe, expect, it, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { gzipSync } from "zlib";
import {
  canSelfUpdate,
  checkForUpdate,
  checkForUpdateDetailed,
  detectUpdateAction,
  performUpdate,
  resolveSelfUpdateTargetPath,
  type ReleaseInfo,
  type UpdateProgress,
} from "./updater";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function expectedAssetName(compressed = false): string {
  const os = process.platform === "darwin" ? "darwin" : "linux";
  const arch = os === "darwin" || process.arch === "arm64" ? "arm64" : "x64";
  return compressed ? `gloomberb-${os}-${arch}.gz` : `gloomberb-${os}-${arch}`;
}

describe("detectUpdateAction", () => {
  test("uses self-update for standalone binaries", () => {
    expect(detectUpdateAction(
      "/Users/vince/.local/bin/gloomberb",
      ["/Users/vince/.local/bin/gloomberb"],
    )).toEqual({ kind: "self" });
  });

  test("uses manual bun updates for bun-managed installs", () => {
    expect(detectUpdateAction(
      "/opt/homebrew/bin/bun",
      ["/opt/homebrew/bin/bun", "/Users/vince/.bun/install/global/node_modules/gloomberb/bin/gloomberb"],
    )).toEqual({
      kind: "manual",
      command: "bun install -g gloomberb@latest",
    });
  });

  test("uses manual npm updates for node-managed installs", () => {
    expect(detectUpdateAction(
      "/opt/homebrew/bin/node",
      ["/opt/homebrew/bin/node", "/usr/local/lib/node_modules/gloomberb/bin/gloomberb"],
    )).toEqual({
      kind: "manual",
      command: "npm install -g gloomberb@latest",
    });
  });

  test("skips updates when launched from source under bun", () => {
    expect(detectUpdateAction(
      "/opt/homebrew/bin/bun",
      ["/opt/homebrew/bin/bun", "src/index.tsx"],
    )).toBeNull();
  });
});

describe("resolveSelfUpdateTargetPath", () => {
  it("rejects Bun runtime paths", () => {
    expect(resolveSelfUpdateTargetPath(
      "/Users/vince/.bun/bin/bun",
      ["/Users/vince/.bun/bin/bun", "src/index.tsx"],
    )).toBeNull();
  });

  it("rejects Node runtime paths", () => {
    expect(resolveSelfUpdateTargetPath(
      "/usr/local/bin/node",
      ["/usr/local/bin/node", "dist/index.js"],
    )).toBeNull();
  });

  it("accepts packaged gloomberb binaries", () => {
    expect(resolveSelfUpdateTargetPath(
      "/Applications/gloomberb",
      ["/Applications/gloomberb"],
    )).toBe("/Applications/gloomberb");
  });
});

describe("canSelfUpdate", () => {
  test("returns false for manual update releases", () => {
    expect(canSelfUpdate({
      updateAction: { kind: "manual", command: "bun install -g gloomberb@latest" },
    })).toBe(false);
  });

  test("returns true for self-update releases", () => {
    expect(canSelfUpdate({
      updateAction: { kind: "self" },
    })).toBe(true);
  });
});

describe("checkForUpdate", () => {
  it("skips update checks when running from source", async () => {
    const originalExecPath = process.execPath;
    const originalArgv = process.argv;

    try {
      Object.defineProperty(process, "execPath", { value: "/Users/vince/.bun/bin/bun", configurable: true });
      Object.defineProperty(process, "argv", {
        value: ["/Users/vince/.bun/bin/bun", "src/index.tsx"],
        configurable: true,
      });

      await expect(checkForUpdate("0.2.0")).resolves.toBeNull();
    } finally {
      Object.defineProperty(process, "execPath", { value: originalExecPath, configurable: true });
      Object.defineProperty(process, "argv", { value: originalArgv, configurable: true });
    }
  });

  it("finds gzipped release assets published on GitHub", async () => {
    const originalExecPath = process.execPath;
    const originalArgv = process.argv;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      tag_name: "v0.3.2",
      published_at: "2026-04-03T00:00:00Z",
      assets: [{
        name: expectedAssetName(true),
        browser_download_url: "https://example.com/gloomberb.gz",
      }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

    try {
      Object.defineProperty(process, "execPath", { value: "/Applications/gloomberb", configurable: true });
      Object.defineProperty(process, "argv", {
        value: ["/Applications/gloomberb"],
        configurable: true,
      });

      await expect(checkForUpdate("0.3.1")).resolves.toEqual({
        version: "0.3.2",
        tagName: "v0.3.2",
        downloadUrl: "https://example.com/gloomberb.gz",
        publishedAt: "2026-04-03T00:00:00Z",
        updateAction: { kind: "self" },
        compressed: true,
      });
    } finally {
      Object.defineProperty(process, "execPath", { value: originalExecPath, configurable: true });
      Object.defineProperty(process, "argv", { value: originalArgv, configurable: true });
    }
  });
});

describe("checkForUpdateDetailed", () => {
  it("returns a useful error when GitHub rejects the request", async () => {
    const originalExecPath = process.execPath;
    const originalArgv = process.argv;
    globalThis.fetch = (async () => new Response("busy", { status: 503 })) as typeof fetch;

    try {
      Object.defineProperty(process, "execPath", { value: "/Applications/gloomberb", configurable: true });
      Object.defineProperty(process, "argv", {
        value: ["/Applications/gloomberb"],
        configurable: true,
      });

      await expect(checkForUpdateDetailed("0.3.1")).resolves.toEqual({
        kind: "error",
        error: "GitHub returned 503",
      });
    } finally {
      Object.defineProperty(process, "execPath", { value: originalExecPath, configurable: true });
      Object.defineProperty(process, "argv", { value: originalArgv, configurable: true });
    }
  });
});

describe("performUpdate", () => {
  it("returns a manual command instead of trying to overwrite Bun-managed installs", async () => {
    const progress: UpdateProgress[] = [];
    const release: ReleaseInfo = {
      version: "9.9.9",
      tagName: "v9.9.9",
      downloadUrl: "https://example.com/gloomberb-darwin-arm64",
      publishedAt: "2026-04-01T00:00:00Z",
      updateAction: { kind: "manual", command: "bun install -g gloomberb@latest" },
    };

    await performUpdate(release, (entry) => {
      progress.push(entry);
    });

    expect(progress).toEqual([
      {
        phase: "error",
        error: "Run bun install -g gloomberb@latest",
      },
    ]);
  });

  it("returns an explicit error instead of overwriting Bun when execution context changes", async () => {
    const originalExecPath = process.execPath;
    const originalArgv = process.argv;
    const progress: UpdateProgress[] = [];
    const release: ReleaseInfo = {
      version: "9.9.9",
      tagName: "v9.9.9",
      downloadUrl: "https://example.com/gloomberb-darwin-arm64",
      publishedAt: "2026-04-01T00:00:00Z",
      updateAction: { kind: "self" },
    };

    try {
      Object.defineProperty(process, "execPath", { value: "/Users/vince/.bun/bin/bun", configurable: true });
      Object.defineProperty(process, "argv", {
        value: ["/Users/vince/.bun/bin/bun", "src/index.tsx"],
        configurable: true,
      });

      await performUpdate(release, (entry) => {
        progress.push(entry);
      });

      expect(progress).toEqual([
        {
          phase: "error",
          error: "Self-update is unavailable when running from source or via Bun/Node. Relaunch the packaged gloomberb binary to update.",
        },
      ]);
    } finally {
      Object.defineProperty(process, "execPath", { value: originalExecPath, configurable: true });
      Object.defineProperty(process, "argv", { value: originalArgv, configurable: true });
    }
  });

  it("decompresses gzipped release assets before replacing the binary", async () => {
    const originalExecPath = process.execPath;
    const originalArgv = process.argv;
    const tempDir = mkdtempSync(join(tmpdir(), "gloomberb-update-"));
    const execPath = join(tempDir, "gloomberb");
    const nextBinary = Buffer.from("new-binary");
    const payload = gzipSync(nextBinary);
    const progress: UpdateProgress[] = [];

    writeFileSync(execPath, Buffer.from("old-binary"));
    chmodSync(execPath, 0o755);
    globalThis.fetch = (async () => new Response(payload, {
      status: 200,
      headers: { "content-length": String(payload.length) },
    })) as typeof fetch;

    try {
      Object.defineProperty(process, "execPath", { value: execPath, configurable: true });
      Object.defineProperty(process, "argv", {
        value: [execPath],
        configurable: true,
      });

      await performUpdate({
        version: "9.9.9",
        tagName: "v9.9.9",
        downloadUrl: "https://example.com/gloomberb.gz",
        publishedAt: "2026-04-03T00:00:00Z",
        updateAction: { kind: "self" },
        compressed: true,
      }, (entry) => {
        progress.push(entry);
      });

      expect(readFileSync(execPath)).toEqual(nextBinary);
      expect(progress[0]).toEqual({ phase: "downloading", percent: 0 });
      expect(progress).toContainEqual({ phase: "downloading", percent: 100 });
      expect(progress.at(-1)).toEqual({ phase: "done" });
    } finally {
      Object.defineProperty(process, "execPath", { value: originalExecPath, configurable: true });
      Object.defineProperty(process, "argv", { value: originalArgv, configurable: true });
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
