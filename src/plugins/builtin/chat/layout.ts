import type { ScrollBoxRenderable } from "../../../ui";
import type { ChatMessage } from "../../../api-client";
import { truncateWithEllipsis } from "../../../utils/text-wrap";

const MESSAGE_GROUP_THRESHOLD_MS = 5 * 60 * 1000;
const MESSAGE_SELECTION_BOTTOM_INSET = 1;
const SCROLL_BOTTOM_THRESHOLD_PX = 2;

export const CHAT_COMPOSER_MAX_ROWS = 5;
export const MESSAGE_ACTION_WIDTH = 9;
export const COMPOSER_ACTION_WIDTH = 10;

export function isGroupedWithPrevious(messages: ChatMessage[], index: number) {
  if (index === 0) return false;
  const prev = messages[index - 1]!;
  const curr = messages[index]!;
  if (prev.user.id !== curr.user.id) return false;
  return new Date(curr.createdAt).getTime() - new Date(prev.createdAt).getTime() < MESSAGE_GROUP_THRESHOLD_MS;
}

export function normalizeInlinePreview(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function formatInlinePreview(text: string, width: number) {
  return truncateWithEllipsis(normalizeInlinePreview(text), width);
}

function wrapTextLines(text: string, width: number) {
  const safeWidth = Math.max(width, 1);
  const lines: string[] = [];

  for (const paragraph of text.split("\n")) {
    let remaining = paragraph;
    if (remaining.length === 0) {
      lines.push("");
      continue;
    }

    while (remaining.length > safeWidth) {
      const candidate = remaining.slice(0, safeWidth + 1);
      const breakAt = candidate.lastIndexOf(" ");
      const lineEnd = breakAt > 0 ? breakAt : safeWidth;
      lines.push(remaining.slice(0, lineEnd).trimEnd());
      remaining = remaining.slice(lineEnd).trimStart();
    }

    lines.push(remaining);
  }

  return lines.length > 0 ? lines : [""];
}

export function getMessageBodyLines(message: ChatMessage, width: number) {
  const contentLineWidth = Math.max(width - 4, 1);
  return wrapTextLines(message.content, contentLineWidth);
}

export function estimateMessageHeight(message: ChatMessage, width: number, grouped = false) {
  const headerHeight = grouped ? 0 : 1;
  return headerHeight + (message.replyTo ? 1 : 0) + getMessageBodyLines(message, width).length;
}

export function estimateComposerHeight(text: string, width: number) {
  return Math.max(1, Math.min(CHAT_COMPOSER_MAX_ROWS, wrapTextLines(text, width).length));
}

export function getMessageTopOffset(messages: ChatMessage[], index: number, width: number) {
  let offset = 0;
  for (let i = 0; i < index; i += 1) {
    offset += estimateMessageHeight(messages[i]!, width, isGroupedWithPrevious(messages, i));
  }
  return offset;
}

export function hasPixelScrollMetrics(scrollBox: ScrollBoxRenderable | null) {
  return !!scrollBox?.scrollToPixels && typeof scrollBox.scrollHeightPx === "number" && !!scrollBox.viewportPx;
}

export function getScrollTop(scrollBox: ScrollBoxRenderable, preferPixels: boolean) {
  return preferPixels && typeof scrollBox.scrollTopPx === "number" ? scrollBox.scrollTopPx : scrollBox.scrollTop;
}

export function getScrollHeight(scrollBox: ScrollBoxRenderable, preferPixels: boolean) {
  return preferPixels && typeof scrollBox.scrollHeightPx === "number" ? scrollBox.scrollHeightPx : scrollBox.scrollHeight;
}

function getViewportHeight(scrollBox: ScrollBoxRenderable, preferPixels: boolean) {
  return preferPixels && scrollBox.viewportPx ? scrollBox.viewportPx.height : scrollBox.viewport?.height ?? 0;
}

export function scrollToPosition(scrollBox: ScrollBoxRenderable, target: number, preferPixels: boolean) {
  if (preferPixels && scrollBox.scrollToPixels) {
    scrollBox.scrollToPixels(target);
    return;
  }
  scrollBox.scrollTo(target);
}

export function scrollToBottom(scrollBox: ScrollBoxRenderable | null, preferPixels = false) {
  if (!scrollBox) return;
  const exactPixels = preferPixels && hasPixelScrollMetrics(scrollBox);
  scrollToPosition(
    scrollBox,
    Math.max(0, getScrollHeight(scrollBox, exactPixels) - getViewportHeight(scrollBox, exactPixels)),
    exactPixels,
  );
}

export function isScrolledToBottom(scrollBox: ScrollBoxRenderable | null, preferPixels = false) {
  if (!scrollBox) return true;
  const exactPixels = preferPixels && hasPixelScrollMetrics(scrollBox);
  const scrollTop = getScrollTop(scrollBox, exactPixels);
  const maxScrollTop = Math.max(0, getScrollHeight(scrollBox, exactPixels) - getViewportHeight(scrollBox, exactPixels));
  const threshold = exactPixels ? SCROLL_BOTTOM_THRESHOLD_PX : 0;
  return maxScrollTop - scrollTop <= threshold;
}

export function runAfterLayout(callback: () => void) {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(callback);
    return;
  }
  queueMicrotask(callback);
}

