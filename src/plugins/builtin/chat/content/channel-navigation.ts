import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { ChatChannel, ChatUserSummary } from "../../../../api-client";
import { useThrottledCommitValue } from "../../../../react/use-throttled-commit-value";
import {
  DEFAULT_CHAT_CHANNEL_ID,
  normalizeChannelId,
} from "../channels";
import type { ChatContentController } from "./types";

const CHANNEL_NAVIGATION_COMMIT_DELAY_MS = 150;

function isConversationChannelId(channelId: string): boolean {
  return channelId.startsWith("dm:") || channelId.startsWith("grp:") || channelId.startsWith("group:");
}

export function useChatChannelNavigation({
  blurInput,
  channelId,
  channelIdRef,
  channels,
  channelsLoading,
  closeProfilePopover,
  controller,
  focused,
  inputFocused,
  onChannelChange,
  resetTranscriptSelection,
  showChannelSidebar,
}: {
  blurInput: () => void;
  channelId: string;
  channelIdRef: MutableRefObject<string>;
  channels: ChatChannel[];
  channelsLoading: boolean;
  closeProfilePopover: () => void;
  controller: ChatContentController;
  focused: boolean;
  inputFocused: boolean;
  onChannelChange?: (channelId: string) => void;
  resetTranscriptSelection: () => void;
  showChannelSidebar: boolean;
}): {
  cycleChannel: (direction: 1 | -1) => boolean;
  directExpanded: boolean;
  focusChannelSidebar: () => boolean;
  focusChatContent: () => boolean;
  moveSidebarChannelSelection: (direction: "up" | "down") => boolean;
  openDirectMessage: (target: ChatUserSummary) => Promise<void>;
  selectSidebarChannel: (channelId: string) => void;
  setDirectExpanded: Dispatch<SetStateAction<boolean>>;
  setSidebarFocused: (nextFocused: boolean) => void;
  sidebarCursorChannelId: string;
  sidebarFocused: boolean;
  sidebarFocusedRef: MutableRefObject<boolean>;
} {
  const [sidebarFocused, setSidebarFocusedState] = useState(false);
  const [directExpanded, setDirectExpanded] = useState(true);
  const sidebarFocusedRef = useRef(false);
  const setSidebarFocused = useCallback((nextFocused: boolean) => {
    sidebarFocusedRef.current = nextFocused;
    setSidebarFocusedState((current) => (current === nextFocused ? current : nextFocused));
  }, []);
  const sidebarNavigationChannels = useMemo(() => {
    const publicChannels = channels.filter((channel) => (channel.kind ?? "public") === "public");
    const conversationChannels = channels.filter((channel) => channel.kind === "direct" || channel.kind === "group");
    return directExpanded ? [...publicChannels, ...conversationChannels] : publicChannels;
  }, [channels, directExpanded]);

  const changeChannel = useCallback((nextChannelId: string) => {
    const normalized = normalizeChannelId(nextChannelId);
    if (normalized === channelIdRef.current) return;
    channelIdRef.current = normalized;
    resetTranscriptSelection();
    onChannelChange?.(normalized);
  }, [channelIdRef, onChannelChange, resetTranscriptSelection]);
  const {
    value: sidebarCursorChannelId,
    valueRef: sidebarCursorChannelIdRef,
    setValue: setSidebarCursorChannelId,
    flushValue: flushSidebarCursorChannelId,
    replaceValue: replaceSidebarCursorChannelId,
  } = useThrottledCommitValue(channelId, changeChannel, CHANNEL_NAVIGATION_COMMIT_DELAY_MS);

  const openDirectMessage = useCallback(async (target: ChatUserSummary) => {
    if (!target.id && !target.username) return;
    try {
      const channel = await controller.openDirectChannel({
        userId: target.id,
        username: target.username ?? undefined,
      });
      setDirectExpanded(true);
      setSidebarCursorChannelId(channel.id, { immediate: true });
      closeProfilePopover();
    } catch {}
  }, [closeProfilePopover, controller, setSidebarCursorChannelId]);

  useEffect(() => {
    if (!onChannelChange || channelsLoading || channels.length === 0) return;
    if (channels.some((channel) => channel.id === channelId)) return;
    // DM/group panes can remount before the private channel catalog is refreshed.
    if (isConversationChannelId(channelId)) return;
    const fallbackChannelId = channels.find((channel) => channel.id === DEFAULT_CHAT_CHANNEL_ID)?.id
      ?? channels[0]?.id;
    if (fallbackChannelId) {
      changeChannel(fallbackChannelId);
    }
  }, [changeChannel, channelId, channels, channelsLoading, onChannelChange]);

  useEffect(() => {
    const activeChannel = channels.find((channel) => channel.id === channelId);
    if (activeChannel?.kind === "direct" || activeChannel?.kind === "group") {
      setDirectExpanded(true);
    }
  }, [channelId, channels]);

  const cycleChannel = useCallback((direction: 1 | -1) => {
    if (channels.length <= 1 || !onChannelChange) return false;
    const currentIndex = Math.max(0, channels.findIndex((channel) => channel.id === channelIdRef.current));
    const nextIndex = (currentIndex + direction + channels.length) % channels.length;
    const nextChannel = channels[nextIndex];
    if (!nextChannel) return false;
    setSidebarCursorChannelId(nextChannel.id, { immediate: true });
    return true;
  }, [channelIdRef, channels, onChannelChange, setSidebarCursorChannelId]);

  const focusChannelSidebar = useCallback(() => {
    if (!showChannelSidebar || !onChannelChange) return false;
    if (inputFocused) {
      blurInput();
    }
    resetTranscriptSelection();
    replaceSidebarCursorChannelId(channelId);
    setSidebarFocused(true);
    return true;
  }, [
    blurInput,
    channelId,
    inputFocused,
    onChannelChange,
    replaceSidebarCursorChannelId,
    resetTranscriptSelection,
    setSidebarFocused,
    showChannelSidebar,
  ]);

  const focusChatContent = useCallback(() => {
    if (!showChannelSidebar) return false;
    flushSidebarCursorChannelId(sidebarCursorChannelIdRef.current);
    setSidebarFocused(false);
    return true;
  }, [flushSidebarCursorChannelId, setSidebarFocused, showChannelSidebar, sidebarCursorChannelIdRef]);

  const moveSidebarChannelSelection = useCallback((direction: "up" | "down") => {
    if (!showChannelSidebar || sidebarNavigationChannels.length <= 1 || !onChannelChange) return false;
    const currentIndex = sidebarNavigationChannels.findIndex((channel) => channel.id === sidebarCursorChannelIdRef.current);
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = direction === "down"
      ? Math.min(baseIndex + 1, sidebarNavigationChannels.length - 1)
      : Math.max(baseIndex - 1, 0);
    const nextChannel = sidebarNavigationChannels[nextIndex];
    if (!nextChannel || nextIndex === baseIndex) return true;
    setSidebarCursorChannelId(nextChannel.id);
    return true;
  }, [
    onChannelChange,
    setSidebarCursorChannelId,
    showChannelSidebar,
    sidebarCursorChannelIdRef,
    sidebarNavigationChannels,
  ]);

  const selectSidebarChannel = useCallback((nextChannelId: string) => {
    setSidebarCursorChannelId(nextChannelId, { immediate: true });
  }, [setSidebarCursorChannelId]);

  useEffect(() => {
    if (focused && showChannelSidebar) return;
    setSidebarFocused(false);
  }, [focused, setSidebarFocused, showChannelSidebar]);

  return {
    cycleChannel,
    directExpanded,
    focusChannelSidebar,
    focusChatContent,
    moveSidebarChannelSelection,
    openDirectMessage,
    selectSidebarChannel,
    setDirectExpanded,
    setSidebarFocused,
    sidebarCursorChannelId,
    sidebarFocused,
    sidebarFocusedRef,
  };
}
