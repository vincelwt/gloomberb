import type { RefObject } from "react";
import { useEffect } from "react";
import { Box, Text, Textarea, type TextareaRenderable } from "../../../../ui";
import { Button, SegmentedControl } from "../../../../components";
import { colors } from "../../../../theme/colors";
import { t } from "../../../../i18n";
import type { AiProvider } from "../providers";
import type { ScreenerEditorState } from "./model";

function ScreenerPromptEditor({
  editorKey,
  initialValue,
  focused,
  textareaRef,
}: {
  editorKey: string;
  initialValue: string;
  focused: boolean;
  textareaRef: RefObject<TextareaRenderable | null>;
}) {
  useEffect(() => {
    if (focused) {
      textareaRef.current?.focus?.();
    }
  }, [editorKey, focused, textareaRef]);

  return (
    <Box
      flexGrow={1}
      minHeight={10}
      border
      borderColor={colors.border}
      backgroundColor={colors.panel}
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
  contentHeight,
  editorProvider,
  editorState,
  focused,
  selectableProviders,
  textareaRef,
  width,
  onCancel,
  onProviderChange,
  onSave,
}: {
  contentHeight: number;
  editorProvider: AiProvider | null;
  editorState: ScreenerEditorState;
  focused: boolean;
  selectableProviders: AiProvider[];
  textareaRef: RefObject<TextareaRenderable | null>;
  width: number;
  onCancel: () => void;
  onProviderChange: (providerId: string) => void;
  onSave: () => void;
}) {
  return (
    <>
      <Box flexDirection="row" height={1} gap={1}>
        <Button label={t("Save")} variant="primary" onPress={onSave} />
        <Button label={t("Cancel")} variant="ghost" onPress={onCancel} />
      </Box>

      <Box flexDirection="column" paddingX={1} paddingTop={1} gap={1}>
        <Text fg={colors.textDim}>
          {editorState.mode === "create"
            ? t("Describe the companies or setups you want this screener to discover.")
            : t("Update the screener prompt or provider. Saving does not rerun it automatically.")}
        </Text>
        <SegmentedControl
          value={editorState.providerId}
          options={selectableProviders.map((provider) => ({
            value: provider.id,
            label: provider.available ? provider.name : `${provider.name} (missing)`,
          }))}
          onChange={onProviderChange}
        />
        {editorState.error ? (
          <Text fg={colors.negative}>{editorState.error}</Text>
        ) : (
          <Text fg={colors.textDim}>
            The AI will return validated ticker ideas with a short reason for each one.
          </Text>
        )}
      </Box>

      <Box flexGrow={1} minHeight={contentHeight} padding={1}>
        <ScreenerPromptEditor
          editorKey={editorState.key}
          initialValue={editorState.prompt}
          focused={focused}
          textareaRef={textareaRef}
        />
      </Box>

      <Box height={1} paddingX={1}>
        <Text fg={colors.textDim}>{"\u2500".repeat(Math.max(width - 2, 0))}</Text>
      </Box>

      <Box flexDirection="column" paddingX={1}>
        <Text fg={colors.textDim}>
          {editorProvider?.available === false
            ? `${editorProvider.name} is not currently installed. Save and switch later.`
            : "Click a provider chip to switch. Save to keep the draft."}
        </Text>
      </Box>
    </>
  );
}
