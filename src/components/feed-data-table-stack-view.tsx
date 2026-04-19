import { Box, ScrollBox, Text } from "../ui";
import { TextAttributes, type ScrollBoxRenderable } from "../ui";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { colors } from "../theme/colors";
import { formatTimeAgo } from "../utils/format";
import { toTimestampMillis } from "../utils/timestamp";
import { DataTableStackView } from "./data-table-stack-view";
import { ExternalLink, type DataTableCell, type DataTableColumn } from "./ui";

export interface FeedDataTableItem {
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

type DetailColumnId = "time" | "source" | "title";
type DetailColumn = DataTableColumn & { id: DetailColumnId };

interface DetailRow {
  item: FeedDataTableItem;
  itemIndex: number;
}

interface SortPreference {
  columnId: DetailColumnId;
  direction: "asc" | "desc";
}

interface FeedDataTableStackViewProps {
  width: number;
  height: number;
  focused: boolean;
  items: FeedDataTableItem[];
  selectedIdx: number;
  onSelect: (index: number) => void;
  rootBefore?: ReactNode;
  rootAfter?: ReactNode;
  onRootKeyDown?: (event: {
    name?: string;
    preventDefault?: () => void;
    stopPropagation?: () => void;
  }) => boolean | void;
  sourceLabel?: string;
  titleLabel?: string;
  emptyStateTitle?: string;
  emptyStateHint?: string;
  isItemRead?: (item: FeedDataTableItem) => boolean;
  onOpenItem?: (item: FeedDataTableItem, index: number) => void;
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

function timestampValue(item: FeedDataTableItem): number {
  if (!item.timestamp) return 0;
  const timestamp = toTimestampMillis(item.timestamp);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, "en-US", { sensitivity: "base" });
}

function compareRows(a: DetailRow, b: DetailRow, columnId: DetailColumnId) {
  switch (columnId) {
    case "time":
      return timestampValue(a.item) - timestampValue(b.item);
    case "source":
      return compareText(a.item.eyebrow ?? "", b.item.eyebrow ?? "");
    case "title":
      return compareText(a.item.title, b.item.title);
  }
}

function nextSortPreference(
  current: SortPreference,
  columnId: DetailColumnId,
): SortPreference {
  if (current.columnId === columnId) {
    return {
      columnId,
      direction: current.direction === "asc" ? "desc" : "asc",
    };
  }

  return {
    columnId,
    direction: columnId === "time" ? "desc" : "asc",
  };
}

function buildColumns(
  width: number,
  sourceLabel: string,
  titleLabel: string,
  items: FeedDataTableItem[],
): DetailColumn[] {
  const timeWidth = 8;
  const sourceWidth = Math.min(
    Math.max(
      sourceLabel.length,
      ...items.map((item) => item.eyebrow?.length ?? 0),
      6,
    ),
    14,
  );
  const titleWidth = Math.max(
    16,
    width - (timeWidth + 1) - (sourceWidth + 1) - 3,
  );

  return [
    { id: "time", label: "Time", width: timeWidth, align: "left" },
    { id: "source", label: sourceLabel, width: sourceWidth, align: "left" },
    { id: "title", label: titleLabel, width: titleWidth, align: "left" },
  ];
}

export function FeedDataTableStackView({
  width,
  height,
  focused,
  items,
  selectedIdx,
  onSelect,
  rootBefore,
  rootAfter,
  onRootKeyDown,
  sourceLabel = "Source",
  titleLabel = "Headline",
  emptyStateTitle = "No items.",
  emptyStateHint,
  isItemRead,
  onOpenItem,
}: FeedDataTableStackViewProps) {
  const [sortPreference, setSortPreference] = useState<SortPreference>({
    columnId: "time",
    direction: "desc",
  });
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const detailScrollRef = useRef<ScrollBoxRenderable>(null);
  const detailTextWidth = Math.max(width - 2, 12);
  const columns = useMemo(
    () => buildColumns(width, sourceLabel, titleLabel, items),
    [items, sourceLabel, titleLabel, width],
  );
  const sortedRows = useMemo(() => {
    const direction = sortPreference.direction === "asc" ? 1 : -1;
    return items
      .map((item, itemIndex) => ({ item, itemIndex }))
      .sort((a, b) => {
        const primary = compareRows(a, b, sortPreference.columnId) * direction;
        return primary !== 0 ? primary : a.itemIndex - b.itemIndex;
      });
  }, [items, sortPreference]);
  const selectedRowIndex = sortedRows.findIndex(
    (row) => row.itemIndex === selectedIdx,
  );
  const activeRowIndex =
    selectedRowIndex >= 0 ? selectedRowIndex : sortedRows.length > 0 ? 0 : -1;
  const openItem = useMemo(
    () =>
      openItemId
        ? items.find((item) => item.id === openItemId) ?? null
        : null,
    [items, openItemId],
  );

  const scrollDetailBy = useCallback((delta: number) => {
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
  }, []);

  const openRow = useCallback((row: DetailRow | undefined) => {
    if (!row) return;
    onOpenItem?.(row.item, row.itemIndex);
    setOpenItemId(row.item.id);
  }, [onOpenItem]);

  useEffect(() => {
    if (openItemId && !openItem) {
      setOpenItemId(null);
    }
  }, [openItem, openItemId]);

  useEffect(() => {
    if (!openItemId) return;
    const scrollBox = detailScrollRef.current;
    if (scrollBox) scrollBox.scrollTop = 0;
  }, [openItemId]);

  useEffect(() => {
    if (items.length > 0 && selectedIdx >= items.length) {
      onSelect(Math.max(0, items.length - 1));
    }
  }, [items.length, onSelect, selectedIdx]);

  const renderCell = useCallback((
    row: DetailRow,
    column: DetailColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "time":
        return {
          text: row.item.timestamp ? formatTimeAgo(row.item.timestamp) : "",
          color: selectedColor ?? colors.textDim,
        };
      case "source":
        return {
          text: row.item.eyebrow ?? "",
          color: selectedColor ?? colors.textMuted,
        };
      case "title":
        return {
          text: row.item.title,
          color: selectedColor ?? colors.text,
          attributes: isItemRead
            ? isItemRead(row.item)
              ? TextAttributes.NONE
              : TextAttributes.BOLD
            : rowState.selected
              ? TextAttributes.BOLD
              : TextAttributes.NONE,
        };
    }
  }, [isItemRead]);

