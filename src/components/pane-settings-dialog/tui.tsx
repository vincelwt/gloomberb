import { Box, Text } from "../../ui";
import { t } from "../../i18n";
import { TextAttributes } from "../../ui";
import type { PaneSettingField } from "../../types/plugin";
import { colors } from "../../theme/colors";
import { DialogFrame, ListView } from "../ui";
import { summarizePaneSettingValue } from "./value";

export function TuiUnavailablePaneSettingsDialog() {
  return (
    <DialogFrame title={t("Pane Settings")} footer={t("Press esc to cancel")}>
      <Text fg={colors.textDim}>{t("This pane is no longer configurable.")}</Text>
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
    <DialogFrame title={t(title)}>
      <ListView
        items={fields.map((field) => ({
          id: field.key,
          label: t(field.label),
          description: field.description ? t(field.description) : field.description,
          detail: summarizePaneSettingValue(field, settings[field.key]),
          disabled: field.type === "action" && field.disabled,
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
                fg={rowState.disabled ? colors.textMuted : rowState.selected ? colors.text : colors.textDim}
                attributes={rowState.selected && !rowState.disabled ? TextAttributes.BOLD : 0}
              >
                {item.label}
              </Text>
            </Box>
            <Text fg={colors.textMuted}>
              {item.detail}
            </Text>
          </Box>
        )}
      />
      {fields.length === 0 && (
        <Box height={1}>
          <Text fg={colors.textDim}>{t("No settings available.")}</Text>
        </Box>
      )}
    </DialogFrame>
  );
}