function getScrollTopForElementIntoView({
  scrollTop,
  viewportHeight,
  elementTop,
  elementHeight,
  bottomInset = 0,
}: {
  scrollTop: number;
  viewportHeight: number;
  elementTop: number;
  elementHeight: number;
  bottomInset?: number;
}) {
  const visibleHeight = Math.max(viewportHeight - bottomInset, 1);
  const elementBottom = elementTop + elementHeight;
  if (elementTop < scrollTop || elementHeight >= visibleHeight) return elementTop;
  if (elementBottom > scrollTop + visibleHeight) return elementBottom - visibleHeight;
  return scrollTop;
}

export function scrollElementIntoScrollBoxView(scrollBox: ScrollBoxRenderable | null, node: unknown) {
  const nodeRect = (node as { getBoundingClientRect?: () => { x?: number; y?: number; top?: number; width?: number; height?: number } } | null)
    ?.getBoundingClientRect?.();
  const scrollRect = scrollBox?.getBoundingClientRect?.() as { x?: number; y?: number; top?: number; width?: number; height?: number } | undefined;
  if (
    scrollBox &&
    nodeRect &&
    scrollRect &&
    scrollBox.scrollToPixels &&
    typeof scrollBox.scrollTopPx === "number" &&
    scrollBox.viewportPx
  ) {
    const nodeY = nodeRect.y ?? nodeRect.top ?? 0;
    const scrollY = scrollRect.y ?? scrollRect.top ?? 0;
    const elementTop = scrollBox.scrollTopPx + nodeY - scrollY;
    const nextScrollTop = getScrollTopForElementIntoView({
      scrollTop: scrollBox.scrollTopPx,
      viewportHeight: scrollBox.viewportPx.height,
      elementTop,
      elementHeight: Math.max(nodeRect.height ?? 0, 1),
    });
    if (nextScrollTop !== scrollBox.scrollTopPx) {
      scrollBox.scrollToPixels(nextScrollTop);
    }
    return true;
  }

  const scrollIntoView = (node as { scrollIntoView?: (options?: unknown) => void } | null)?.scrollIntoView;
  if (typeof scrollIntoView !== "function") return false;
  scrollIntoView.call(node, { block: "nearest", inline: "nearest" });
  return true;
}

export function getSelectedMessageScrollTop({
  scrollTop,
  viewportHeight,
  top,
  rowHeight,
  bottomInset = MESSAGE_SELECTION_BOTTOM_INSET,
}: {
  scrollTop: number;
  viewportHeight: number;
  top: number;
  rowHeight: number;
  bottomInset?: number;
}) {
  const safeViewportHeight = Math.max(viewportHeight, 1);
  const visibleMessageRows = Math.max(safeViewportHeight - bottomInset, 1);
  if (top < scrollTop) return top;
  if (top + rowHeight > scrollTop + visibleMessageRows) {
    return Math.max(top + rowHeight - visibleMessageRows, 0);
  }
  return scrollTop;
}
