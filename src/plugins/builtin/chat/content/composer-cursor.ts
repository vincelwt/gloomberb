import type { TextareaRenderable } from "../../../../ui";

const clampCursorOffset = (offset: number, draft: string) => Math.max(0, Math.min(offset, draft.length));

export function getComposerCursorOffset(
  textarea: TextareaRenderable | null | undefined,
  draft: string,
): number {
  const offset = textarea?.visualCursor?.offset ?? textarea?.cursorOffset ?? draft.length;
  return clampCursorOffset(offset, draft);
}

export function moveComposerCursorToOffset(
  textarea: TextareaRenderable,
  draft: string,
  offset: number,
): void {
  const nextOffset = clampCursorOffset(offset, draft);
  const editBuffer = textarea.editBuffer as typeof textarea.editBuffer & {
    setCursorByOffset?: (offset: number) => void;
  };
  if (typeof editBuffer.setCursorByOffset === "function") return editBuffer.setCursorByOffset(nextOffset);
  if (typeof textarea.setCursorOffset === "function") return textarea.setCursorOffset(nextOffset);
  try {
    textarea.cursorOffset = nextOffset;
  } catch {
    // Some host renderers expose cursorOffset as read-only.
  }
}
