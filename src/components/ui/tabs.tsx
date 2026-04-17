import { Box, Text } from "../../ui";
import { TextAttributes } from "../../ui";
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
  compact?: boolean;
}

export function Tabs({ tabs, activeValue, onSelect, compact = false }: TabsProps) {
  return (
    <Box flexDirection="row" height={compact ? 1 : 2}>
      {tabs.map((tab) => {
        const active = tab.value === activeValue;
        const tabWidth = tab.label.length + 2;

        return (
          <Box
            key={tab.value}
            width={tabWidth + 2}
            flexDirection="column"
            alignItems="center"
            onMouseDown={(event) => {
              event.preventDefault();
              if (!tab.disabled) onSelect(tab.value);
            }}
          >
            <Text
              fg={tab.disabled ? colors.textMuted : active ? colors.text : colors.textDim}
              attributes={active ? TextAttributes.BOLD : 0}
            >
              {tab.label}
            </Text>
            {!compact && <Text fg={active ? colors.borderFocused : colors.bg}>{"▔".repeat(tabWidth)}</Text>}
          </Box>
        );
      })}
    </Box>
  );
}
