import { TextAttributes } from "@opentui/core";
import { useDialog, useDialogKeyboard, type AlertContext } from "@opentui-ui/dialog/react";
import { useEffect, useRef, useState } from "react";
import type {
  PaneSettingField,
  PaneSettingTextField,
} from "../types/plugin";
import type { PluginRegistry } from "../plugins/registry";
import { useAppState } from "../state/app-context";
import { colors } from "../theme/colors";
import { Button, DialogFrame, ListView, MultiSelectDialogContent, TextField } from "./ui";

interface PaneSettingsDialogContentProps extends AlertContext {
  paneId: string;
  pluginRegistry: PluginRegistry;
  applyFieldValue: (paneId: string, field: PaneSettingField, value: unknown) => Promise<void>;
}

function isSpaceKey(event: { name?: string; sequence?: string }): boolean {
  return event.name === "space" || event.name === " " || event.sequence === " ";
}

function summarizeValue(field: PaneSettingField, value: unknown): string {
  switch (field.type) {
    case "toggle":
      return value === true ? "On" : "Off";
    case "text":
      return typeof value === "string" && value.trim().length > 0 ? value : "Unset";
    case "select": {
      const option = field.options.find((entry) => entry.value === value);
      return option?.label ?? "Unset";
    }
    case "multi-select":
    case "ordered-multi-select": {
      const selectedValues = Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string")
        : [];
      if (selectedValues.length === 0) return "None";
      const labels = selectedValues
        .map((selectedValue) => field.options.find((entry) => entry.value === selectedValue)?.label ?? selectedValue)
        .slice(0, 3);
      const suffix = selectedValues.length > 3 ? ` +${selectedValues.length - 3}` : "";
      return `${labels.join(", ")}${suffix}`;
    }
    default:
      return "";
  }
}

function coerceSelectedValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function SelectFieldDialog({
  dismiss,
  dialogId,
  field,
  currentValue,
  onApply,
}: AlertContext & {
  field: Extract<PaneSettingField, { type: "select" }>;
  currentValue: unknown;
  onApply: (value: string) => Promise<void>;
}) {
  const initialIndex = Math.max(0, field.options.findIndex((option) => option.value === currentValue));
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);

  useDialogKeyboard((event) => {
    event.stopPropagation();
    if (event.name === "up" || event.name === "k") setSelectedIndex((index) => Math.max(0, index - 1));
    else if (event.name === "down" || event.name === "j") setSelectedIndex((index) => Math.min(field.options.length - 1, index + 1));
    else if (event.name === "escape") dismiss();
    else if (event.name === "enter" || event.name === "return" || isSpaceKey(event)) {
      const option = field.options[selectedIndex];
      if (!option) return;
      void onApply(option.value).then(() => dismiss()).catch(() => {});
    }
  }, dialogId);

  return (
    <DialogFrame
      title={field.label}
      footer="Use ↑↓ to choose · enter to apply · esc cancel"
    >
      <ListView
        items={field.options.map((option) => ({
          id: option.value,
          label: option.label,
          description: option.description,
        }))}
        selectedIndex={selectedIndex}
        bgColor={colors.commandBg}
        showSelectedDescription
        onSelect={setSelectedIndex}
        onActivate={(item) => {
          void onApply(item.id).then(() => dismiss()).catch(() => {});
        }}
      />
    </DialogFrame>
  );
}

