import { Box, ScrollBox, Text, useUiHost } from "../../ui";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { TextAttributes, type ScrollBoxRenderable } from "../../ui";
import { colors, hoverBg } from "../../theme/colors";

export interface ListViewItem {
  id: string;
  label: string;
  description?: string;
  detail?: string;
  disabled?: boolean;
}

export interface ListRowState {
  selected: boolean;
  hovered: boolean;
  disabled: boolean;
}

export interface ListViewProps {
  items: ListViewItem[];
  selectedIndex: number;
  scrollIndex?: number;
  onSelect?: (index: number) => void;
  onActivate?: (item: ListViewItem, index: number) => void;
  renderRow?: (item: ListViewItem, state: ListRowState, index: number) => ReactNode;
  getRowBackgroundColor?: (item: ListViewItem, state: ListRowState, index: number) => string | undefined;
  showSelectedDescription?: boolean;
  emptyMessage?: string;
  bgColor?: string;
  selectedBgColor?: string;
  hoverBgColor?: string;
  height?: number;
  flexGrow?: number;
  scrollable?: boolean;
  autoScrollToIndex?: boolean;
}

function DefaultRow({
  item,
  selected,
}: {
  item: ListViewItem;
  selected: boolean;
}) {
  return (
    <Box flexDirection="row" justifyContent="space-between" width="100%">
      <Box flexDirection="row">
        <Text fg={selected ? colors.selectedText : colors.textDim}>
          {selected ? "\u25b8 " : "  "}
        </Text>
        <Text
          fg={selected ? colors.text : colors.textDim}
          attributes={selected ? TextAttributes.BOLD : 0}
        >
          {item.label}
        </Text>
      </Box>
      {item.detail && (
        <Text fg={selected ? colors.textMuted : colors.textMuted}>{item.detail}</Text>
      )}
    </Box>
  );
}

export function ListView({
  items,
  selectedIndex,
  scrollIndex,
  onSelect,
  onActivate,
  renderRow,
  getRowBackgroundColor,
  showSelectedDescription = false,
  emptyMessage = "Nothing to show.",
  bgColor,
  selectedBgColor,
  hoverBgColor,
  height,
  flexGrow,
  scrollable = false,
  autoScrollToIndex = true,
}: ListViewProps) {
  const HostListView = useUiHost().ListView as ComponentType<ListViewProps> | undefined;
  if (HostListView) {
    return (
      <HostListView
        items={items}
        selectedIndex={selectedIndex}
        scrollIndex={scrollIndex}
        onSelect={onSelect}
        onActivate={onActivate}
        renderRow={renderRow}
        getRowBackgroundColor={getRowBackgroundColor}
        showSelectedDescription={showSelectedDescription}
        emptyMessage={emptyMessage}
        bgColor={bgColor}
        selectedBgColor={selectedBgColor}
        hoverBgColor={hoverBgColor}
        height={height}
        flexGrow={flexGrow}
        scrollable={scrollable}
        autoScrollToIndex={autoScrollToIndex}
      />
    );
  }

  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const baseBg = bgColor ?? colors.bg;
  const activeBg = selectedBgColor ?? colors.selected;
  const rowHoverBg = hoverBgColor ?? hoverBg();
  const selectedItem = selectedIndex >= 0 ? items[selectedIndex] : undefined;
  const activeScrollIndex = scrollIndex ?? selectedIndex;

  useEffect(() => {
    if (!scrollable || !autoScrollToIndex || activeScrollIndex < 0) return;
    const sb = scrollRef.current;
    if (!sb) return;
    const safeIndex = Math.min(activeScrollIndex, items.length - 1);
    const viewportH = Math.max(sb.viewport.height, 1);
    if (safeIndex < sb.scrollTop) {
      sb.scrollTo(safeIndex);
    } else if (safeIndex >= sb.scrollTop + viewportH) {
      sb.scrollTo(safeIndex - viewportH + 1);
    }
  }, [activeScrollIndex, autoScrollToIndex, items.length, scrollable]);

  useEffect(() => {
    if (!scrollable) return;
    const sb = scrollRef.current;
    if (!sb) return;
    sb.verticalScrollBar.visible = items.length > sb.viewport.height;
  }, [items.length, height, flexGrow, scrollable]);

  if (items.length === 0) {
    return (
      <Box height={1}>
        <Text fg={colors.textDim}>{emptyMessage}</Text>
      </Box>
    );
  }

  const rows = items.map((item, index) => {
    const selected = index === selectedIndex;
    const hovered = index === hoveredIndex && !selected;
    const disabled = item.disabled === true;
    const state = { selected, hovered, disabled };
    const rowBg = getRowBackgroundColor?.(item, state, index)
      ?? (selected ? activeBg : hovered ? rowHoverBg : baseBg);

    return (
      <Box
        key={item.id}
        height={1}
        backgroundColor={rowBg}
        onMouseMove={() => {
          if (!disabled) {
            setHoveredIndex((current) => (current === index ? current : index));
          }
        }}
        onMouseDown={() => {
          if (disabled) return;
          onSelect?.(index);
          onActivate?.(item, index);
        }}
      >
        {renderRow
          ? renderRow(item, state, index)
          : <DefaultRow item={item} selected={selected} />}
      </Box>
    );
  });

  return (
    <Box flexDirection="column" height={height} flexGrow={flexGrow}>
      {scrollable ? (
        <ScrollBox ref={scrollRef} height={height} flexGrow={flexGrow} scrollY focusable={false}>
          {rows}
        </ScrollBox>
      ) : rows}

      {showSelectedDescription && selectedItem?.description && (
        <>
          <Box height={1} />
          <Box>
            <Text fg={colors.textDim}>{"    "}{selectedItem.description}</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
