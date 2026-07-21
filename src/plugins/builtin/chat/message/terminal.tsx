import { Box, Text } from "../../../../ui";
import { t } from "../../../../i18n";
import { MESSAGE_ACTION_WIDTH, formatInlinePreview, getMessageBodyTokenLines } from "../layout";
import { ChatActionChip } from "./action-chip";
import { ResponsiveTickerBadgeText } from "./inline-tokens";
import { getChatMessageRenderState } from "./render-state";
import type { ChatMessageBaseProps } from "./types";

interface TerminalChatMessageProps extends ChatMessageBaseProps {
  contentWidth: number;
  messageBodyWidth: number;
  setHoveredIdx: (updater: (current: number | null) => number | null) => void;
}

export function TerminalChatMessage({
  msg,
  index,
  messages,
  selectedIdx,
  hoveredIdx,
  canSend,
  contentWidth,
  messageBodyWidth,
  catalog,
  userByUsername,
  openTicker,
  onUserHover,
  onUserHoverEnd,
  beginReplyTo,
  beginEditMessage,
  jumpToMessage,
  latestEditableMessageId,
  setHoveredIdx,
}: TerminalChatMessageProps) {
  const state = getChatMessageRenderState({ msg, index, messages, selectedIdx, hoveredIdx, canSend });
  const bodyLines = getMessageBodyTokenLines(msg.content, messageBodyWidth, catalog);
  const canEditMessage = msg.id === latestEditableMessageId;
  const showInlineReplyAction = !state.grouped && state.showReplyAction;
  const showInlineEditAction = !state.grouped && state.showReplyAction && canEditMessage;
  const showGroupedReplyAction = state.grouped && state.showReplyAction;
  const showGroupedEditAction = state.grouped && state.showReplyAction && canEditMessage;
  const groupedActionWidth = MESSAGE_ACTION_WIDTH * Number(showGroupedReplyAction) + MESSAGE_ACTION_WIDTH * Number(showGroupedEditAction);
  const setHovered = () => setHoveredIdx((current) => (current === index ? current : index));
  const clearHovered = () => setHoveredIdx((current) => (current === index ? null : current));
  const messageRowProps = {
    width: contentWidth,
    backgroundColor: state.bgColor,
    onMouseOver: setHovered,
    onMouseOut: clearHovered,
  };

  return (
    <Box key={msg.id} width={contentWidth} flexDirection="column">
      {msg.replyTo && (
        <Box
          {...messageRowProps}
          flexDirection="row"
          height={1}
          paddingLeft={2}
          onMouseDown={() => {
            if (msg.replyToId) jumpToMessage(msg.replyToId);
          }}
        >
          <Text fg={state.replyMetaColor}>{`${t("reply")} `}</Text>
          <Text fg={state.replyAuthorColor}>{msg.replyTo.user.username}: </Text>
          <Text fg={state.replyMetaColor}>
            {formatInlinePreview(
              msg.replyTo.content,
              Math.max(messageBodyWidth - `reply ${msg.replyTo.user.username}: `.length, 0),
            )}
          </Text>
        </Box>
      )}
      {!state.grouped && (
        <Box
          {...messageRowProps}
          flexDirection="row"
          height={1}
          paddingLeft={1}
        >
          <Text
            fg={state.authorColor}
            attributes={state.authorAttributes}
            onMouseOver={() => onUserHover(msg.user)}
            onMouseOut={onUserHoverEnd}
          >
            {msg.user.username ?? "anon"}
          </Text>
          <Text fg={state.headerStatusColor}> {state.headerStatus}</Text>
          {(showInlineReplyAction || showInlineEditAction) && (
            <>
              <Text fg={state.headerStatusColor}> </Text>
              {showInlineReplyAction && (
                <Box width={MESSAGE_ACTION_WIDTH} height={1}>
                  <ChatActionChip
                    label={t("Reply")}
                    width={MESSAGE_ACTION_WIDTH}
                    emphasized={state.isSelected}
                    onPress={() => beginReplyTo(index)}
                  />
                </Box>
              )}
              {showInlineEditAction && (
                <Box width={MESSAGE_ACTION_WIDTH} height={1}>
                  <ChatActionChip
                    label={t("Edit")}
                    width={MESSAGE_ACTION_WIDTH}
                    emphasized={state.isSelected}
                    onPress={() => beginEditMessage(index)}
                  />
                </Box>
              )}
            </>
          )}
        </Box>
      )}
      {bodyLines.map((line, lineIndex) => (
        <Box
          key={`${msg.id}:body:${lineIndex}`}
          {...messageRowProps}
          paddingLeft={3}
          height={1}
          flexDirection="row"
          position={state.grouped ? "relative" : undefined}
        >
          <Box width={messageBodyWidth} height={1}>
            <ResponsiveTickerBadgeText
              tokens={line}
              prewrapped
              catalog={catalog}
              textColor={state.bodyColor}
              openTicker={openTicker}
              userByUsername={userByUsername}
              onUserHover={onUserHover}
              onUserHoverEnd={onUserHoverEnd}
            />
          </Box>
          {lineIndex === 0 && (showGroupedReplyAction || showGroupedEditAction) && (
            <Box position="absolute" top={0} right={0} width={groupedActionWidth} height={1} flexDirection="row">
              {showGroupedReplyAction && (
                <ChatActionChip
                  label={t("Reply")}
                  width={MESSAGE_ACTION_WIDTH}
                  emphasized={state.isSelected}
                  onPress={() => beginReplyTo(index)}
                />
              )}
              {showGroupedEditAction && (
                <ChatActionChip
                  label={t("Edit")}
                  width={MESSAGE_ACTION_WIDTH}
                  emphasized={state.isSelected}
                  onPress={() => beginEditMessage(index)}
                />
              )}
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}
