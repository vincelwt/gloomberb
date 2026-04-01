import { describe, expect, it, test } from "bun:test";
import {
  canSelfUpdate,
  checkForUpdate,
  detectUpdateAction,
  performUpdate,
  resolveSelfUpdateTargetPath,
  type ReleaseInfo,
  type UpdateProgress,
} from "./updater";

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
});
