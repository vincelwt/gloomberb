import { useEffect, useRef, useState, type ReactNode } from "react";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
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
    <box flexDirection="row" justifyContent="space-between" width="100%">
      <box flexDirection="row">
        <text fg={selected ? colors.selectedText : colors.textDim}>
          {selected ? "\u25b8 " : "  "}
        </text>
        <text
          fg={selected ? colors.text : colors.textDim}
          attributes={selected ? TextAttributes.BOLD : 0}
        >
          {item.label}
        </text>
      </box>
      {item.detail && (
        <text fg={selected ? colors.textMuted : colors.textMuted}>{item.detail}</text>
      )}
    </box>
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
      <box height={1}>
        <text fg={colors.textDim}>{emptyMessage}</text>
      </box>
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
      <box
        key={item.id}
        height={1}
        backgroundColor={rowBg}
        onMouseMove={() => {
          if (!disabled) setHoveredIndex(index);
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
      </box>
    );
  });

  return (
    <box flexDirection="column" height={height} flexGrow={flexGrow}>
      {scrollable ? (
        <scrollbox ref={scrollRef} height={height} flexGrow={flexGrow} scrollY focusable={false}>
          {rows}
        </scrollbox>
      ) : rows}

      {showSelectedDescription && selectedItem?.description && (
        <>
          <box height={1} />
          <box>
            <text fg={colors.textDim}>{"    "}{selectedItem.description}</text>
          </box>
        </>
      )}
    </box>
  );
}
