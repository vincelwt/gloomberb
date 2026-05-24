import type { MutableRefObject } from "react";
import { useShortcut } from "../../../../react/input";
import type { ScrollBoxRenderable } from "../../../../ui";
import type { ChatMessage } from "../../../../api-client";
import { isPlainKey } from "../../../../utils/keyboard";
import { scrollToBottom } from "../layout";

export function useChatContentShortcuts({
  beginReplyTo,
  blurInput,
  canSend,
  clearReplyTarget,
  cycleChannel,
  focusChannelSidebar,
  focusChatContent,
  focusComposer,
  focused,
  hasOlderMessages,
  inputFocused,
  inputValueRef,
  loadingOlderMessages,
  messages,
  moveMessageSelection,
  moveSidebarChannelSelection,
  nativePaneChrome,
  replyTo,
  requestOlderMessages,
  requestOlderMessagesIfNeeded,
  returnToComposer,
  scrollRef,
  selectedIdx,
  setFollowMessages,
  setSelectedIdx,
  shouldLeaveComposerForSelection,
  showChannelSidebar,
  sidebarFocusedRef,
}: {
  beginReplyTo: (index: number, options?: { deferFocus?: boolean }) => void;
  blurInput: () => void;
  canSend: boolean;
  clearReplyTarget: () => void;
  cycleChannel: (direction: 1 | -1) => boolean;
  focusChannelSidebar: () => boolean;
  focusChatContent: () => boolean;
  focusComposer: () => void;
  focused: boolean;
  hasOlderMessages: boolean;
  inputFocused: boolean;
  inputValueRef: MutableRefObject<string>;
  loadingOlderMessages: boolean;
  messages: ChatMessage[];
  moveMessageSelection: (direction: "up" | "down") => boolean;
  moveSidebarChannelSelection: (direction: "up" | "down") => boolean;
  nativePaneChrome?: boolean;
  replyTo: ChatMessage | null;
  requestOlderMessages: () => void;
  requestOlderMessagesIfNeeded: () => void;
  returnToComposer: () => void;
  scrollRef: MutableRefObject<ScrollBoxRenderable | null>;
  selectedIdx: number;
  setFollowMessages: (followMessages: boolean) => void;
  setSelectedIdx: (selectedIdx: number) => void;
  shouldLeaveComposerForSelection: (direction: "up" | "down") => boolean;
  showChannelSidebar: boolean;
  sidebarFocusedRef: MutableRefObject<boolean>;
}) {
  useShortcut((event) => {
    if (!focused) return;
    const isEnterKey = event.name === "return" || event.name === "enter";

    if (sidebarFocusedRef.current && showChannelSidebar) {
      if (isPlainKey(event, "left")) {
        event.preventDefault?.();
        event.stopPropagation?.();
        return;
      }

      if (isPlainKey(event, "right")) {
        event.preventDefault?.();
        event.stopPropagation?.();
        focusChatContent();
        return;
      }

      if (isPlainKey(event, "up", "down")) {
        event.preventDefault?.();
        event.stopPropagation?.();
        if (event.name === "up" || event.name === "down") {
          moveSidebarChannelSelection(event.name);
        }
        return;
      }
    }

    if (
      isPlainKey(event, "left") &&
      showChannelSidebar &&
      (!inputFocused || inputValueRef.current.length === 0) &&
      focusChannelSidebar()
    ) {
      event.preventDefault?.();
      event.stopPropagation?.();
      return;
    }

    if (inputFocused) {
      if (event.name === "escape") {
        event.preventDefault?.();
        event.stopPropagation?.();
        if (replyTo) {
          clearReplyTarget();
        } else {
          blurInput();
        }
        return;
      }

      const verticalDirection = event.name === "up" || event.name === "down" ? event.name : null;
      if (verticalDirection && isPlainKey(event, "up", "down") && shouldLeaveComposerForSelection(verticalDirection)) {
        const moved = moveMessageSelection(verticalDirection);
        if (moved) {
          event.preventDefault?.();
          event.stopPropagation?.();
          blurInput();
          return;
        }
      }

      return;
    }

    if (isPlainKey(event, "]") && cycleChannel(1)) {
      event.preventDefault?.();
      event.stopPropagation?.();
      return;
    }
    if (isPlainKey(event, "[") && cycleChannel(-1)) {
      event.preventDefault?.();
      event.stopPropagation?.();
      return;
    }

    if (canSend && isEnterKey && selectedIdx >= 0 && selectedIdx < messages.length) {
      event.preventDefault?.();
      event.stopPropagation?.();
      beginReplyTo(selectedIdx, { deferFocus: true });
      return;
    }

    if ((isEnterKey || isPlainKey(event, "i")) && canSend) {
      event.preventDefault?.();
      event.stopPropagation?.();
      queueMicrotask(() => focusComposer());
      return;
    }

    if (event.name === "escape") {
      event.preventDefault?.();
      event.stopPropagation?.();
      if (selectedIdx >= 0) {
        setSelectedIdx(-1);
        setFollowMessages(true);
      }
      return;
    }

    if (isPlainKey(event, "j", "down")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      if (selectedIdx === messages.length - 1) {
        returnToComposer();
        return;
      }
      moveMessageSelection("down");
      return;
    }
    if (isPlainKey(event, "k", "up")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      if (selectedIdx === 0 && hasOlderMessages && !loadingOlderMessages) {
        requestOlderMessages();
        return;
      }
      moveMessageSelection("up");
      return;
    }

    if (canSend && isPlainKey(event, "r") && selectedIdx >= 0 && selectedIdx < messages.length) {
      event.preventDefault?.();
      event.stopPropagation?.();
      beginReplyTo(selectedIdx, { deferFocus: true });
      return;
    }

    if (isPlainKey(event, "g")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      setSelectedIdx(0);
      setFollowMessages(false);
      scrollRef.current?.scrollTo(0);
      queueMicrotask(requestOlderMessagesIfNeeded);
      return;
    }
    if (event.name === "g" && event.shift) {
      event.preventDefault?.();
      event.stopPropagation?.();
      setSelectedIdx(messages.length - 1);
      setFollowMessages(true);
      queueMicrotask(() => scrollToBottom(scrollRef.current, nativePaneChrome));
    }
  }, { allowEditable: true });
}
