import { Box, Text } from "../../ui";
import { TextAttributes } from "../../ui";
import type { PaneSettingField } from "../../types/plugin";
import { colors } from "../../theme/colors";
import { DialogFrame, ListView } from "../ui";
import { summarizePaneSettingValue } from "./value";

export function TuiUnavailablePaneSettingsDialog() {
  return (
    <DialogFrame title="Pane Settings" footer="Press esc to cancel">
      <Text fg={colors.textDim}>This pane is no longer configurable.</Text>
    </DialogFrame>
  );
}

export function TuiPaneSettingsDialogBody({
  title,
  fields,
  selectedIndex,
  settings,
  onSelect,
  onActivate,
}: {
  title: string;
  fields: PaneSettingField[];
  selectedIndex: number;
  settings: Record<string, unknown>;
  onSelect: (index: number) => void;
  onActivate: (field: PaneSettingField | undefined) => void;
}) {
  return (
    <DialogFrame title={title} footer="Use ↑↓ to choose · enter to edit · esc cancel">
      <ListView
        items={fields.map((field) => ({
          id: field.key,
          label: field.label,
          description: field.description,
          detail: summarizePaneSettingValue(field, settings[field.key]),
        }))}
        selectedIndex={selectedIndex}
        bgColor={colors.commandBg}
        showSelectedDescription
        onSelect={onSelect}
        onActivate={(_, index) => {
          onActivate(fields[index]);
        }}
        renderRow={(item, rowState) => (
          <Box flexDirection="row" justifyContent="space-between" width="100%">
            <Box flexDirection="row">
              <Text fg={rowState.selected ? colors.selectedText : colors.textDim}>
                {rowState.selected ? "\u25b8 " : "  "}
              </Text>
              <Text
                fg={rowState.selected ? colors.text : colors.textDim}
                attributes={rowState.selected ? TextAttributes.BOLD : 0}
              >
                {item.label}
              </Text>
            </Box>
            <Text fg={rowState.selected ? colors.textMuted : colors.textMuted}>
              {item.detail}
            </Text>
          </Box>
        )}
      />
      {fields.length === 0 && (
        <Box height={1}>
          <Text fg={colors.textDim}>No settings available.</Text>
        </Box>
      )}
    </DialogFrame>
  );
}
