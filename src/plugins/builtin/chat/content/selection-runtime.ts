import { useCallback, useEffect, type Dispatch, type SetStateAction } from "react";
import type { TextareaRenderable } from "../../../../ui";

interface MutableRef<T> {
  current: T;
}

export function useChatMessageSelection({
  inputRef,
  messageCount,
  selectedIdx,
  setFollowMessages,
  setSelectedIdx,
}: {
  inputRef: MutableRef<TextareaRenderable | null>;
  messageCount: number;
  selectedIdx: number;
  setFollowMessages: Dispatch<SetStateAction<boolean>>;
  setSelectedIdx: Dispatch<SetStateAction<number>>;
}) {
  const resetTranscriptSelection = useCallback(() => {
    setSelectedIdx(-1);
    setFollowMessages(true);
  }, [setFollowMessages, setSelectedIdx]);

  const moveMessageSelection = useCallback((direction: "up" | "down") => {
    if (messageCount === 0) return false;

    let next: number;
    if (selectedIdx < 0) {
      if (direction === "down") return false;
      next = messageCount - 1;
    } else if (direction === "down") {
      next = Math.min(selectedIdx + 1, messageCount - 1);
    } else {
      next = Math.max(selectedIdx - 1, 0);
    }

    setSelectedIdx(next);
    setFollowMessages(next === messageCount - 1);
    return true;
  }, [messageCount, selectedIdx, setFollowMessages, setSelectedIdx]);

  const shouldLeaveComposerForSelection = useCallback((direction: "up" | "down") => {
    const textarea = inputRef.current;
    if (!textarea || textarea.hasSelection()) return false;

    const visualLineCount = Math.max(textarea.virtualLineCount, 1);
    if (direction === "up") {
      return textarea.visualCursor.visualRow <= 0;
    }

    return textarea.visualCursor.visualRow >= visualLineCount - 1;
  }, [inputRef]);

  useEffect(() => {
    if (selectedIdx < messageCount) return;
    setSelectedIdx(messageCount - 1);
  }, [messageCount, selectedIdx, setSelectedIdx]);

  return {
    moveMessageSelection,
    resetTranscriptSelection,
    shouldLeaveComposerForSelection,
  };
}
