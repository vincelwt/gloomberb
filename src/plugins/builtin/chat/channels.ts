import type { CommandResultDef, GloomPluginContext } from "../../../types/plugin";
import type { ChatChannel } from "../../../api-client";
import { chatController } from "./controller";

export const DEFAULT_CHAT_CHANNEL_ID = "everyone";
export const LAST_VISITED_CHAT_CHANNEL_KEY = "lastChatChannelId";

const CHAT_USERNAME_ARG = /^@?([A-Za-z][A-Za-z0-9_]{2,29})$/;

export function normalizeChannelId(channelId: string | null | undefined) {
  const trimmed = channelId?.trim();
  return trimmed || DEFAULT_CHAT_CHANNEL_ID;
}

export function normalizeShortcutChannelId(channelId: string | null | undefined) {
  const trimmed = channelId?.trim().replace(/^#+/, "");
  return normalizeChannelId(trimmed?.toLowerCase());
}

export function getLastVisitedChatChannelId(config: { pluginConfig: Record<string, Record<string, unknown>> }) {
  return normalizeChannelId(config.pluginConfig["gloomberb-cloud"]?.[LAST_VISITED_CHAT_CHANNEL_KEY] as string | undefined);
}

export function formatChannelLabel(channel: ChatChannel | undefined, fallbackId: string) {
  if (!channel) return fallbackId;
  if (channel.kind === "direct") {
    return channel.dmUser?.username ? `@${channel.dmUser.username}` : channel.dmUser?.displayName ?? "DM";
  }
  if (channel.kind === "group") {
    return channel.name?.trim() || "Group";
  }
  return channel.name?.trim() || fallbackId;
}

function conversationDetail(channel: ChatChannel): string {
  if (channel.kind === "direct") {
    const displayName = channel.dmUser?.displayName?.trim();
    const username = channel.dmUser?.username?.trim();
    return [displayName && username ? displayName : null, "Direct message"].filter(Boolean).join(" - ");
  }
  const members = (channel.members ?? [])
    .map((member) => member.username ? `@${member.username}` : member.displayName)
    .filter(Boolean)
    .slice(0, 4);
  const suffix = (channel.members?.length ?? 0) > members.length ? ` +${(channel.members?.length ?? 0) - members.length}` : "";
  return members.length > 0 ? `Group chat - ${members.join(", ")}${suffix}` : "Group chat";
}

export function parseDmUsernames(value: string): string[] {
  const usernames = new Set<string>();
  for (const rawPart of value.split(/[\s,]+/)) {
    const part = rawPart.trim();
    if (!part) continue;
    const match = part.match(CHAT_USERNAME_ARG);
    if (!match?.[1]) continue;
    usernames.add(match[1].toLowerCase());
  }
  return [...usernames];
}

export function hasOnlyDmUsernameArgs(value: string): boolean {
  const parts = value.split(/[\s,]+/).map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((part) => CHAT_USERNAME_ARG.test(part));
}

function openChatChannelFromCommand(ctx: GloomPluginContext, channelId: string): void {
  ctx.createPaneFromTemplate("new-chat-pane", { arg: channelId });
}

export function openDefaultChatFromCommand(
  ctx: Pick<GloomPluginContext, "createPaneFromTemplate" | "getConfig" | "showPane">,
): void {
  const config = ctx.getConfig();
  const hasChatPane = config.layout.instances.some((instance) => instance.paneId === "chat");
  if (hasChatPane) {
    ctx.showPane("chat");
    return;
  }
  ctx.createPaneFromTemplate("new-chat-pane", { arg: getLastVisitedChatChannelId(config) });
}

export async function openDmTargetFromCommand(ctx: GloomPluginContext, usernames: string[]): Promise<void> {
  if (usernames.length === 0) {
    openDefaultChatFromCommand(ctx);
    return;
  }
  const channel = usernames.length === 1
    ? await chatController.openDirectChannel({ username: usernames[0] })
    : await chatController.openGroupChannel({ usernames });
  openChatChannelFromCommand(ctx, channel.id);
}

export function buildDmCommandResults(ctx: GloomPluginContext, arg: string): CommandResultDef[] {
  const trimmed = arg.trim();
  if (trimmed) {
    const usernames = parseDmUsernames(trimmed);
    const valid = hasOnlyDmUsernameArgs(trimmed) && usernames.length > 0;
    const label = usernames.length <= 1
      ? `DM ${usernames[0] ? `@${usernames[0]}` : trimmed}`
      : `Group ${usernames.map((username) => `@${username}`).join(", ")}`;
    return [{
      id: `start:${valid ? usernames.join(",") : trimmed}`,
      label,
      detail: valid
        ? usernames.length === 1
          ? "Start or open direct message"
          : "Start group chat"
        : "Use @username, or multiple usernames for a group chat",
      category: "Chat",
      right: "DM",
      disabled: !valid,
      execute: () => openDmTargetFromCommand(ctx, usernames),
    }];
  }

  const conversations = chatController.getSnapshot().channels
    .filter((channel) => channel.kind === "direct" || channel.kind === "group");
  if (conversations.length === 0) {
    return [{
      id: "empty",
      label: "No DMs yet",
      detail: "Type DM @username to start one",
      category: "Chat",
      right: "DM",
      disabled: true,
      execute: () => {},
    }];
  }

  return conversations.map((channel) => ({
    id: `channel:${channel.id}`,
    label: formatChannelLabel(channel, channel.id),
    detail: conversationDetail(channel),
    category: "Conversations",
    right: channel.kind === "group" ? "Group" : "DM",
    keywords: [
      channel.name,
      channel.dmUser?.username ?? "",
      ...(channel.members ?? []).map((member) => member.username ?? member.displayName),
    ],
    execute: () => openChatChannelFromCommand(ctx, channel.id),
  }));
}

export function channelPrefix(channel: ChatChannel | undefined, active: boolean) {
  if (channel?.kind === "direct") return active ? "@" : " ";
  if (channel?.kind === "group") return active ? "+" : " ";
  return active ? "#" : " ";
}

export function truncateChannelLabel(label: string, width: number) {
  if (width <= 0) return "";
  if (label.length <= width) return label;
  if (width <= 1) return label.slice(0, width);
  if (width <= 3) return label.slice(0, width);
  return `${label.slice(0, width - 3)}...`;
}
