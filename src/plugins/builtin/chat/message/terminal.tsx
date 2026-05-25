import { Box, Text } from "../../../../ui";
import { MESSAGE_ACTION_WIDTH, formatInlinePreview, getMessageBodyLines } from "../layout";
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
  jumpToMessage,
  setHoveredIdx,
}: TerminalChatMessageProps) {
  const state = getChatMessageRenderState({ msg, index, messages, selectedIdx, hoveredIdx, canSend });
  const bodyLines = getMessageBodyLines(msg, contentWidth, catalog);
  const showInlineReplyAction = !state.grouped && state.showReplyAction;
  const showGroupedReplyAction = state.grouped && state.showReplyAction;
  const setHovered = () => setHoveredIdx((current) => (current === index ? current : index));
  const clearHovered = () => setHoveredIdx((current) => (current === index ? null : current));
  const messageRowProps = {
    width: contentWidth,
    backgroundColor: state.bgColor,
    onMouseMove: setHovered,
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
          <Text fg={state.replyMetaColor}>reply </Text>
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
            onMouseMove={() => onUserHover(msg.user)}
            onMouseOut={onUserHoverEnd}
          >
            {msg.user.username ?? "anon"}
          </Text>
          <Text fg={state.headerStatusColor}> {state.headerStatus}</Text>
          {showInlineReplyAction && (
            <>
              <Text fg={state.headerStatusColor}> </Text>
              <Box width={MESSAGE_ACTION_WIDTH} height={1}>
                <ChatActionChip
                  label="Reply"
                  width={MESSAGE_ACTION_WIDTH}
                  emphasized={state.isSelected}
                  onPress={() => beginReplyTo(index)}
                />
              </Box>
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
              text={line}
              catalog={catalog}
              textColor={state.bodyColor}
              openTicker={openTicker}
              userByUsername={userByUsername}
              onUserHover={onUserHover}
              onUserHoverEnd={onUserHoverEnd}
            />
          </Box>
          {lineIndex === 0 && showGroupedReplyAction && (
            <Box position="absolute" top={0} right={0} width={MESSAGE_ACTION_WIDTH} height={1}>
              <ChatActionChip
                label="Reply"
                width={MESSAGE_ACTION_WIDTH}
                emphasized={state.isSelected}
                onPress={() => beginReplyTo(index)}
              />
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}
