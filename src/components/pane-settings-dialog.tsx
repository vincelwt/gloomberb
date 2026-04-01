import { TextAttributes } from "@opentui/core";
import { useDialog, useDialogKeyboard, type AlertContext } from "@opentui-ui/dialog/react";
import { useEffect, useRef, useState } from "react";
import type {
  PaneSettingField,
  PaneSettingOption,
  PaneSettingOrderedMultiSelectField,
  PaneSettingTextField,
} from "../types/plugin";
import type { PluginRegistry } from "../plugins/registry";
import { useAppState } from "../state/app-context";
import { colors } from "../theme/colors";
import { ToggleList } from "./toggle-list";
import { Button, DialogFrame, ListView, TextField } from "./ui";

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

function toggleSelectedValue(currentValues: string[], value: string): string[] {
  return currentValues.includes(value)
    ? currentValues.filter((entry) => entry !== value)
    : [...currentValues, value];
}

function moveSelectedValue(
  field: PaneSettingOrderedMultiSelectField,
  currentValues: string[],
  selectedOption: string,
  direction: "up" | "down",
): string[] {
  if (!currentValues.includes(selectedOption)) return currentValues;

  const optionValueSet = new Set(field.options.map((option) => option.value));
  const ordered = currentValues.filter((value) => optionValueSet.has(value));
  const index = ordered.indexOf(selectedOption);
  if (index < 0) return currentValues;

  const targetIndex = direction === "up"
    ? Math.max(0, index - 1)
    : Math.min(ordered.length - 1, index + 1);
  if (targetIndex === index) return currentValues;

  const next = [...ordered];
  const [entry] = next.splice(index, 1);
  next.splice(targetIndex, 0, entry!);
  const unknownValues = currentValues.filter((value) => !optionValueSet.has(value));
  return [...next, ...unknownValues];
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
      footer="Use ↑↓ to choose · enter to apply · esc to close"
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
      footer="Enter to apply · esc to close"
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
  const optionByValue = new Map(field.options.map((option) => [option.value, option]));
  const [selectedValues, setSelectedValues] = useState(() => coerceSelectedValues(currentValue));
  const knownSelectedValues = selectedValues.filter((value) => optionByValue.has(value));
  const orderedOptions = field.options;
  const [selectedOptionId, setSelectedOptionId] = useState(orderedOptions[0]?.value ?? "");
  const selectedIndex = Math.max(0, orderedOptions.findIndex((option) => option.value === selectedOptionId));
  const selectedOptionValue = orderedOptions[selectedIndex]?.value ?? "";
  const selectedValueOrder = knownSelectedValues.indexOf(selectedOptionValue);
  const canMoveUp = field.type === "ordered-multi-select" && selectedValueOrder > 0;
  const canMoveDown = field.type === "ordered-multi-select"
    && selectedValueOrder >= 0
    && selectedValueOrder < knownSelectedValues.length - 1;

  useEffect(() => {
    setSelectedValues(coerceSelectedValues(currentValue));
  }, [currentValue]);

  useEffect(() => {
    if (orderedOptions.some((option) => option.value === selectedOptionId)) return;
    setSelectedOptionId(orderedOptions[0]?.value ?? "");
  }, [orderedOptions, selectedOptionId]);

  const toggleItems = orderedOptions.map((option) => {
    const order = knownSelectedValues.indexOf(option.value);
    const orderDescription = field.type === "ordered-multi-select" && order >= 0
      ? `Order ${order + 1} of ${knownSelectedValues.length}.`
      : null;

    return {
      id: option.value,
      label: option.label,
      enabled: selectedValues.includes(option.value),
      description: [option.description, orderDescription].filter((entry): entry is string => !!entry).join(" "),
    };
  });
  const listHeight = Math.min(12, Math.max(6, toggleItems.length));

  const applySelectedValues = async (nextValues: string[]) => {
    const previousValues = selectedValues;
    setSelectedValues(nextValues);
    try {
      await onApply(nextValues);
    } catch (error) {
      setSelectedValues(previousValues);
      throw error;
    }
  };

  const toggleOption = async (option: PaneSettingOption | undefined) => {
    if (!option) return;
    await applySelectedValues(toggleSelectedValue(selectedValues, option.value));
  };

  const moveOption = async (direction: "up" | "down") => {
    if (field.type !== "ordered-multi-select") return;
    const option = orderedOptions[selectedIndex];
    if (!option) return;
    await applySelectedValues(moveSelectedValue(field, selectedValues, option.value, direction));
  };

  useDialogKeyboard((event) => {
    event.stopPropagation();
    if (event.name === "up" || event.name === "k") {
      const nextIndex = Math.max(0, selectedIndex - 1);
      setSelectedOptionId(orderedOptions[nextIndex]?.value ?? selectedOptionId);
    } else if (event.name === "down" || event.name === "j") {
      const nextIndex = Math.min(orderedOptions.length - 1, selectedIndex + 1);
      setSelectedOptionId(orderedOptions[nextIndex]?.value ?? selectedOptionId);
    }
    else if (isSpaceKey(event)) {
      void toggleOption(orderedOptions[selectedIndex]).catch(() => {});
    } else if (event.name === "[" && field.type === "ordered-multi-select") {
      void moveOption("up").catch(() => {});
    } else if (event.name === "]" && field.type === "ordered-multi-select") {
      void moveOption("down").catch(() => {});
    } else if (event.name === "enter" || event.name === "return") {
      dismiss();
    } else if (event.name === "escape") {
      dismiss();
    }
  }, dialogId);

  return (
    <DialogFrame
      title={field.label}
      footer={field.type === "ordered-multi-select"
        ? "space toggle · [ ] reorder · enter done"
        : "space toggle · enter done"}
    >
      <box flexDirection="column" gap={1}>
        <ToggleList
          items={toggleItems}
          selectedIdx={selectedIndex}
          bgColor={colors.commandBg}
          height={listHeight}
          scrollable
          showSelectedDescription={false}
          onSelect={(index) => setSelectedOptionId(orderedOptions[index]?.value ?? selectedOptionId)}
          onToggle={(id) => {
            setSelectedOptionId(id);
            void toggleOption(optionByValue.get(id)).catch(() => {});
          }}
        />
        <box flexDirection="row" gap={1}>
          <Button label="Toggle" variant="secondary" onPress={() => { void toggleOption(orderedOptions[selectedIndex]).catch(() => {}); }} />
          {field.type === "ordered-multi-select" && (
            <>
              <Button label="Move Up" variant="ghost" disabled={!canMoveUp} onPress={() => { void moveOption("up").catch(() => {}); }} />
              <Button label="Move Down" variant="ghost" disabled={!canMoveDown} onPress={() => { void moveOption("down").catch(() => {}); }} />
            </>
          )}
          <Button label="Done" variant="primary" onPress={dismiss} />
        </box>
      </box>
    </DialogFrame>
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
      <DialogFrame title="Pane Settings" footer="Press esc to close">
        <text fg={colors.textDim}>This pane is no longer configurable.</text>
      </DialogFrame>
    );
  }

  const title = descriptor.settingsDef.title ?? `${descriptor.paneDef.name} Settings`;

  return (
    <DialogFrame title={title} footer="Use ↑↓ to choose · enter to edit · esc to close">
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
