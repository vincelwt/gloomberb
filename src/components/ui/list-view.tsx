import { useState, type ReactNode } from "react";
import { TextAttributes } from "@opentui/core";
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
  onSelect?: (index: number) => void;
  onActivate?: (item: ListViewItem, index: number) => void;
  renderRow?: (item: ListViewItem, state: ListRowState) => ReactNode;
  showSelectedDescription?: boolean;
  emptyMessage?: string;
  bgColor?: string;
  selectedBgColor?: string;
  hoverBgColor?: string;
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
  onSelect,
  onActivate,
  renderRow,
  showSelectedDescription = false,
  emptyMessage = "Nothing to show.",
  bgColor,
  selectedBgColor,
  hoverBgColor,
}: ListViewProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const baseBg = bgColor ?? colors.bg;
  const activeBg = selectedBgColor ?? colors.selected;
  const rowHoverBg = hoverBgColor ?? hoverBg();
  const selectedItem = items[selectedIndex];

  if (items.length === 0) {
    return (
      <box height={1}>
        <text fg={colors.textDim}>{emptyMessage}</text>
      </box>
    );
  }

  return (
    <box flexDirection="column">
      {items.map((item, index) => {
        const selected = index === selectedIndex;
        const hovered = index === hoveredIndex && !selected;
        const disabled = item.disabled === true;

        return (
          <box
            key={item.id}
            height={1}
            backgroundColor={selected ? activeBg : hovered ? rowHoverBg : baseBg}
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
              ? renderRow(item, { selected, hovered, disabled })
              : <DefaultRow item={item} selected={selected} />}
          </box>
        );
      })}

      {showSelectedDescription && selectedItem?.description && (
        <>
          <box height={1} />
          <box height={1}>
            <text fg={colors.textDim}>{"    "}{selectedItem.description}</text>
          </box>
        </>
      )}
    </box>
  );
}
