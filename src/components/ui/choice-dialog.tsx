import { useEffect, useMemo, useState } from "react";
import { Box, Text } from "../../ui";
import { type PromptContext, useDialogKeyboard } from "../../ui/dialog";
import { colors } from "../../theme/colors";
import { DialogFrame } from "./frame";
import { ListView, type ListViewItem } from "./list-view";

export interface ChoiceDialogChoice {
  id: string;
  label: string;
  description?: string;
  detail?: string;
  disabled?: boolean;
}

export interface ChoiceDialogProps extends PromptContext<string> {
  title: string;
  choices: ChoiceDialogChoice[];
  footer?: string;
  bgColor?: string;
}

function clampChoiceIndex(index: number, length: number): number {
  if (length <= 0) return -1;
  return Math.max(0, Math.min(length - 1, index));
}

function getChoiceDescription(choice: ChoiceDialogChoice | undefined): string {
  return choice?.description ?? "";
}

export function ChoiceDialog({
  resolve,
  title,
  choices,
  footer = "↑↓ choose · Enter/click select · Esc cancel",
  bgColor = colors.bg,
}: ChoiceDialogProps) {
  const [index, setIndex] = useState(() => clampChoiceIndex(0, choices.length));
  const selectedIndex = clampChoiceIndex(index, choices.length);
  const selectedChoice = selectedIndex >= 0 ? choices[selectedIndex] : undefined;
  const items = useMemo<ListViewItem[]>(() => choices.map((choice) => ({
    id: choice.id,
    label: choice.label,
    description: getChoiceDescription(choice),
    detail: choice.detail,
    disabled: choice.disabled,
  })), [choices]);

  useEffect(() => {
    setIndex((current) => clampChoiceIndex(current, choices.length));
  }, [choices.length]);

  const activateChoice = (choice: ChoiceDialogChoice | undefined) => {
    if (!choice || choice.disabled) return;
    resolve(choice.id);
  };

  useDialogKeyboard((event) => {
    event.stopPropagation();
    if (event.name === "up" || event.name === "k") {
      setIndex((current) => clampChoiceIndex(current - 1, choices.length));
    } else if (event.name === "down" || event.name === "j") {
      setIndex((current) => clampChoiceIndex(current + 1, choices.length));
    } else if (event.name === "enter" || event.name === "return") {
      activateChoice(selectedChoice);
    } else if (event.name === "escape") {
      resolve("");
    }
  });

  return (
    <DialogFrame title={title} footer={footer}>
      <Box flexDirection="column">
        <ListView
          items={items}
          selectedIndex={selectedIndex}
          bgColor={bgColor}
          emptyMessage="No choices."
          selectOnHover
          onSelect={setIndex}
          onActivate={(_, nextIndex) => activateChoice(choices[nextIndex])}
        />
        <Box height={1} />
        <Text fg={colors.textDim}>{getChoiceDescription(selectedChoice)}</Text>
      </Box>
    </DialogFrame>
  );
}
