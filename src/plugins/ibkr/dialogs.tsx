import { Box, Input, Text } from "../../ui";
import { TextAttributes } from "../../ui";
import { type InputRenderable } from "../../ui";
import { useEffect, useRef, useState } from "react";
import { type PromptContext, useDialogKeyboard } from "../../ui/dialog";
import type { WizardStep } from "../../types/plugin";
import { colors } from "../../theme/colors";

export function InputDialog({ resolve, step }: PromptContext<string> & { step: WizardStep }) {
  const inputRef = useRef<InputRenderable>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <Box flexDirection="column">
      <Text attributes={TextAttributes.BOLD} fg={colors.text}>{step.label}</Text>
      <Box height={1} />
      {step.body?.map((line, index) => (
        <Text key={index} fg={colors.textDim}>{line || " "}</Text>
      ))}
      <Box height={1} />
      <Input
        ref={inputRef}
        focused
        placeholder={step.placeholder || ""}
        textColor={colors.text}
        placeholderColor={colors.textDim}
        backgroundColor={colors.bg}
        onInput={(nextValue) => setValue(nextValue)}
        onChange={(nextValue) => setValue(nextValue)}
        onSubmit={() => resolve(value.trim())}
      />
    </Box>
  );
}

export function ChoiceDialog({
  resolve,
  dialogId,
  title,
  choices,
}: PromptContext<string> & { title: string; choices: Array<{ id: string; label: string; desc: string }> }) {
  const [index, setIndex] = useState(0);

  useDialogKeyboard((event) => {
    event.stopPropagation();
    if (event.name === "up" || event.name === "k") setIndex((current) => Math.max(0, current - 1));
    else if (event.name === "down" || event.name === "j") setIndex((current) => Math.min(choices.length - 1, current + 1));
    else if (event.name === "return") resolve(choices[index]!.id);
    else if (event.name === "escape") resolve("");
  }, dialogId);

  return (
    <Box flexDirection="column">
      <Text attributes={TextAttributes.BOLD} fg={colors.text}>{title}</Text>
      <Box height={1} />
      {choices.map((choice, choiceIndex) => {
        const selected = choiceIndex === index;
        return (
          <Box
            key={choice.id}
            flexDirection="row"
            height={1}
            backgroundColor={selected ? colors.selected : colors.bg}
            onMouseMove={() => setIndex(choiceIndex)}
            onMouseDown={() => resolve(choice.id)}
          >
            <Text fg={selected ? colors.selectedText : colors.textDim}>{selected ? "▸ " : "  "}</Text>
            <Text fg={selected ? colors.text : colors.textDim} attributes={selected ? TextAttributes.BOLD : 0}>
              {choice.label}
            </Text>
          </Box>
        );
      })}
      <Box height={1} />
      <Text fg={colors.textDim}>{choices[index]?.desc || ""}</Text>
      <Box height={1} />
      <Text fg={colors.textMuted}>↑↓ choose · Enter/click select · Esc cancel</Text>
    </Box>
  );
}
