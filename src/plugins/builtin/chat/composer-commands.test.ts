import { describe, expect, test } from "bun:test";
import { parseChatComposerCommand } from "./composer-commands";

describe("parseChatComposerCommand", () => {
  test("parses direct-message commands with an optional draft", () => {
    expect(parseChatComposerCommand("/dm @Alice hello there")).toEqual({
      kind: "direct",
      username: "alice",
      draft: "hello there",
    });
    expect(parseChatComposerCommand("/dm Bob")).toEqual({
      kind: "direct",
      username: "bob",
      draft: "",
    });
  });

  test("parses group commands from tagged users and an optional name", () => {
    expect(parseChatComposerCommand("/group Infra desk @Alice @bob_123")).toEqual({
      kind: "group",
      usernames: ["alice", "bob_123"],
      name: "Infra desk",
    });
  });

  test("leaves malformed slash commands as normal chat text", () => {
    expect(parseChatComposerCommand("/dm ab hi")).toBeNull();
    expect(parseChatComposerCommand("/group Infra desk")).toBeNull();
  });
});
