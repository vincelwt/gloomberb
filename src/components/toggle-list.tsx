import { TextAttributes } from "@opentui/core";
import { colors } from "../theme/colors";
import { ListView, type ListViewItem } from "./ui/list-view";

export interface ToggleListItem {
  id: string;
  label: string;
  enabled: boolean;
  description?: string;
}

export interface ToggleListProps {
  items: ToggleListItem[];
  selectedIdx: number;
  onToggle?: (id: string) => void;
  onSelect?: (idx: number) => void;
  /** Background color for non-selected rows (defaults to colors.bg) */
  bgColor?: string;
  height?: number;
  flexGrow?: number;
  scrollable?: boolean;
  showSelectedDescription?: boolean;
  rowIdPrefix?: string;
}

export function ToggleList({
  items,
  selectedIdx,
  onToggle,
  onSelect,
  bgColor,
  height,
  flexGrow,
  scrollable,
  showSelectedDescription = true,
  rowIdPrefix,
}: ToggleListProps) {
  const listItems: ListViewItem[] = items.map((item) => ({
    id: item.id,
    label: item.label,
    description: item.description,
  }));

  return (
    <ListView
      items={listItems}
      selectedIndex={selectedIdx}
      bgColor={bgColor ?? colors.bg}
      showSelectedDescription={showSelectedDescription}
      height={height}
      flexGrow={flexGrow}
      scrollable={scrollable}
      onSelect={onSelect}
      onActivate={(item) => {
        onToggle?.(item.id);
      }}
      renderRow={(item, state, index) => {
        const toggleItem = items.find((entry) => entry.id === item.id);
        const checked = toggleItem?.enabled ? "\u2713" : " ";
        const activate = (event: any) => {
          event.stopPropagation?.();
          if (state.disabled) return;
          onSelect?.(index);
          onToggle?.(item.id);
        };
        return (
          <box
            id={rowIdPrefix ? `${rowIdPrefix}:${item.id}` : undefined}
            flexDirection="row"
            onMouseDown={activate}
          >
            <text fg={state.selected ? colors.selectedText : colors.textDim}>
              {state.selected ? "\u25b8 " : "  "}
            </text>
            <text
              fg={state.selected ? colors.text : colors.textDim}
              attributes={state.selected ? TextAttributes.BOLD : 0}
              onMouseDown={activate}
            >
              {`[${checked}] ${item.label}`}
            </text>
          </box>
        );
      }}
    />
  );
}
