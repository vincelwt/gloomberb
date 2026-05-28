import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { TextareaRenderable } from "../../../../ui";
import type { ChatMessage } from "../../../../api-client";
import {
  COMPOSER_ACTION_WIDTH,
  formatInlinePreview,
} from "../layout";
import { parseChatComposerCommand } from "../composer-commands";
import type { ChatContentController } from "./types";

interface MutableRef<T> {
  current: T;
}

export function useChatComposerRuntime({
  applyingExternalDraftRef,
  blurInput,
  canSend,
  channelId,
  channelIdRef,
  contentWidth,
  controller,
  focusInput,
  focused,
  inputFocused,
  inputRef,
  inputValueRef,
  messages,
  onChannelChange,
  replyTo,
  setDirectExpanded,
  setFollowMessages,
  setReplyTo,
  setSelectedIdx,
  updateComposerRows,
  useDefaultControllerChannel,
}: {
  applyingExternalDraftRef: MutableRef<boolean>;
  blurInput: () => void;
  canSend: boolean;
  channelId: string;
  channelIdRef: MutableRef<string>;
  contentWidth: number;
  controller: ChatContentController;
  focusInput: () => void;
  focused: boolean;
  inputFocused: boolean;
  inputRef: MutableRef<TextareaRenderable | null>;
  inputValueRef: MutableRef<string>;
  messages: ChatMessage[];
  onChannelChange?: (channelId: string) => void;
  replyTo: ChatMessage | null;
  setDirectExpanded: Dispatch<SetStateAction<boolean>>;
  setFollowMessages: Dispatch<SetStateAction<boolean>>;
  setReplyTo: Dispatch<SetStateAction<ChatMessage | null>>;
  setSelectedIdx: Dispatch<SetStateAction<number>>;
  updateComposerRows: (draft: string) => void;
  useDefaultControllerChannel: boolean;
}) {
  const replyToRef = useRef(replyTo);
  replyToRef.current = replyTo;

  const focusComposer = useCallback(() => {
    setSelectedIdx(-1);
    setFollowMessages(true);
    focusInput();
  }, [focusInput, setFollowMessages, setSelectedIdx]);

  const clearReplyTarget = useCallback(() => {
    setReplyTo(null);
    if (useDefaultControllerChannel) {
      controller.setReplyToId(null);
    } else {
      controller.setChannelReplyToId(channelId, null);
    }
  }, [channelId, controller, setReplyTo, useDefaultControllerChannel]);

  const beginReplyTo = useCallback((index: number, options?: { deferFocus?: boolean }) => {
    if (!canSend || index < 0 || index >= messages.length) return;
    const nextReplyTo = messages[index] ?? null;
    if (!nextReplyTo) return;
    setSelectedIdx(index);
    setFollowMessages(index === messages.length - 1);
    setReplyTo(nextReplyTo);
    if (useDefaultControllerChannel) {
      controller.setReplyToId(nextReplyTo.id);
    } else {
      controller.setChannelReplyToId(channelId, nextReplyTo.id);
    }
    if (options?.deferFocus) {
      queueMicrotask(() => focusInput());
    } else {
      focusInput();
    }
  }, [
    canSend,
    channelId,
    controller,
    focusInput,
    messages,
    setFollowMessages,
    setReplyTo,
    setSelectedIdx,
    useDefaultControllerChannel,
  ]);

  const returnToComposer = useCallback(() => {
    setSelectedIdx(-1);
    setFollowMessages(true);
    if (canSend) {
      queueMicrotask(() => focusInput());
    }
  }, [canSend, focusInput, setFollowMessages, setSelectedIdx]);

  const clearLocalComposer = useCallback(() => {
    inputValueRef.current = "";
    updateComposerRows("");
    const textarea = inputRef.current;
    if (textarea && textarea.editBuffer.getText() !== "") {
      applyingExternalDraftRef.current = true;
      try {
        textarea.setText("");
      } finally {
        applyingExternalDraftRef.current = false;
      }
    }
  }, [applyingExternalDraftRef, inputRef, inputValueRef, updateComposerRows]);

  const sendMessage = useCallback(() => {
    const content = inputValueRef.current.trim();
    if (!content) return;
    const composerCommand = parseChatComposerCommand(content);
    if (composerCommand?.kind === "direct") {
      void controller.openDirectChannel({ username: composerCommand.username }).then((channel) => {
        setDirectExpanded(true);
        channelIdRef.current = channel.id;
        onChannelChange?.(channel.id);
        clearLocalComposer();
        if (composerCommand.draft) {
          controller.setChannelDraft(channel.id, composerCommand.draft);
        }
      }).catch(() => {});
      return;
    }
    if (composerCommand?.kind === "group") {
      void controller.openGroupChannel({
        usernames: composerCommand.usernames,
        name: composerCommand.name,
      }).then((channel) => {
        setDirectExpanded(true);
        channelIdRef.current = channel.id;
        onChannelChange?.(channel.id);
        clearLocalComposer();
      }).catch(() => {});
      return;
    }
    const sendChannelId = useDefaultControllerChannel ? channelId : channelIdRef.current;
    const replyToId = replyToRef.current?.channelId === sendChannelId
      ? replyToRef.current.id
      : undefined;
    const accepted = useDefaultControllerChannel
      ? controller.send(content, replyToId)
      : controller.sendToChannel(sendChannelId, content, replyToId);
    if (!accepted) return;
    clearLocalComposer();
    setSelectedIdx(-1);
    setFollowMessages(true);
  }, [
    channelId,
    channelIdRef,
    clearLocalComposer,
    controller,
    inputValueRef,
    onChannelChange,
    setDirectExpanded,
    setFollowMessages,
    setSelectedIdx,
    useDefaultControllerChannel,
  ]);

  const commitLocalDraft = useCallback((draft: string) => {
    if (applyingExternalDraftRef.current) return;
    inputValueRef.current = draft;
    updateComposerRows(draft);
    if (useDefaultControllerChannel) {
      controller.setDraft(draft);
    } else {
      controller.setChannelDraft(channelId, draft);
    }
  }, [
    applyingExternalDraftRef,
    channelId,
    controller,
    inputValueRef,
    updateComposerRows,
    useDefaultControllerChannel,
  ]);

  useEffect(() => {
    if (!canSend && inputFocused) {
      blurInput();
    }
  }, [blurInput, canSend, inputFocused]);

  useEffect(() => {
    if (!focused && inputFocused) {
      blurInput();
    }
  }, [blurInput, focused, inputFocused]);

  useEffect(() => {
    if (focused && inputFocused) {
      inputRef.current?.focus?.();
    }
  }, [focused, inputFocused, inputRef]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    textarea.onContentChange = () => {
      commitLocalDraft(textarea.editBuffer.getText());
    };

    return () => {
      if (textarea) {
        textarea.onContentChange = undefined;
      }
    };
  }, [commitLocalDraft, inputRef]);

  useEffect(() => {
    if (canSend || !replyTo) return;
    clearReplyTarget();
  }, [canSend, clearReplyTarget, replyTo]);

  const replyPreview = replyTo
    ? formatInlinePreview(
      replyTo.content,
      Math.max(contentWidth - ` replying to @${replyTo.user.username}: `.length - COMPOSER_ACTION_WIDTH - 1, 0),
    )
    : "";
  const inputPlaceholder = replyTo ? `Reply to @${replyTo.user.username}...` : "Type a message...";

  return {
    beginReplyTo,
    clearReplyTarget,
    commitLocalDraft,
    focusComposer,
    inputPlaceholder,
    replyPreview,
    returnToComposer,
    sendMessage,
  };
}
