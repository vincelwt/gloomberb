import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { colors, hoverBg } from "../theme/colors";
import { isBackNavigationKey } from "../utils/back-navigation";
import { formatTimeAgo } from "../utils/format";
import { ExternalLink, PageStackView } from "./ui";

export interface DetailFeedItem {
  id: string;
  eyebrow?: string;
  title: string;
  timestamp?: Date | string | null;
  preview?: string | null;
  detailTitle?: string;
  detailMeta?: string[];
  detailBody?: string | null;
  detailNote?: string | null;
}

interface DetailFeedViewProps {
  width: number;
  height: number;
  focused: boolean;
  items: DetailFeedItem[];
  selectedIdx: number;
  hoveredIdx: number | null;
  onSelect: (index: number) => void;
  onHover: (index: number) => void;
  helpText?: string;
  listVariant?: "comfortable" | "compact" | "single-line";
}

function truncateWithEllipsis(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width <= 3) return text.slice(0, width);
  return `${text.slice(0, width - 3)}...`;
}

function wrapTextLines(
  text: string,
  width: number,
  maxLines = Number.MAX_SAFE_INTEGER,
): string[] {
  if (width <= 0) return [];

  const paragraphs = text
    .split(/\r?\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim());
  const lines: string[] = [];

  const pushLine = (line: string) => {
    if (lines.length >= maxLines) return;
    lines.push(line);
  };

  for (
    let paragraphIndex = 0;
    paragraphIndex < paragraphs.length;
    paragraphIndex += 1
  ) {
    const paragraph = paragraphs[paragraphIndex]!;
    if (!paragraph) {
      pushLine("");
      continue;
    }

    let current = "";
    for (const rawWord of paragraph.split(" ")) {
      let word = rawWord;
      while (word.length > width) {
        const available = current ? width - current.length - 1 : width;
        if (available <= 0) {
          pushLine(current);
          current = "";
          continue;
        }
        if (word.length <= available) break;
        const piece = word.slice(0, available);
        word = word.slice(available);
        pushLine(current ? `${current} ${piece}` : piece);
        current = "";
      }

      if (!current) {
        current = word;
        continue;
      }

      if (current.length + 1 + word.length <= width) {
        current = `${current} ${word}`;
      } else {
        pushLine(current);
        current = word;
      }
    }

    if (current) pushLine(current);
    if (paragraphIndex < paragraphs.length - 1) pushLine("");
    if (lines.length >= maxLines) break;
  }

  if (lines.length > maxLines) {
    lines.length = maxLines;
  }
  if (
    lines.length === maxLines
    && paragraphs.join(" ").length > lines.join(" ").length
  ) {
    lines[maxLines - 1] = truncateWithEllipsis(
      lines[maxLines - 1] ?? "",
      width,
    );
  }

  return lines;
}

function contentWidth(value: number): number {
  return Math.max(value - 2, 12);
}

function lineOrBlank(lines: string[], index: number): string {
  return lines[index] ?? "";
}

