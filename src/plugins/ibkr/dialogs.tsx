import { TextAttributes } from "@opentui/core";
import type { InputRenderable } from "@opentui/core";
import { useEffect, useRef, useState } from "react";
import { useDialogKeyboard, type PromptContext } from "@opentui-ui/dialog/react";
import type { WizardStep } from "../../types/plugin";
import { colors } from "../../theme/colors";

export function InputDialog({ resolve, step }: PromptContext<string> & { step: WizardStep }) {
  const inputRef = useRef<InputRenderable>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <box flexDirection="column">
      <text attributes={TextAttributes.BOLD} fg={colors.text}>{step.label}</text>
      <box height={1} />
      {step.body?.map((line, index) => (
        <text key={index} fg={colors.textDim}>{line || " "}</text>
      ))}
      <box height={1} />
      <input
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
    </box>
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
    <box flexDirection="column">
      <text attributes={TextAttributes.BOLD} fg={colors.text}>{title}</text>
      <box height={1} />
      {choices.map((choice, choiceIndex) => {
        const selected = choiceIndex === index;
        return (
          <box
            key={choice.id}
            flexDirection="row"
            height={1}
            backgroundColor={selected ? colors.selected : colors.bg}
            onMouseMove={() => setIndex(choiceIndex)}
            onMouseDown={() => resolve(choice.id)}
          >
            <text fg={selected ? colors.selectedText : colors.textDim}>{selected ? "▸ " : "  "}</text>
            <text fg={selected ? colors.text : colors.textDim} attributes={selected ? TextAttributes.BOLD : 0}>
              {choice.label}
            </text>
          </box>
        );
      })}
      <box height={1} />
      <text fg={colors.textDim}>{choices[index]?.desc || ""}</text>
      <box height={1} />
      <text fg={colors.textMuted}>↑↓ choose · Enter/click select · Esc cancel</text>
    </box>
  );
}
