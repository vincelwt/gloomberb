import { colors } from "../theme/colors";

export interface Tab {
  label: string;
  value: string;
}

interface TabBarProps {
  tabs: Tab[];
  activeValue: string;
  onSelect: (value: string) => void;
}

export function TabBar({ tabs, activeValue, onSelect }: TabBarProps) {
  return (
    <box flexDirection="row" height={2}>
      {tabs.map((tab) => {
        const isActive = tab.value === activeValue;
        const barWidth = tab.label.length + 2;
        return (
          <box
            key={tab.value}
            width={barWidth + 2}
            flexDirection="column"
            alignItems="center"
            onMouseDown={(e) => { e.preventDefault(); onSelect(tab.value); }}
          >
            <text fg={isActive ? colors.text : colors.textDim}>{tab.label}</text>
            <text fg={isActive ? colors.borderFocused : colors.bg}>{"▔".repeat(barWidth)}</text>
          </box>
        );
      })}
    </box>
  );
}