function TextFieldDialog({
  dismiss,
  dialogId,
  field,
  currentValue,
  onApply,
}: AlertContext & {
  field: PaneSettingTextField;
  currentValue: unknown;
  onApply: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(typeof currentValue === "string" ? currentValue : "");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<any>(null);

  useEffect(() => {
    inputRef.current?.focus?.();
  }, []);

  useDialogKeyboard((event) => {
    if (event.name === "escape") {
      event.stopPropagation();
      dismiss();
    }
  }, dialogId);

  const submit = async () => {
    try {
      setError(null);
      await onApply(value);
      dismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this value.");
    }
  };

  return (
    <DialogFrame
      title={field.label}
      footer="Enter to apply · esc cancel"
    >
      <box flexDirection="column" gap={1}>
        <TextField
          inputRef={inputRef}
          value={value}
          placeholder={field.placeholder}
          focused
          onChange={setValue}
          onSubmit={() => { void submit(); }}
        />
        {error && (
          <box height={1}>
            <text fg={colors.negative}>{error}</text>
          </box>
        )}
        {field.description && (
          <box height={1}>
            <text fg={colors.textDim}>{field.description}</text>
          </box>
        )}
        <box flexDirection="row" gap={1}>
          <Button label="Apply" variant="primary" onPress={() => { void submit(); }} />
          <Button label="Cancel" variant="ghost" onPress={dismiss} />
        </box>
      </box>
    </DialogFrame>
  );
}

function MultiSelectFieldDialog({
  dismiss,
  dialogId,
  field,
  currentValue,
  onApply,
}: AlertContext & {
  field: Extract<PaneSettingField, { type: "multi-select" | "ordered-multi-select" }>;
  currentValue: unknown;
  onApply: (value: string[]) => Promise<void>;
}) {
  return (
    <MultiSelectDialogContent
      dismiss={dismiss}
      dialogId={dialogId}
      title={field.label}
      options={field.options}
      selectedValues={coerceSelectedValues(currentValue)}
      onChange={onApply}
      ordered={field.type === "ordered-multi-select"}
    />
  );
}

export function PaneSettingsDialogContent({
  dismiss,
  dialogId,
  paneId,
  pluginRegistry,
  applyFieldValue,
}: PaneSettingsDialogContentProps) {
  const { state } = useAppState();
  const dialog = useDialog();
  const descriptor = pluginRegistry.resolvePaneSettings(paneId);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const fields = descriptor?.settingsDef.fields ?? [];

  useEffect(() => {
    if (selectedIndex >= fields.length) {
      setSelectedIndex(Math.max(0, fields.length - 1));
    }
  }, [fields.length, selectedIndex]);

  const openFieldEditor = async (field: PaneSettingField | undefined) => {
    if (!field || !descriptor) return;
    const currentValue = descriptor.context.settings[field.key];

    if (field.type === "toggle") {
      await applyFieldValue(paneId, field, currentValue !== true);
      return;
    }

    if (field.type === "select") {
      await dialog.alert({
        content: (ctx) => (
          <SelectFieldDialog
            {...ctx}
            field={field}
            currentValue={currentValue}
            onApply={(value) => applyFieldValue(paneId, field, value)}
          />
        ),
      });
      return;
    }

    if (field.type === "text") {
      await dialog.alert({
        content: (ctx) => (
          <TextFieldDialog
            {...ctx}
            field={field}
            currentValue={currentValue}
            onApply={(value) => applyFieldValue(paneId, field, value)}
          />
        ),
      });
      return;
    }

    await dialog.alert({
      content: (ctx) => (
        <MultiSelectFieldDialog
          {...ctx}
          field={field}
          currentValue={currentValue}
          onApply={(value) => applyFieldValue(paneId, field, value)}
        />
      ),
    });
  };

  useDialogKeyboard((event) => {
    event.stopPropagation();
    if (event.name === "up" || event.name === "k") setSelectedIndex((index) => Math.max(0, index - 1));
    else if (event.name === "down" || event.name === "j") setSelectedIndex((index) => Math.min(fields.length - 1, index + 1));
    else if (event.name === "escape") dismiss();
    else if (event.name === "enter" || event.name === "return" || isSpaceKey(event)) {
      void openFieldEditor(fields[selectedIndex]).catch(() => {});
    }
  }, dialogId);

  if (!descriptor) {
    return (
      <DialogFrame title="Pane Settings" footer="Press esc to cancel">
        <text fg={colors.textDim}>This pane is no longer configurable.</text>
      </DialogFrame>
    );
  }

  const title = descriptor.settingsDef.title ?? `${descriptor.paneDef.name} Settings`;

  return (
    <DialogFrame title={title} footer="Use ↑↓ to choose · enter to edit · esc cancel">
      <ListView
        items={fields.map((field) => ({
          id: field.key,
          label: field.label,
          description: field.description,
          detail: summarizeValue(field, descriptor.context.settings[field.key]),
        }))}
        selectedIndex={selectedIndex}
        bgColor={colors.commandBg}
        showSelectedDescription
        onSelect={setSelectedIndex}
        onActivate={(_, index) => {
          void openFieldEditor(fields[index]).catch(() => {});
        }}
        renderRow={(item, rowState) => (
          <box flexDirection="row" justifyContent="space-between" width="100%">
            <box flexDirection="row">
              <text fg={rowState.selected ? colors.selectedText : colors.textDim}>
                {rowState.selected ? "\u25b8 " : "  "}
              </text>
              <text
                fg={rowState.selected ? colors.text : colors.textDim}
                attributes={rowState.selected ? TextAttributes.BOLD : 0}
              >
                {item.label}
              </text>
            </box>
            <text fg={rowState.selected ? colors.textMuted : colors.textMuted}>
              {item.detail}
            </text>
          </box>
        )}
      />
      {fields.length === 0 && state.focusedPaneId === paneId && (
        <box height={1}>
          <text fg={colors.textDim}>No settings available.</text>
        </box>
      )}
    </DialogFrame>
  );
}
