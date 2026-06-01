import { Box, Text, TextAttributes, type TextareaRenderable } from "../../../../ui";
import { getMessageComposerBlockHeight, MessageComposer } from "../../../../components/ui";
import { colors } from "../../../../theme/colors";
import type { ChatMessage } from "../../../../api-client";
import { InlineAuthActions } from "../../cloud/auth-actions";
import { ChatActionChip } from "../message/action-chip";
import { COMPOSER_ACTION_WIDTH } from "../layout";

const DESKTOP_CHAT_INPUT_TOP_MARGIN_PX = 6;

interface MutableRef<T> {
  current: T;
}

interface ChatComposerAreaProps {
  canSend: boolean;
  cancelEditMessage: () => void;
  clearReplyTarget: () => void;
  commitLocalDraft: (draft: string) => void;
  composerHeight: number;
  composerWidth: number;
  contentWidth: number;
  focused: boolean;
  focusComposer: () => void;
  hasSavedSession: boolean;
  inputFocused: boolean;
  inputPlaceholder: string;
  inputRef: MutableRef<TextareaRenderable | null>;
  inputValueRef: MutableRef<string>;
  nativePaneChrome: boolean | undefined;
  editingMessage: ChatMessage | null;
  editingPreview: string;
  replyPreview: string;
  replyTo: ChatMessage | null;
  sendMessage: () => void;
  user: { id: string; username: string; emailVerified: boolean } | null;
}

export function ChatComposerArea({
  canSend,
  cancelEditMessage,
  clearReplyTarget,
  commitLocalDraft,
  composerHeight,
  composerWidth,
  contentWidth,
  focused,
  focusComposer,
  hasSavedSession,
  inputFocused,
  inputPlaceholder,
  inputRef,
  inputValueRef,
  nativePaneChrome,
  editingMessage,
  editingPreview,
  replyPreview,
  replyTo,
  sendMessage,
  user,
}: ChatComposerAreaProps) {
  if (!canSend) {
    return (
      <Box width={contentWidth} height={2} flexDirection="column">
        {!user && !hasSavedSession ? (
          <>
            <Text fg={colors.textDim}>Read-only chat. Log in or sign up to send.</Text>
            <InlineAuthActions />
          </>
        ) : !user ? (
          <>
            <Text fg={colors.positive}>Saved login found. Log in again to send.</Text>
            <InlineAuthActions showSignup={false} />
          </>
        ) : (
          <>
            <Text fg={colors.positive}>Verify your email to send messages.</Text>
            <Text fg={colors.textDim}>Ctrl+P, then Resend Verification Email</Text>
          </>
        )}
      </Box>
    );
  }

  return (
    <>
      {nativePaneChrome && (
        <Box
          width={composerWidth}
          style={{
            flex: `0 0 ${DESKTOP_CHAT_INPUT_TOP_MARGIN_PX}px`,
            height: DESKTOP_CHAT_INPUT_TOP_MARGIN_PX,
            minHeight: DESKTOP_CHAT_INPUT_TOP_MARGIN_PX,
          }}
        />
      )}

      {editingMessage && (
        <Box height={1} width={contentWidth} flexDirection="row">
          <Text fg={colors.textMuted}> editing </Text>
          <Text fg={colors.textDim}>{editingPreview ? `: ${editingPreview}` : ""}</Text>
          <Box flexGrow={1} />
          <ChatActionChip
            label="Cancel"
            width={COMPOSER_ACTION_WIDTH}
            onPress={cancelEditMessage}
          />
        </Box>
      )}

      {!editingMessage && replyTo && (
        <Box height={1} width={contentWidth} flexDirection="row">
          <Text fg={colors.textMuted}> replying to </Text>
          <Text fg={colors.positive} attributes={TextAttributes.BOLD}>{`@${replyTo.user.username}`}</Text>
          <Text fg={colors.textDim}>{replyPreview ? `: ${replyPreview}` : ""}</Text>
          <Box flexGrow={1} />
          <ChatActionChip
            label="Cancel"
            width={COMPOSER_ACTION_WIDTH}
            onPress={clearReplyTarget}
          />
        </Box>
      )}

      <MessageComposer
        inputRef={inputRef}
        initialValue={inputValueRef.current}
        focused={inputFocused && focused}
        placeholder={inputPlaceholder}
        terminalPrefix=" > "
        width={composerWidth}
        height={composerHeight}
        onFocusRequest={focusComposer}
        onInput={commitLocalDraft}
        keyBindings={[
          { name: "return", action: "submit" },
          { name: "linefeed", action: "submit" },
          { name: "return", shift: true, action: "newline" },
          { name: "linefeed", shift: true, action: "newline" },
          { name: "return", meta: true, action: "submit" },
          { name: "linefeed", meta: true, action: "submit" },
        ]}
        onSubmit={() => {
          if (inputValueRef.current.trim()) {
            sendMessage();
          }
        }}
        wrapText
      />
    </>
  );
}

export function getChatComposerAreaHeight({
  canSend,
  composerHeight,
  editingMessage,
  nativePaneChrome,
  replyTo,
}: {
  canSend: boolean;
  composerHeight: number;
  editingMessage: ChatMessage | null;
  nativePaneChrome: boolean | undefined;
  replyTo: ChatMessage | null;
}) {
  if (!canSend) return 2;
  return getMessageComposerBlockHeight({ height: composerHeight, nativePaneChrome }) + (editingMessage || replyTo ? 1 : 0);
}
