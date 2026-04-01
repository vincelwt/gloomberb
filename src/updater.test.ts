import { describe, expect, test } from "bun:test";
import { canSelfUpdate, detectUpdateAction } from "./updater";

describe("detectUpdateAction", () => {
  test("uses self-update for standalone binaries", () => {
    expect(detectUpdateAction("/Users/vince/.local/bin/gloomberb")).toEqual({ kind: "self" });
  });

  test("uses manual bun updates when launched through the bun runtime", () => {
    expect(detectUpdateAction("/opt/homebrew/bin/bun")).toEqual({
      kind: "manual",
      command: "bun install -g gloomberb@latest",
    });
  });

  test("uses manual npm updates for node-managed runtimes", () => {
    expect(detectUpdateAction("/opt/homebrew/bin/node")).toEqual({
      kind: "manual",
      command: "npm install -g gloomberb@latest",
    });
  });

  test("detects npm-style global install paths", () => {
    expect(detectUpdateAction("/usr/local/lib/node_modules/gloomberb/bin/gloomberb")).toEqual({
      kind: "manual",
      command: "npm install -g gloomberb@latest",
    });
  });

  test("detects bun-style global install paths", () => {
    expect(detectUpdateAction("/Users/vince/.bun/install/global/node_modules/gloomberb/bin/gloomberb")).toEqual({
      kind: "manual",
      command: "bun install -g gloomberb@latest",
    });
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
