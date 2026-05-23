/** @jsxImportSource react */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Box, ScrollBox, Text, type ScrollBoxRenderable } from "../../../ui";
import { TextAttributes } from "../../../ui";
import type { ListRowState, ListViewItem, ListViewProps } from "../../../components/ui/list-view";
import { blendHex, colors, hoverBg } from "../../../theme/colors";
import { useThemeColors } from "../../../theme/theme-context";
import {
  CONTROL_RADIUS,
  panelBorder,
  selectedPanelFill,
  subtlePanelFill,
} from "./desktop-control-styles";

function DefaultDesktopRow({
  item,
  selected,
}: {
  item: ListViewItem;
  selected: boolean;
}) {
  return (
    <Box flexDirection="row" justifyContent="space-between" width="100%" alignItems="center">
      <Box flexDirection="row" alignItems="center" minWidth={0}>
        <Box
          width={1}
          height={1}
          marginRight={1}
          backgroundColor={selected ? colors.borderFocused : "transparent"}
          style={{ borderRadius: CONTROL_RADIUS }}
        />
        <Text
          fg={selected ? colors.text : colors.textDim}
          attributes={selected ? TextAttributes.BOLD : 0}
        >
          {item.label}
        </Text>
      </Box>
      {item.detail && (
        <Text fg={colors.textMuted}>
          {item.detail}
        </Text>
      )}
    </Box>
  );
}

function listRowStyle(selected: boolean): CSSProperties {
  return {
    borderRadius: CONTROL_RADIUS,
    border: `1px solid ${selected ? colors.borderFocused : "transparent"}`,
    boxShadow: selected ? `inset 0 1px 0 ${blendHex(colors.bg, colors.textBright, 0.06)}` : undefined,
    cursor: "pointer",
  };
}

export function WebListView({
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
  rowGap = 1,
  rowHeight = 1,
  surface = "framed",
  height,
  flexGrow,
  scrollable = false,
  autoScrollToIndex = true,
}: ListViewProps) {
  useThemeColors();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const baseBg = bgColor ?? colors.bg;
  const activeBg = selectedBgColor ?? selectedPanelFill();
  const rowHoverBg = hoverBgColor ?? hoverBg();
  const selectedItem = selectedIndex >= 0 ? items[selectedIndex] : undefined;
  const activeScrollIndex = scrollIndex ?? selectedIndex;

  useEffect(() => {
    if (!scrollable || !autoScrollToIndex || activeScrollIndex < 0) return;
    const scrollBox = scrollRef.current;
    if (!scrollBox) return;
    const safeIndex = Math.min(activeScrollIndex, items.length - 1);
    const viewportHeight = Math.max(scrollBox.viewport.height, 1);
    const rowTop = safeIndex * rowHeight;
    const rowBottom = rowTop + rowHeight;
    if (rowTop < scrollBox.scrollTop) {
      scrollBox.scrollTo(rowTop);
    } else if (rowBottom > scrollBox.scrollTop + viewportHeight) {
      scrollBox.scrollTo(rowBottom - viewportHeight);
    }
  }, [activeScrollIndex, autoScrollToIndex, items.length, rowHeight, scrollable]);

  useEffect(() => {
    if (!scrollable) return;
    const scrollBox = scrollRef.current;
    if (!scrollBox) return;
    scrollBox.verticalScrollBar.visible = items.length * rowHeight > scrollBox.viewport.height;
  }, [items.length, height, flexGrow, rowHeight, scrollable]);

  const rows = items.length === 0
    ? (
      <Box height={1}>
        <Text fg={colors.textDim}>{emptyMessage}</Text>
      </Box>
    )
    : items.map((item, index) => {
      const selected = index === selectedIndex;
      const hovered = index === hoveredIndex && !selected;
      const disabled = item.disabled === true;
      const state: ListRowState = { selected, hovered, disabled };
      const rowBg = getRowBackgroundColor?.(item, state, index)
        ?? (selected ? activeBg : hovered ? rowHoverBg : baseBg);

      return (
        <Box
          key={item.id}
          height={rowHeight}
          width="100%"
          backgroundColor={rowBg}
          alignItems="center"
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
          data-gloom-role="desktop-list-row"
          style={listRowStyle(selected)}
        >
          {renderRow
            ? renderRow(item, state, index)
            : <DefaultDesktopRow item={item} selected={selected} />}
        </Box>
      );
    });

  return (
    <Box flexDirection="column" height={height} flexGrow={flexGrow} gap={1}>
      {scrollable ? (
        <ScrollBox
          ref={scrollRef}
          height={height}
          flexGrow={flexGrow}
          scrollY
          focusable={false}
          style={surface === "plain"
            ? {
              border: "none",
              borderRadius: 0,
              padding: 0,
              backgroundColor: "transparent",
            }
            : {
              border: `1px solid ${panelBorder()}`,
              borderRadius: CONTROL_RADIUS,
              padding: 4,
              backgroundColor: subtlePanelFill(),
            }}
        >
          <Box flexDirection="column" gap={rowGap}>
            {rows}
          </Box>
        </ScrollBox>
      ) : (
        <Box flexDirection="column" gap={rowGap}>
          {rows}
        </Box>
      )}

      {showSelectedDescription && selectedItem?.description && (
        <Box
          flexDirection="row"
          backgroundColor={subtlePanelFill()}
          style={{
            border: `1px solid ${panelBorder()}`,
            borderRadius: CONTROL_RADIUS,
            paddingInline: 10,
          }}
        >
          <Text fg={colors.textDim}>
            {selectedItem.description}
          </Text>
        </Box>
      )}
    </Box>
  );
}
