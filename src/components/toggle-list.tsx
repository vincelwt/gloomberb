import { TextAttributes } from "@opentui/core";
import { colors } from "../theme/colors";

export interface ToggleListItem {
  id: string;
  label: string;
  enabled: boolean;
  description?: string;
}

interface ToggleListProps {
  items: ToggleListItem[];
  selectedIdx: number;
  onToggle?: (id: string) => void;
  onSelect?: (idx: number) => void;
  /** Background color for non-selected rows (defaults to colors.bg) */
  bgColor?: string;
}

export function ToggleList({ items, selectedIdx, onToggle, onSelect, bgColor }: ToggleListProps) {
  const bg = bgColor ?? colors.bg;
  const selectedItem = items[selectedIdx];

  return (
    <box flexDirection="column">
      {items.map((item, i) => {
        const isSel = i === selectedIdx;
        const arrow = isSel ? "\u25b8" : " ";
        const check = item.enabled ? "\u2713" : " ";
        const line = `${arrow} [${check}] ${item.label}`;
        return (
          <box
            key={item.id}
            height={1}
            backgroundColor={isSel ? colors.selected : bg}
            onMouseDown={() => {
              onSelect?.(i);
              onToggle?.(item.id);
            }}
          >
            <text
              fg={isSel ? colors.text : colors.textDim}
              attributes={isSel ? TextAttributes.BOLD : 0}
            >
              {line}
            </text>
          </box>
        );
      })}
      {selectedItem?.description && (
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
