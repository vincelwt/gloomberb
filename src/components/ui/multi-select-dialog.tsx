import { Box, Text, useUiHost } from "../../ui";
import { TextAttributes } from "../../ui";
import { useShortcut } from "../../react/input";
import { type AlertContext, useDialog, useDialogKeyboard } from "../../ui/dialog";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { colors } from "../../theme/colors";
import { ToggleList } from "../toggle-list";
import { Button } from "./button";
import { DialogFrame } from "./frame";
import {
  moveMultiSelectValue,
  normalizeMultiSelectValues,
  summarizeMultiSelectValues,
  toggleMultiSelectValue,
  type MultiSelectOption,
} from "./multi-select";

export interface MultiSelectDialogContentProps extends AlertContext {
  title: string;
  options: MultiSelectOption[];
  selectedValues: string[];
  onChange: (values: string[]) => Promise<void> | void;
  ordered?: boolean;
  emptyLabel?: string;
  idPrefix?: string;
}

export interface MultiSelectDialogButtonProps {
  label: string;
  title?: string;
  options: MultiSelectOption[];
  selectedValues: string[];
  onChange: (values: string[]) => Promise<void> | void;
  disabled?: boolean;
  emptyLabel?: string;
  ordered?: boolean;
  idPrefix?: string;
  renderTrigger?: (props: MultiSelectDialogTriggerProps) => ReactNode;
  shortcutKey?: string | string[];
  shortcutActive?: boolean;
}

type DialogTriggerEvent = { stopPropagation?: () => void; preventDefault?: () => void };

export interface MultiSelectDialogTriggerProps {
  buttonLabel: string;
  buttonText: string;
  summary: string;
  disabled: boolean;
  openDialog: (event?: DialogTriggerEvent) => void;
  stopMouseEvent: (event?: DialogTriggerEvent) => void;
}

function isSpaceKey(event: { name?: string; sequence?: string }): boolean {
  return event.name === "space" || event.name === " " || event.sequence === " ";
}

function stopMouseEvent(event?: DialogTriggerEvent) {
  event?.stopPropagation?.();
  event?.preventDefault?.();
}

function matchesShortcut(event: { name?: string; sequence?: string }, shortcutKey: string | string[] | undefined): boolean {
  if (!shortcutKey) return false;
  const keys = Array.isArray(shortcutKey) ? shortcutKey : [shortcutKey];
  const name = event.name?.toLowerCase() ?? "";
  const sequence = event.sequence?.toLowerCase() ?? "";
  return keys.some((key) => {
    const normalized = key.toLowerCase();
    return normalized === name || normalized === sequence;
  });
}