export function DetailFeedView({
  width,
  height,
  focused,
  items,
  selectedIdx,
  hoveredIdx,
  onSelect,
  onHover,
  helpText = "j/k move  enter open",
  listVariant = "comfortable",
}: DetailFeedViewProps) {
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const listScrollRef = useRef<ScrollBoxRenderable>(null);
  const detailScrollRef = useRef<ScrollBoxRenderable>(null);
  const selected =
    items[Math.max(0, Math.min(selectedIdx, items.length - 1))] ?? null;
  const openItem = useMemo(
    () =>
      openItemId
        ? items.find((item) => item.id === openItemId) ?? null
        : null,
    [items, openItemId],
  );
  const footerHeight = helpText ? 1 : 0;
  const listHeight = Math.max(height - footerHeight, 6);
  const detailHeight = Math.max(height - 1, 4);
  const compactList = listVariant === "compact";
  const singleLineList = listVariant === "single-line";
  const listTextWidth = contentWidth(width);
  const detailTextWidth = contentWidth(width);
  const showPreviewLine =
    !singleLineList && listTextWidth >= (compactList ? 18 : 28);
  const cardHeight = compactList
    ? showPreviewLine
      ? 2
      : 1
    : singleLineList
      ? 1
      : showPreviewLine
        ? 4
        : 3;

  useEffect(() => {
    if (openItemId && !items.some((item) => item.id === openItemId)) {
      setOpenItemId(null);
    }
  }, [items, openItemId]);

  useEffect(() => {
    const scrollBox = listScrollRef.current;
    if (!scrollBox?.viewport || items.length === 0 || selectedIdx < 0) return;

    if (selectedIdx < scrollBox.scrollTop) {
      scrollBox.scrollTop = selectedIdx;
      return;
    }

    if (selectedIdx >= scrollBox.scrollTop + scrollBox.viewport.height) {
      scrollBox.scrollTop = Math.max(
        0,
        selectedIdx - scrollBox.viewport.height + 1,
      );
    }
  }, [items.length, selectedIdx]);

  useEffect(() => {
    if (!openItemId) return;
    const scrollBox = detailScrollRef.current;
    if (scrollBox) {
      scrollBox.scrollTop = 0;
    }
  }, [openItemId]);

  const openSelectedItem = () => {
    if (!selected) return;
    setOpenItemId(selected.id);
  };

  const scrollDetailBy = (delta: number) => {
    const scrollBox = detailScrollRef.current;
    if (!scrollBox?.viewport) return;
    const maxScrollTop = Math.max(
      0,
      scrollBox.scrollHeight - scrollBox.viewport.height,
    );
    scrollBox.scrollTop = Math.max(
      0,
      Math.min(maxScrollTop, scrollBox.scrollTop + delta),
    );
  };

  useKeyboard((event) => {
    if (!focused || items.length === 0) return;

    if (openItem) {
      if (isBackNavigationKey(event)) {
        event.stopPropagation?.();
        event.preventDefault?.();
        setOpenItemId(null);
      } else if (event.name === "j" || event.name === "down") {
        event.stopPropagation?.();
        event.preventDefault?.();
        scrollDetailBy(1);
      } else if (event.name === "k" || event.name === "up") {
        event.stopPropagation?.();
        event.preventDefault?.();
        scrollDetailBy(-1);
      }
      return;
    }

    if (event.name === "j" || event.name === "down") {
      event.stopPropagation?.();
      event.preventDefault?.();
      onSelect(Math.min(selectedIdx + 1, items.length - 1));
      return;
    }

    if (event.name === "k" || event.name === "up") {
      event.stopPropagation?.();
      event.preventDefault?.();
      onSelect(Math.max(selectedIdx - 1, 0));
      return;
    }

    if (event.name === "enter" || event.name === "return") {
      event.stopPropagation?.();
      event.preventDefault?.();
      openSelectedItem();
    }
  });

  const rootContent = (
    <box flexDirection="column" flexGrow={1} paddingX={1}>
      <scrollbox ref={listScrollRef} height={listHeight} scrollY>
        <box flexDirection="column">
          {items.map((item, index) => {
            const isSelected = index === selectedIdx;
            const isHovered = index === hoveredIdx && !isSelected;
            const titleLines = wrapTextLines(
              item.title,
              listTextWidth,
              compactList ? 1 : 2,
            );
            const previewLine = item.preview
              ? truncateWithEllipsis(item.preview, listTextWidth)
              : "";
            const timestampText = item.timestamp
              ? formatTimeAgo(item.timestamp)
              : "";
            const inlineEyebrow = item.eyebrow ? `${item.eyebrow} | ` : "";
            const compactTitleWidth = Math.max(
              listTextWidth - (timestampText ? timestampText.length + 1 : 0),
              8,
            );
            const compactTitle = truncateWithEllipsis(
              `${inlineEyebrow}${item.title}`,
              compactTitleWidth,
            );
            const singleLineTitle = truncateWithEllipsis(
              item.title,
              compactTitleWidth,
            );

            return (
              <box
                key={item.id}
                flexDirection="column"
                height={cardHeight}
                paddingX={1}
                backgroundColor={
                  isSelected
                    ? colors.selected
                    : isHovered
                      ? hoverBg()
                      : colors.bg
                }
                onMouseMove={() => onHover(index)}
                onMouseDown={() => {
                  onSelect(index);
                  setOpenItemId(item.id);
                }}
              >
                {singleLineList ? (
                  <box flexDirection="row" height={1}>
                    <box flexGrow={1}>
                      <text
                        attributes={isSelected ? TextAttributes.BOLD : 0}
                        fg={
                          isSelected
                            ? colors.selectedText
                            : colors.textBright
                        }
                      >
                        {singleLineTitle}
                      </text>
                    </box>
                    {timestampText ? (
                      <text fg={colors.textDim}>{timestampText}</text>
                    ) : null}
                  </box>
                ) : compactList ? (
                  <>
                    <box flexDirection="row" height={1}>
                      <box flexGrow={1}>
                        <text
                          attributes={isSelected ? TextAttributes.BOLD : 0}
                          fg={
                            isSelected
                              ? colors.selectedText
                              : colors.textBright
                          }
                        >
                          {compactTitle}
                        </text>
                      </box>
                      {timestampText ? (
                        <text fg={colors.textDim}>{timestampText}</text>
                      ) : null}
                    </box>
                    {showPreviewLine ? (
                      <box height={1}>
                        <text fg={colors.textMuted}>
                          {previewLine
                            || truncateWithEllipsis(
                              item.eyebrow ?? "",
                              listTextWidth,
                            )}
                        </text>
                      </box>
                    ) : null}
                  </>
                ) : (
                  <>
                    <box flexDirection="row" height={1}>
                      <box flexGrow={1}>
                        <text fg={colors.textMuted}>
                          {truncateWithEllipsis(
                            item.eyebrow ?? "",
                            listTextWidth,
                          )}
                        </text>
                      </box>
                      {timestampText ? (
                        <text fg={colors.textDim}>{timestampText}</text>
                      ) : null}
                    </box>
                    <box height={1}>
                      <text
                        attributes={isSelected ? TextAttributes.BOLD : 0}
                        fg={
                          isSelected
                            ? colors.selectedText
                            : colors.textBright
                        }
                      >
                        {lineOrBlank(titleLines, 0)}
                      </text>
                    </box>
                    <box height={1}>
                      <text fg={isSelected ? colors.selectedText : colors.text}>
                        {lineOrBlank(titleLines, 1)}
                      </text>
                    </box>
                    {showPreviewLine ? (
                      <box height={1}>
                        <text fg={colors.textMuted}>{previewLine}</text>
                      </box>
                    ) : null}
                  </>
                )}
              </box>
            );
          })}
        </box>
      </scrollbox>

      {helpText ? (
        <box height={1}>
          <text fg={colors.textMuted}>{helpText}</text>
        </box>
      ) : null}
    </box>
  );

  const detailContent = openItem ? (
    <box flexDirection="column" flexGrow={1} paddingX={1}>
      <scrollbox ref={detailScrollRef} height={detailHeight} scrollY>
        <box flexDirection="column">
          {wrapTextLines(
            openItem.detailTitle ?? openItem.title,
            detailTextWidth,
            4,
          ).map((line, index) => (
            <box key={`title-${index}`} height={1}>
              <text attributes={TextAttributes.BOLD} fg={colors.textBright}>
                {line}
              </text>
            </box>
          ))}

          {(openItem.detailMeta ?? [])
            .flatMap((entry) => wrapTextLines(entry, detailTextWidth, 2))
            .map((line, index) => (
              <box key={`meta-${index}`} height={1}>
                <text fg={colors.textMuted}>{line}</text>
              </box>
            ))}

          <box height={1} />

          {wrapTextLines(openItem.detailBody ?? "", detailTextWidth).map(
            (line, index) => (
              <box key={`body-${index}`} height={1}>
                <text fg={colors.text}>{line}</text>
              </box>
            ),
          )}

          {openItem.detailNote ? (
            <>
              <box height={1} />
              {wrapTextLines(openItem.detailNote, detailTextWidth).map(
                (line, index) =>
                  /^https?:\/\/\S+$/.test(line.trim()) ? (
                    <ExternalLink key={`note-${index}`} url={line.trim()} />
                  ) : (
                    <box key={`note-${index}`} height={1}>
                      <text fg={colors.textDim}>{line}</text>
                    </box>
                  ),
              )}
            </>
          ) : null}
        </box>
      </scrollbox>
    </box>
  ) : (
    <box flexGrow={1} />
  );

  return (
    <PageStackView
      focused={focused}
      detailOpen={!!openItem}
      onBack={() => setOpenItemId(null)}
      rootContent={rootContent}
      detailContent={detailContent}
    />
  );
}
