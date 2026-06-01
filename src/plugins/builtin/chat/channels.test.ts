import { describe, expect, test } from "bun:test";
import type { ChatChannel } from "../../../api-client";
import {
  channelPrefix,
  formatChannelLabel,
  formatChatPaneTitle,
} from "./channels";

describe("chat channel labels", () => {
  test("formats direct-message labels and titles with one mention prefix", () => {
    const channel: ChatChannel = {
      id: "dm:c7f89ce26f9da83d6be08a4838738074",
      name: "@risto",
      kind: "direct",
      created_at: "2026-05-27T10:30:03.712Z",
      dmUser: { id: "u2", username: "@risto", displayName: "Risto" },
    };

    expect(formatChannelLabel(channel, channel.id)).toBe("@risto");
    expect(channelPrefix(channel, true)).toBe(" ");
    expect(formatChatPaneTitle(channel, channel.id)).toBe("@risto");
    expect(formatChatPaneTitle(undefined, channel.id)).toBe("DM");
  });

  test("uses a neutral group title before private channel metadata loads", () => {
    expect(formatChatPaneTitle(undefined, "grp:93f14c6b9827c30f")).toBe("Group");
  });
});
