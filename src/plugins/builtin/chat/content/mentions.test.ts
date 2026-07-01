import { describe, expect, test } from "bun:test";
import type { ChatChannel, ChatMessage } from "../../../../api-client";
import {
  applyMentionSuggestion,
  buildRecentMentionSuggestions,
  detectChatMentionTrigger,
  filterMentionSuggestions,
} from "./mentions";

const message = (id: string, username: string): ChatMessage => ({
  id,
  channelId: "everyone",
  content: id,
  replyToId: null,
  createdAt: `2026-06-30T00:00:0${id}.000Z`,
  user: { id: `u-${username}`, username, displayName: username },
});

describe("chat mention suggestions", () => {
  test("detects an active mention trigger at the caret", () => {
    expect(detectChatMentionTrigger("watch @al", "watch @al".length)).toEqual({
      start: 6,
      end: 9,
      query: "al",
    });
    expect(detectChatMentionTrigger("email a@b", "email a@b".length)).toBeNull();
    expect(detectChatMentionTrigger("done @al now", "done @al now".length)).toBeNull();
  });

  test("orders visible users by recent messages, filters by prefix, and skips direct channels", () => {
    const activeChannel: ChatChannel = {
      id: "everyone",
      name: "everyone",
      kind: "public",
      created_at: "2026-06-30T00:00:00.000Z",
    };
    const suggestions = buildRecentMentionSuggestions({
      activeChannel,
      currentUserId: "u-me",
      messages: [
        message("1", "alpha"),
        message("2", "bravo"),
        { ...message("3", "me"), user: { id: "u-me", username: "me", displayName: "me" } },
        message("4", "alpha"),
        message("5", "charlie"),
      ],
    });

    expect(suggestions.map((suggestion) => suggestion.username)).toEqual(["charlie", "alpha", "bravo"]);
    expect(filterMentionSuggestions(suggestions, "a").map((suggestion) => suggestion.username)).toEqual(["alpha"]);
    expect(buildRecentMentionSuggestions({
      activeChannel: {
        id: "dm:alpha",
        name: "alpha",
        kind: "direct",
        created_at: "2026-06-30T00:00:00.000Z",
      },
      currentUserId: "u-me",
      messages: [message("1", "alpha")],
    })).toEqual([]);
  });

  test("replaces only the active mention fragment", () => {
    const trigger = detectChatMentionTrigger("check @al", "check @al".length);
    expect(trigger).not.toBeNull();

    expect(applyMentionSuggestion("check @al", trigger!, {
      username: "alpha",
    })).toEqual({
      draft: "check @alpha ",
      cursorOffset: "check @alpha ".length,
    });
  });
});