export function MultiSelectDialogContent({
  dismiss,
  dialogId,
  title,
  options,
  selectedValues: selectedValuesProp,
  onChange,
  ordered = false,
  idPrefix,
}: MultiSelectDialogContentProps) {
  const isDesktopWeb = useUiHost().kind === "desktop-web";
  const optionByValue = useMemo(() => new Map(options.map((option) => [option.value, option])), [options]);
  const [selectedValues, setSelectedValues] = useState(() => normalizeMultiSelectValues(options, selectedValuesProp));
  const knownSelectedValues = selectedValues.filter((value) => optionByValue.has(value));
  const [selectedOptionId, setSelectedOptionId] = useState(options[0]?.value ?? "");
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === selectedOptionId));
  const selectedOption = options[selectedIndex];
  const selectedOptionValue = selectedOption?.value ?? "";
  const selectedValueOrder = knownSelectedValues.indexOf(selectedOptionValue);
  const canMoveUp = ordered && selectedValueOrder > 0;
  const canMoveDown = ordered
    && selectedValueOrder >= 0
    && selectedValueOrder < knownSelectedValues.length - 1;

  useEffect(() => {
    setSelectedValues(normalizeMultiSelectValues(options, selectedValuesProp));
  }, [options, selectedValuesProp]);

  useEffect(() => {
    if (options.some((option) => option.value === selectedOptionId)) return;
    setSelectedOptionId(options[0]?.value ?? "");
  }, [options, selectedOptionId]);

  const toggleItems = options.map((option) => {
    const order = knownSelectedValues.indexOf(option.value);
    const orderDescription = ordered && order >= 0
      ? `Order ${order + 1} of ${knownSelectedValues.length}.`
      : null;

    return {
      id: option.value,
      label: option.label,
      disabled: option.disabled,
      enabled: selectedValues.includes(option.value),
      description: [option.description, orderDescription].filter((entry): entry is string => !!entry).join(" "),
    };
  });
  const listHeight = isDesktopWeb
    ? Math.min(12, Math.max(5, toggleItems.length * 1.35))
    : Math.min(12, Math.max(6, toggleItems.length));

  const applySelectedValues = async (nextValues: string[]) => {
    const previousValues = selectedValues;
    setSelectedValues(nextValues);
    try {
      await onChange(nextValues);
    } catch (error) {
      setSelectedValues(previousValues);
      throw error;
    }
  };

  const toggleOption = async (option: MultiSelectOption | undefined) => {
    if (!option || option.disabled) return;
    await applySelectedValues(toggleMultiSelectValue(options, selectedValues, option.value));
  };

  const moveOption = async (direction: "up" | "down") => {
    if (!ordered || !selectedOption) return;
    await applySelectedValues(moveMultiSelectValue(options, selectedValues, selectedOption.value, direction));
  };

  useDialogKeyboard((event) => {
    event.stopPropagation();
    if (event.name === "up" || event.name === "k") {
      const nextIndex = Math.max(0, selectedIndex - 1);
      setSelectedOptionId(options[nextIndex]?.value ?? selectedOptionId);
    } else if (event.name === "down" || event.name === "j") {
      const nextIndex = Math.min(options.length - 1, selectedIndex + 1);
      setSelectedOptionId(options[nextIndex]?.value ?? selectedOptionId);
    } else if (isSpaceKey(event)) {
      void toggleOption(selectedOption).catch(() => {});
    } else if (event.name === "[" && ordered) {
      void moveOption("up").catch(() => {});
    } else if (event.name === "]" && ordered) {
      void moveOption("down").catch(() => {});
    } else if (event.name === "enter" || event.name === "return" || event.name === "escape") {
      dismiss();
    }
  }, dialogId);

  return (
    <DialogFrame title={title} showTitleDivider={!isDesktopWeb}>
      <Box
        flexDirection="column"
        gap={1}
        style={isDesktopWeb ? { minWidth: 520 } : undefined}
      >
        <ToggleList
          items={toggleItems}
          selectedIdx={selectedIndex}
          bgColor={isDesktopWeb ? "transparent" : colors.commandBg}
          height={listHeight}
          scrollable
          showSelectedDescription={false}
          rowIdPrefix={idPrefix ? `${idPrefix}:option` : undefined}
          rowGap={isDesktopWeb ? 0 : undefined}
          rowHeight={isDesktopWeb ? 1.35 : undefined}
          surface={isDesktopWeb ? "plain" : undefined}
          onSelect={(index) => setSelectedOptionId(options[index]?.value ?? selectedOptionId)}
          onToggle={(id) => {
            setSelectedOptionId(id);
            void toggleOption(optionByValue.get(id)).catch(() => {});
          }}
        />
        <Box
          flexDirection="row"
          gap={1}
          justifyContent={isDesktopWeb ? "flex-end" : undefined}
          style={isDesktopWeb ? { paddingTop: 6 } : undefined}
        >
          {ordered && (
            <>
              <Button label="Move Up" variant="ghost" disabled={!canMoveUp} onPress={() => { void moveOption("up").catch(() => {}); }} />
              <Button label="Move Down" variant="ghost" disabled={!canMoveDown} onPress={() => { void moveOption("down").catch(() => {}); }} />
            </>
          )}
          <Button label="Done" variant="primary" onPress={dismiss} />
        </Box>
      </Box>
    </DialogFrame>
  );
}

export function MultiSelectDialogButton({
  label,
  title,
  options,
  selectedValues,
  onChange,
  disabled = false,
  emptyLabel = "None",
  ordered = false,
  idPrefix,
  renderTrigger,
  shortcutKey,
  shortcutActive = false,
}: MultiSelectDialogButtonProps) {
  const isDesktopWeb = useUiHost().kind === "desktop-web";
  const dialog = useDialog();
  const summary = summarizeMultiSelectValues({ options, selectedValues, emptyLabel });
  const buttonLabel = `${label}: ${summary}`;
  const buttonText = ` ${buttonLabel} `;
  const openDialog = (event?: DialogTriggerEvent) => {
    stopMouseEvent(event);
    if (disabled) return;
    void dialog.alert({
      closeOnClickOutside: true,
      content: (ctx) => (
        <MultiSelectDialogContent
          {...ctx}
          title={title ?? label}
          options={options}
          selectedValues={selectedValues}
          onChange={onChange}
          ordered={ordered}
          emptyLabel={emptyLabel}
          idPrefix={idPrefix}
        />
      ),
    }).catch(() => {});
  };

  useShortcut((event) => {
    if (!shortcutActive || disabled || !matchesShortcut(event, shortcutKey)) return;
    openDialog(event);
  });

  if (renderTrigger) {
    return renderTrigger({
      buttonLabel,
      buttonText,
      summary,
      disabled,
      openDialog,
      stopMouseEvent,
    });
  }

  if (isDesktopWeb) {
    return (
      <Box
        id={idPrefix ? `${idPrefix}:button` : undefined}
        height={1}
        flexDirection="row"
        onMouseDown={stopMouseEvent}
        onMouseUp={stopMouseEvent}
      >
        <Button
          label={buttonLabel}
          variant="secondary"
          disabled={disabled}
          onPress={() => openDialog()}
        />
      </Box>
    );
  }

  return (
    <Box
      id={idPrefix ? `${idPrefix}:button` : undefined}
      height={1}
      width={buttonText.length}
      flexDirection="row"
      backgroundColor={disabled ? colors.panel : colors.selected}
      onMouseDown={stopMouseEvent}
      onMouseUp={openDialog}
    >
      <Text
        fg={disabled ? colors.textMuted : colors.selectedText}
        attributes={TextAttributes.BOLD}
        onMouseDown={stopMouseEvent}
        onMouseUp={openDialog}
      >
        {buttonText}
      </Text>
    </Box>
  );
}

export type { MultiSelectOption };
