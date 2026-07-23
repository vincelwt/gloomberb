import { describe, expect, test } from "bun:test";
import { normalizeTabs } from "./model";

describe("AI screener model", () => {
  test("migrates persisted provider aliases and defaults missing providers", () => {
    const tabs = normalizeTabs({
      tabs: [
        { id: "claude", providerId: "claude" },
        { id: "codex", providerId: "codex" },
        { id: "gemini", providerId: "gemini" },
        { id: "unsupported", providerId: "opencode" },
        { id: "missing" },
      ],
    });

    expect(tabs.map((tab) => tab.providerId)).toEqual([
      "anthropic",
      "openai-codex",
      "google",
      "opencode",
      "anthropic",
    ]);
  });
});
