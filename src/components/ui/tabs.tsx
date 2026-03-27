import { TextAttributes } from "@opentui/core";
import { colors } from "../../theme/colors";

export interface TabItem {
  label: string;
  value: string;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: TabItem[];
  activeValue: string;
  onSelect: (value: string) => void;
}

export function Tabs({ tabs, activeValue, onSelect }: TabsProps) {
  return (
    <box flexDirection="row" height={2}>
      {tabs.map((tab) => {
        const active = tab.value === activeValue;
        const tabWidth = tab.label.length + 2;

        return (
          <box
            key={tab.value}
            width={tabWidth + 2}
            flexDirection="column"
            alignItems="center"
            onMouseDown={(event) => {
              event.preventDefault();
              if (!tab.disabled) onSelect(tab.value);
            }}
          >
            <text
              fg={tab.disabled ? colors.textMuted : active ? colors.text : colors.textDim}
              attributes={active ? TextAttributes.BOLD : 0}
            >
              {tab.label}
            </text>
            <text fg={active ? colors.borderFocused : colors.bg}>{"▔".repeat(tabWidth)}</text>
          </box>
        );
      })}
    </box>
  );
}
