import { Box, Text } from "../../../../ui";
import { TextAttributes } from "../../../../ui";
import { colors } from "../../../../theme/colors";
import type { ChatUserSummary } from "../../../../utils/api-client";
import { truncateChannelLabel } from "../channels";
import { ChatActionChip } from "./action-chip";

export const PROFILE_POPOVER_CLOSE_DELAY_MS = 40;

export function hasPublicChatProfileInfo(user: ChatUserSummary): boolean {
  if (user.profilePublic === false) return false;
  return Boolean(user.bio?.trim() || user.title?.trim() || user.company?.trim());
}

export function UserProfilePopover({
  user,
  width,
  currentUserId,
  onDirectMessage,
  onClose,
  onKeepOpen,
}: {
  user: ChatUserSummary;
  width: number;
  currentUserId?: string | null;
  onDirectMessage: (user: ChatUserSummary) => void;
  onClose: () => void;
  onKeepOpen: () => void;
}) {
  const popoverWidth = Math.max(24, Math.min(38, width - 4));
  const meta = [user.title, user.company].filter(Boolean).join(" · ");
  const bio = user.bio?.trim();
  const canDm = user.id === currentUserId || user.acceptUnknownDms !== false;

  return (
    <Box
      position="absolute"
      top={1}
      right={2}
      width={popoverWidth}
      flexDirection="column"
      backgroundColor={colors.panel}
      border
      borderColor={colors.borderFocused}
      paddingX={1}
      onMouseMove={onKeepOpen}
      onMouseOut={onClose}
      style={{ zIndex: 4 }}
    >
      <Box height={1} flexDirection="row">
        <Text fg={colors.positive} attributes={TextAttributes.BOLD}>
          {truncateChannelLabel(user.username ? `@${user.username}` : user.displayName, Math.max(popoverWidth - 10, 1))}
        </Text>
        <Box flexGrow={1} />
        <ChatActionChip
          label={canDm ? "DM" : "Closed"}
          width={canDm ? 5 : 9}
          emphasized
          onPress={() => {
            if (canDm) onDirectMessage(user);
          }}
        />
      </Box>
      {meta ? <Text fg={colors.textDim}>{truncateChannelLabel(meta, popoverWidth - 2)}</Text> : null}
      {bio ? (
        <Text fg={colors.text} wrapText width={popoverWidth - 2}>
          {bio}
        </Text>
      ) : null}
    </Box>
  );
}
