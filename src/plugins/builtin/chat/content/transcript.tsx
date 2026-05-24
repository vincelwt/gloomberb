import { Box, ScrollBox, Text, type ScrollBoxRenderable } from "../../../../ui";
import type { Dispatch, SetStateAction } from "react";
import type { InlineTickerCatalogEntry } from "../../../../state/hooks/inline-tickers";
import { colors } from "../../../../theme/colors";
import type { ChatMessage, ChatUserSummary } from "../../../../api-client";
import { DesktopChatMessage } from "../message/desktop";
import { UserProfilePopover } from "../message/profile-popover";
import { TerminalChatMessage } from "../message/terminal";

interface MutableRef<T> {
  current: T;
}

interface ChatTranscriptProps {
  beginReplyTo: (index: number, options?: { deferFocus?: boolean }) => void;
  canSend: boolean;
  catalog: Record<string, InlineTickerCatalogEntry>;
  cancelProfilePopoverClose: () => void;
  chatWidth: number;
  contentWidth: number;
  handleTranscriptScrollActivity: (event?: { scroll?: { direction?: "up" | "down" | "left" | "right" } }) => void;
  hoveredIdx: number | null;
  jumpToMessage: (messageId: string) => void;
  loading: boolean;
  loadingOlderMessages: boolean;
  messageAreaHeight: number;
  messageBodyWidth: number;
  messages: ChatMessage[];
  nativePaneChrome: boolean | undefined;
  openDirectMessage: (target: ChatUserSummary) => void;
  openTicker: (symbol: string) => void;
  profilePopoverUser: ChatUserSummary | null;
  registerMessageElement: (messageId: string, node: unknown | null) => void;
  scheduleProfilePopoverClose: () => void;
  scrollRef: MutableRef<ScrollBoxRenderable | null>;
  selectedIdx: number;
  setHoveredIdx: Dispatch<SetStateAction<number | null>>;
  showProfilePopover: (user: ChatUserSummary) => void;
  stickyTranscript: boolean;
  user: { id: string; username: string; emailVerified: boolean } | null;
  userByUsername: Map<string, ChatUserSummary>;
}

export function ChatTranscript({
  beginReplyTo,
  canSend,
  catalog,
  cancelProfilePopoverClose,
  chatWidth,
  contentWidth,
  handleTranscriptScrollActivity,
  hoveredIdx,
  jumpToMessage,
  loading,
  loadingOlderMessages,
  messageAreaHeight,
  messageBodyWidth,
  messages,
  nativePaneChrome,
  openDirectMessage,
  openTicker,
  profilePopoverUser,
  registerMessageElement,
  scheduleProfilePopoverClose,
  scrollRef,
  selectedIdx,
  setHoveredIdx,
  showProfilePopover,
  stickyTranscript,
  user,
  userByUsername,
}: ChatTranscriptProps) {
  return (
    <>
      <ScrollBox
        ref={scrollRef}
        height={nativePaneChrome ? undefined : messageAreaHeight}
        flexGrow={nativePaneChrome ? 1 : undefined}
        scrollY
        focusable={false}
        stickyScroll={stickyTranscript}
        stickyStart="bottom"
        onMouseScroll={handleTranscriptScrollActivity}
        style={nativePaneChrome ? { minHeight: 0 } : undefined}
      >
        {loadingOlderMessages && (
          <Box alignItems="center" justifyContent="center" height={1} width={contentWidth}>
            <Text fg={colors.textDim}>Loading earlier messages...</Text>
          </Box>
        )}
        {loading && messages.length === 0 ? (
          <Box alignItems="center" justifyContent="center" flexGrow={1}>
            <Text fg={colors.textDim}>Loading...</Text>
          </Box>
        ) : messages.length === 0 && (
          <Box alignItems="center" justifyContent="center" flexGrow={1}>
            <Text fg={colors.textDim}>No messages yet. Be the first to say something!</Text>
          </Box>
        )}
        {messages.map((msg, index) => (
          nativePaneChrome ? (
            <DesktopChatMessage
              key={msg.id}
              msg={msg}
              index={index}
              messages={messages}
              selectedIdx={selectedIdx}
              hoveredIdx={hoveredIdx}
              canSend={canSend}
              catalog={catalog}
              userByUsername={userByUsername}
              openTicker={openTicker}
              onUserHover={showProfilePopover}
              onUserHoverEnd={scheduleProfilePopoverClose}
              beginReplyTo={beginReplyTo}
              jumpToMessage={jumpToMessage}
              registerMessageElement={registerMessageElement}
            />
          ) : (
            <TerminalChatMessage
              key={msg.id}
              msg={msg}
              index={index}
              messages={messages}
              selectedIdx={selectedIdx}
              hoveredIdx={hoveredIdx}
              canSend={canSend}
              contentWidth={contentWidth}
              messageBodyWidth={messageBodyWidth}
              catalog={catalog}
              userByUsername={userByUsername}
              openTicker={openTicker}
              onUserHover={showProfilePopover}
              onUserHoverEnd={scheduleProfilePopoverClose}
              beginReplyTo={beginReplyTo}
              jumpToMessage={jumpToMessage}
              setHoveredIdx={setHoveredIdx}
            />
          )
        ))}
      </ScrollBox>

      {profilePopoverUser && (
        <UserProfilePopover
          user={profilePopoverUser}
          width={chatWidth}
          currentUserId={user?.id}
          onDirectMessage={openDirectMessage}
          onClose={scheduleProfilePopoverClose}
          onKeepOpen={cancelProfilePopoverClose}
        />
      )}
    </>
  );
}
