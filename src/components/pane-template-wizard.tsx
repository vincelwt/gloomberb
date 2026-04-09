import { useEffect, useRef, useState } from "react";
import type { InputRenderable, TextareaRenderable } from "@opentui/core";
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
  const [value, setValue] = useState(step.defaultValue ?? "");

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
          type={step.type === "password" ? "password" : "text"}
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

export function PaneTemplateTextareaStep({
  resolve,
  step,
  dialogId,
}: PromptContext<string> & { step: WizardStep }) {
  const textareaRef = useRef<TextareaRenderable>(null);

  useEffect(() => {
    textareaRef.current?.focus?.();
  }, []);

  useDialogKeyboard((event) => {
    event.stopPropagation();
    if (event.name === "escape") {
      resolve("");
      return;
    }
    if (event.ctrl && event.name === "s") {
      const submitted = textareaRef.current?.editBuffer.getText().trim() || step.defaultValue || "";
      if (submitted) resolve(submitted);
    }
  }, dialogId);

  const commit = () => {
    const submitted = textareaRef.current?.editBuffer.getText().trim() || step.defaultValue || "";
    if (submitted) resolve(submitted);
  };

  return (
    <DialogFrame
      title={step.label}
      footer="Ctrl+S save · Esc cancel"
    >
      <box flexDirection="column" flexGrow={1}>
        {step.body?.map((line, index) => (
          <box key={`${step.key}:${index}`} height={1}>
            <text fg={colors.textDim}>{line || " "}</text>
          </box>
        ))}
        <box height={1} />
        <box
          flexGrow={1}
          minHeight={8}
          border
          borderColor={colors.border}
          backgroundColor={colors.panel}
        >
          <textarea
            ref={textareaRef}
            initialValue={step.defaultValue ?? ""}
            placeholder={step.placeholder || ""}
            focused
            textColor={colors.text}
            placeholderColor={colors.textDim}
            backgroundColor={colors.panel}
            flexGrow={1}
            wrapText
          />
        </box>
        <box height={1} />
        <box flexDirection="row" gap={1}>
          <box
            backgroundColor={colors.selected}
            onMouseDown={commit}
          >
            <text fg={colors.selectedText}>{` Save `}</text>
          </box>
          <box
            backgroundColor={colors.panel}
            onMouseDown={() => resolve("")}
          >
            <text fg={colors.text}>{` Cancel `}</text>
          </box>
        </box>
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
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const defaultIndex = step.defaultValue
      ? options.findIndex((option) => option.value === step.defaultValue)
      : -1;
    return defaultIndex >= 0 ? defaultIndex : 0;
  });

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
