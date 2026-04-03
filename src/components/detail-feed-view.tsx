import { TextAttributes } from "@opentui/core";
import { colors, hoverBg } from "../theme/colors";
import { formatTimeAgo } from "../utils/format";
import { ExternalLink } from "./ui";

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
  items: DetailFeedItem[];
  selectedIdx: number;
  hoveredIdx: number | null;
  onSelect: (index: number) => void;
  onHover: (index: number) => void;
  helpText?: string;
  listVariant?: "comfortable" | "compact" | "single-line";
  splitListWidthRatio?: number;
}

function truncateWithEllipsis(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width <= 3) return text.slice(0, width);
  return `${text.slice(0, width - 3)}...`;
}

function wrapTextLines(text: string, width: number, maxLines = Number.MAX_SAFE_INTEGER): string[] {
  if (width <= 0) return [];

  const paragraphs = text
    .split(/\r?\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim());
  const lines: string[] = [];

  const pushLine = (line: string) => {
    if (lines.length >= maxLines) return;
    lines.push(line);
  };

  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
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

      if ((current.length + 1 + word.length) <= width) {
        current = `${current} ${word}`;
      } else {
        pushLine(current);
        current = word;
      }
    }

    if (current) pushLine(current);
    if (paragraphIndex < (paragraphs.length - 1)) pushLine("");
    if (lines.length >= maxLines) break;
  }

  if (lines.length > maxLines) {
    lines.length = maxLines;
  }
  if (lines.length === maxLines && paragraphs.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = truncateWithEllipsis(lines[maxLines - 1] ?? "", width);
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
  items,
  selectedIdx,
  hoveredIdx,
  onSelect,
  onHover,
  helpText = "j/k navigate",
  listVariant = "comfortable",
  splitListWidthRatio = 0.38,
}: DetailFeedViewProps) {
  const selected = items[Math.max(0, Math.min(selectedIdx, items.length - 1))];
  const split = width >= 92 && height >= 14;
  const footerHeight = helpText ? 1 : 0;
  const availableHeight = Math.max(height - footerHeight, 6);
  const compactList = listVariant === "compact";
  const singleLineList = listVariant === "single-line";
  const listWidth = split ? Math.max(28, Math.min(Math.floor(width * splitListWidthRatio), 44)) : Math.max(width - 2, 20);
  const detailWidth = split ? Math.max(width - listWidth - 4, 28) : Math.max(width - 2, 20);
  const listHeight = split ? availableHeight : Math.max(5, Math.floor((availableHeight - 1) * 0.45));
  const detailHeight = split ? availableHeight : Math.max(3, availableHeight - listHeight - 1);
  const listTextWidth = contentWidth(listWidth);
  const detailTextWidth = contentWidth(detailWidth);
  const showPreviewLine = !singleLineList && listTextWidth >= (compactList ? 18 : 28);
  const cardHeight = compactList
    ? (showPreviewLine ? 2 : 1)
    : singleLineList
      ? 1
    : (showPreviewLine ? 4 : 3);

  return (
    <box flexDirection="column" flexGrow={1} paddingX={1}>
      <box flexDirection={split ? "row" : "column"} gap={1}>
        <box width={split ? listWidth : undefined}>
          <scrollbox height={listHeight} scrollY>
            <box flexDirection="column">
              {items.map((item, index) => {
                const isSelected = index === selectedIdx;
                const isHovered = index === hoveredIdx && !isSelected;
                const titleLines = wrapTextLines(item.title, listTextWidth, compactList ? 1 : 2);
                const previewLine = item.preview ? truncateWithEllipsis(item.preview, listTextWidth) : "";
                const timestampText = item.timestamp ? formatTimeAgo(item.timestamp) : "";
                const inlineEyebrow = item.eyebrow ? `${item.eyebrow} | ` : "";
                const compactTitleWidth = Math.max(listTextWidth - (timestampText ? timestampText.length + 1 : 0), 8);
                const compactTitle = truncateWithEllipsis(`${inlineEyebrow}${item.title}`, compactTitleWidth);
                const singleLineTitle = truncateWithEllipsis(item.title, compactTitleWidth);
                return (
                  <box
                    key={item.id}
                    flexDirection="column"
                    height={cardHeight}
                    paddingX={1}
                    backgroundColor={isSelected ? colors.selected : isHovered ? hoverBg() : colors.bg}
                    onMouseMove={() => onHover(index)}
                    onMouseDown={() => onSelect(index)}
                  >
                    {singleLineList ? (
                      <box flexDirection="row" height={1}>
                        <box flexGrow={1}>
                          <text
                            attributes={isSelected ? TextAttributes.BOLD : 0}
                            fg={isSelected ? colors.selectedText : colors.textBright}
                          >
                            {singleLineTitle}
                          </text>
                        </box>
                        {timestampText && (
                          <text fg={colors.textDim}>{timestampText}</text>
                        )}
                      </box>
                    ) : compactList ? (
                      <>
                        <box flexDirection="row" height={1}>
                          <box flexGrow={1}>
                            <text
                              attributes={isSelected ? TextAttributes.BOLD : 0}
                              fg={isSelected ? colors.selectedText : colors.textBright}
                            >
                              {compactTitle}
                            </text>
                          </box>
                          {timestampText && (
                            <text fg={colors.textDim}>{timestampText}</text>
                          )}
                        </box>
                        {showPreviewLine && (
                          <box height={1}>
                            <text fg={colors.textMuted}>
                              {previewLine || truncateWithEllipsis(item.eyebrow ?? "", listTextWidth)}
                            </text>
                          </box>
                        )}
                      </>
                    ) : (
                      <>
                        <box flexDirection="row" height={1}>
                          <box flexGrow={1}>
                            <text fg={colors.textMuted}>{truncateWithEllipsis(item.eyebrow ?? "", listTextWidth)}</text>
                          </box>
                          {timestampText && (
                            <text fg={colors.textDim}>{timestampText}</text>
                          )}
                        </box>
                        <box height={1}>
                          <text
                            attributes={isSelected ? TextAttributes.BOLD : 0}
                            fg={isSelected ? colors.selectedText : colors.textBright}
                          >
                            {lineOrBlank(titleLines, 0)}
                          </text>
                        </box>
                        <box height={1}>
                          <text fg={isSelected ? colors.selectedText : colors.text}>
                            {lineOrBlank(titleLines, 1)}
                          </text>
                        </box>
                        {showPreviewLine && (
                          <box height={1}>
                            <text fg={colors.textMuted}>{previewLine}</text>
                          </box>
                        )}
                      </>
                    )}
                  </box>
                );
              })}
            </box>
          </scrollbox>
        </box>

        <box width={split ? detailWidth : undefined} flexGrow={1}>
          <scrollbox height={detailHeight} scrollY>
            {selected ? (
              <box flexDirection="column">
                {wrapTextLines(selected.detailTitle ?? selected.title, detailTextWidth, 4).map((line, index) => (
                  <box key={`title-${index}`} height={1}>
                    <text attributes={TextAttributes.BOLD} fg={colors.textBright}>{line}</text>
                  </box>
                ))}

                {(selected.detailMeta ?? []).flatMap((entry) => wrapTextLines(entry, detailTextWidth, 2)).map((line, index) => (
                  <box key={`meta-${index}`} height={1}>
                    <text fg={colors.textMuted}>{line}</text>
                  </box>
                ))}

                <box height={1} />

                {wrapTextLines(selected.detailBody ?? "", detailTextWidth).map((line, index) => (
                  <box key={`body-${index}`} height={1}>
                    <text fg={colors.text}>{line}</text>
                  </box>
                ))}

                {selected.detailNote && (
                  <>
                    <box height={1} />
                    {wrapTextLines(selected.detailNote, detailTextWidth).map((line, index) =>
                      /^https?:\/\/\S+$/.test(line.trim()) ? (
                        <ExternalLink key={`note-${index}`} url={line.trim()} />
                      ) : (
                        <box key={`note-${index}`} height={1}>
                          <text fg={colors.textDim}>{line}</text>
                        </box>
                      )
                    )}
                  </>
                )}
              </box>
            ) : (
              <text fg={colors.textDim}>Nothing selected.</text>
            )}
          </scrollbox>
        </box>
      </box>

      {helpText && (
        <box height={1}>
          <text fg={colors.textMuted}>{helpText}</text>
        </box>
      )}
    </box>
  );
}
