import type { ChatChannel } from "../../../api-client";
import { t } from "../../../i18n";
import { normalizeChannelId } from "./controller/state";

function normalizeMentionUsername(username: string | null | undefined): string | null {
  const normalized = username?.trim().replace(/^@+/, "");
  return normalized || null;
}

function formatMentionUsername(username: string | null | undefined): string | null {
  const normalized = normalizeMentionUsername(username);
  return normalized ? `@${normalized}` : null;
}

function formatDirectChannelLabel(channel: ChatChannel, fallbackId: string) {
  const usernameLabel = formatMentionUsername(channel.dmUser?.username);
  if (usernameLabel) return usernameLabel;

  const displayName = channel.dmUser?.displayName?.trim();
  if (displayName) return displayName;

  const channelName = channel.name?.trim();
  if (channelName && channelName !== channel.id) {
    return channelName.startsWith("@")
      ? formatMentionUsername(channelName) ?? channelName
      : channelName;
  }

  return fallbackId.startsWith("dm:") ? t("DM") : fallbackId;
}

export function formatChannelLabel(channel: ChatChannel | undefined, fallbackId: string) {
  if (!channel) return fallbackId;
  if (channel.kind === "direct") {
    return formatDirectChannelLabel(channel, fallbackId);
  }
  if (channel.kind === "group") {
    return channel.name?.trim() || t("Group");
  }
  return channel.name?.trim() || fallbackId;
}

export function formatChatPaneTitle(channel: ChatChannel | undefined, fallbackId: string) {
  const normalizedFallbackId = normalizeChannelId(fallbackId);
  if (channel?.kind === "direct") {
    return formatChannelLabel(channel, normalizedFallbackId);
  }
  if (channel?.kind === "group") {
    return formatChannelLabel(channel, normalizedFallbackId);
  }
  if (!channel && normalizedFallbackId.startsWith("dm:")) return t("DM");
  if (!channel && (normalizedFallbackId.startsWith("grp:") || normalizedFallbackId.startsWith("group:"))) return t("Group");
  return `#${formatChannelLabel(channel, normalizedFallbackId)}`;
}