  const handleDetailKeyDown = useCallback((event: {
    name?: string;
    preventDefault?: () => void;
    stopPropagation?: () => void;
  }) => {
    if (event.name === "j" || event.name === "down") {
      event.stopPropagation?.();
      event.preventDefault?.();
      scrollDetailBy(1);
      return true;
    }
    if (event.name === "k" || event.name === "up") {
      event.stopPropagation?.();
      event.preventDefault?.();
      scrollDetailBy(-1);
      return true;
    }
    return false;
  }, [scrollDetailBy]);

  const detailContent = openItem ? (
    <Box
      flexDirection="column"
      flexGrow={1}
      flexBasis={0}
      minHeight={0}
      overflow="hidden"
      paddingX={1}
      paddingY={1}
    >
      <ScrollBox
        ref={detailScrollRef}
        flexGrow={1}
        flexBasis={0}
        minHeight={0}
        scrollY
        focusable={false}
      >
        <Box flexDirection="column">
          {(openItem.detailMeta ?? [])
            .flatMap((entry) => wrapTextLines(entry, detailTextWidth, 2))
            .map((line, index) => (
              <Box key={`meta-${index}`} height={1}>
                <Text fg={colors.textMuted}>{line}</Text>
              </Box>
            ))}

          <Box height={1} />

          {wrapTextLines(openItem.detailBody ?? "", detailTextWidth).map(
            (line, index) => (
              <Box key={`body-${index}`} height={1}>
                <Text fg={colors.text}>{line}</Text>
              </Box>
            ),
          )}

          {openItem.detailNote ? (
            <>
              <Box height={1} />
              {wrapTextLines(openItem.detailNote, detailTextWidth).map(
                (line, index) =>
                  /^https?:\/\/\S+$/.test(line.trim()) ? (
                    <ExternalLink key={`note-${index}`} url={line.trim()} />
                  ) : (
                    <Box key={`note-${index}`} height={1}>
                      <Text fg={colors.textDim}>{line}</Text>
                    </Box>
                  ),
              )}
            </>
          ) : null}
        </Box>
      </ScrollBox>
    </Box>
  ) : (
    <Box flexGrow={1} />
  );

  return (
    <DataTableStackView<DetailRow, DetailColumn>
      focused={focused}
      detailOpen={!!openItem}
      onBack={() => setOpenItemId(null)}
      detailContent={detailContent}
      detailTitle={openItem ? openItem.detailTitle ?? openItem.title : undefined}
      selectedIndex={activeRowIndex}
      onSelectIndex={(_index, row) => onSelect(row.itemIndex)}
      onActivateIndex={(_index, row) => openRow(row)}
      rootBefore={rootBefore}
      rootAfter={rootAfter}
      rootWidth={width}
      rootHeight={height}
      onRootKeyDown={onRootKeyDown}
      onDetailKeyDown={handleDetailKeyDown}
      columns={columns}
      items={sortedRows}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={(columnId) =>
        setSortPreference((current) =>
          nextSortPreference(current, columnId as DetailColumnId)
        )}
      getItemKey={(row) => row.item.id}
      isSelected={(row, index) =>
        row.itemIndex === selectedIdx || (selectedIdx < 0 && index === 0)
      }
      onSelect={(row) => onSelect(row.itemIndex)}
      onActivate={openRow}
      renderCell={renderCell}
      emptyStateTitle={emptyStateTitle}
      emptyStateHint={emptyStateHint}
      showHorizontalScrollbar={false}
    />
  );
}
