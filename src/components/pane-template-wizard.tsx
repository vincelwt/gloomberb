import { useEffect, useRef, useState } from "react";
import type { InputRenderable } from "@opentui/core";
import { useDialogKeyboard, type AlertContext, type PromptContext } from "@opentui-ui/dialog/react";
import type { WizardStep } from "../types/plugin";
import { colors } from "../theme/colors";
import { DialogFrame, ListView, TextField } from "./ui";

export function PaneTemplateInfoStep({
  dismiss,
  dialogId,
  step,
}: AlertContext & { step: WizardStep }) {
  useDialogKeyboard((event) => {
    event.stopPropagation();
    if (event.name === "return" || event.name === "enter" || event.name === "escape") {
      dismiss();
    }
  }, dialogId);

  return (
    <DialogFrame title={step.label} footer="Press Enter to continue">
      <box flexDirection="column">
        {step.body?.map((line, index) => (
          <box key={`${step.key}:${index}`} height={1}>
            <text fg={colors.textDim}>{line || " "}</text>
          </box>
        ))}
      </box>
    </DialogFrame>
  );
}

export function PaneTemplateInputStep({
  resolve,
  step,
}: PromptContext<string> & { step: WizardStep }) {
  const inputRef = useRef<InputRenderable>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    inputRef.current?.focus?.();
  }, []);

  return (
    <DialogFrame
      title={step.label}
      footer={step.defaultValue ? `Press Enter to use ${step.defaultValue}` : "Enter to continue"}
    >
      <box flexDirection="column">
        {step.body?.map((line, index) => (
          <box key={`${step.key}:${index}`} height={1}>
            <text fg={colors.textDim}>{line || " "}</text>
          </box>
        ))}
        <box height={1} />
        <TextField
          inputRef={inputRef}
          value={value}
          placeholder={step.placeholder || ""}
          focused
          onChange={setValue}
          onSubmit={(submittedValue) => {
            const submitted = submittedValue.trim() || step.defaultValue || "";
            if (submitted) resolve(submitted);
          }}
        />
      </box>
    </DialogFrame>
  );
}

export function PaneTemplateSelectStep({
  resolve,
  step,
  dialogId,
}: PromptContext<string> & { step: WizardStep }) {
  const options = step.options ?? [];
  const [selectedIndex, setSelectedIndex] = useState(0);

  useDialogKeyboard((event) => {
    event.stopPropagation();
    if (event.name === "up" || event.name === "k") {
      setSelectedIndex((index) => Math.max(0, index - 1));
    } else if (event.name === "down" || event.name === "j") {
      setSelectedIndex((index) => Math.min(options.length - 1, index + 1));
    } else if (event.name === "return" || event.name === "enter") {
      resolve(options[selectedIndex]?.value ?? "");
    } else if (event.name === "escape") {
      resolve("");
    }
  }, dialogId);

  return (
    <DialogFrame title={step.label} footer="Use ↑↓ to choose · enter to select · esc to cancel">
      <box flexDirection="column">
        {step.body?.map((line, index) => (
          <box key={`${step.key}:${index}`} height={1}>
            <text fg={colors.textDim}>{line || " "}</text>
          </box>
        ))}
        <box height={1} />
        <ListView
          items={options.map((option) => ({
            id: option.value,
            label: option.label,
          }))}
          selectedIndex={selectedIndex}
          bgColor={colors.commandBg}
          onSelect={setSelectedIndex}
          onActivate={(item) => resolve(item.id)}
        />
      </box>
    </DialogFrame>
  );
}
