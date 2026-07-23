import type { RefObject } from "react";
import { useEffect } from "react";
import { Box, Text, Textarea, type InputRenderable, type TextareaRenderable } from "../../../../ui";
import { colors } from "../../../../theme/colors";
import { t } from "../../../../i18n";
import {
  getAiProviderUnavailableReason,
  type AiProvider,
} from "../providers";
import type { ScreenerEditorState } from "./model";
import { AiRunnerSelector } from "../runner-selector";
import { isAiProviderReady } from "../runner-selection";

function ScreenerPromptEditor({
  editorKey,
  initialValue,
  focused,
  textareaRef,
  onFocusRequest,
}: {
  editorKey: string;
  initialValue: string;
  focused: boolean;
  textareaRef: RefObject<TextareaRenderable | null>;
  onFocusRequest: () => void;
}) {
  useEffect(() => {
    if (focused) {
      textareaRef.current?.focus?.();
    }
  }, [editorKey, focused, textareaRef]);

  return (
    <Box
      flexGrow={1}
      minHeight={3}
      border
      borderColor={colors.border}
      backgroundColor={colors.panel}
      onMouseDown={onFocusRequest}
    >
      <Textarea
        key={editorKey}
        ref={textareaRef}
        initialValue={initialValue}
        placeholder={t("Examples: humanoid robot suppliers, defense software compounders, EM payment rails, obesity-drug picks-and-shovels...")}
        focused={focused}
        textColor={colors.text}
        placeholderColor={colors.textDim}
        backgroundColor={colors.panel}
        flexGrow={1}
        wrapText
      />
    </Box>
  );
}

export function AiScreenerEditorView({
  editorProvider,
  editorFocusTarget,
  editorState,
  focused,
  modelInputRef,
  selectableProviders,
  textareaRef,
  onModelFocusRequest,
  onProviderChange,
  onModelChange,
  onPromptFocusRequest,
}: {
  editorProvider: AiProvider | null;
  editorFocusTarget: "prompt" | "model";
  editorState: ScreenerEditorState;
  focused: boolean;
  modelInputRef: RefObject<InputRenderable | null>;
  selectableProviders: AiProvider[];
  textareaRef: RefObject<TextareaRenderable | null>;
  onModelFocusRequest: () => void;
  onProviderChange: (providerId: string) => void;
  onModelChange: (modelId: string) => void;
  onPromptFocusRequest: () => void;
}) {
  return (
    <>
      <Box flexDirection="column" paddingX={1} paddingTop={1} gap={1}>
        <Text fg={colors.textDim}>
          {editorState.mode === "create"
            ? t("Describe the companies or setups you want this screener to discover.")
            : t("Update the screener prompt or provider. Saving does not rerun it automatically.")}
        </Text>
        <AiRunnerSelector
          providers={selectableProviders}
          providerId={editorState.providerId}
          modelId={editorState.modelId}
          modelInputRef={modelInputRef}
          modelFocused={focused && editorFocusTarget === "model"}
          onProviderChange={onProviderChange}
          onModelChange={onModelChange}
          onModelFocusRequest={onModelFocusRequest}
          onModelBlur={onPromptFocusRequest}
          modelHint="Ctrl+O opens the Pi model catalog."
        />
        {editorState.error ? (
          <Text fg={colors.negative}>{editorState.error}</Text>
        ) : (
          <Text fg={colors.textDim}>
            The AI will return validated ticker ideas with a short reason for each one.
          </Text>
        )}
      </Box>

      <Box flexGrow={1} minHeight={4} padding={1}>
        <ScreenerPromptEditor
          editorKey={editorState.key}
          initialValue={editorState.prompt}
          focused={focused && editorFocusTarget === "prompt"}
          textareaRef={textareaRef}
          onFocusRequest={onPromptFocusRequest}
        />
      </Box>

      <Box flexDirection="column" paddingX={1}>
        <Text fg={colors.textDim}>
          {editorProvider && !isAiProviderReady(editorProvider)
            ? `${getAiProviderUnavailableReason(editorProvider)} Save and switch later.`
            : "Click a provider to switch. Save to keep the draft."}
        </Text>
      </Box>
    </>
  );
}
