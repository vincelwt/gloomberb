import { Box, Text } from "../../../../ui";
import { TextAttributes } from "../../../../ui";
import { colors } from "../../../../theme/colors";
import type { ChatUserSummary, PublicPortfolioAnalytics } from "../../../../api-client";
import { formatCompact, formatNumber } from "../../../../utils/format";
import { truncateChannelLabel } from "../channels";
import { ChatActionChip } from "./action-chip";

export const PROFILE_POPOVER_CLOSE_DELAY_MS = 40;

function hasPortfolioAnalytics(analytics: PublicPortfolioAnalytics | null | undefined): boolean {
  return Boolean(
    analytics
    && (
      analytics.portfolioName?.trim()
      || analytics.oneYearReturn != null
      || analytics.spyBeta != null
      || analytics.marketValue != null
    ),
  );
}

export function hasPublicChatProfileInfo(user: ChatUserSummary): boolean {
  if (user.profilePublic === false) return false;
  return Boolean(user.bio?.trim() || user.title?.trim() || user.company?.trim() || hasPortfolioAnalytics(user.portfolioAnalytics));
}

function formatSignedPercent(value: number): string {
  const percent = value * 100;
  return `${percent >= 0 ? "+" : ""}${formatNumber(percent, 2)}%`;
}

function analyticsLine(analytics: PublicPortfolioAnalytics): string | null {
  const parts = [
    analytics.oneYearReturn != null ? `1Y ${formatSignedPercent(analytics.oneYearReturn)}` : null,
    analytics.spyBeta != null ? `Beta ${formatNumber(analytics.spyBeta, 2)}` : null,
    analytics.marketValue != null ? `Value ${formatCompact(analytics.marketValue)}${analytics.currency ? ` ${analytics.currency}` : ""}` : null,
  ].filter((part): part is string => !!part);
  return parts.length > 0 ? parts.join(" · ") : null;
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
  const analytics = user.portfolioAnalytics;
  const analyticsTitle = analytics?.portfolioName?.trim();
  const analyticsDetail = analytics && hasPortfolioAnalytics(analytics) ? analyticsLine(analytics) : null;
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
      {analytics && hasPortfolioAnalytics(analytics) ? (
        <Box flexDirection="column">
          {analyticsTitle ? (
            <Text fg={colors.textDim}>{truncateChannelLabel(analyticsTitle, popoverWidth - 2)}</Text>
          ) : null}
          {analyticsDetail ? (
            <Text fg={colors.text}>{truncateChannelLabel(analyticsDetail, popoverWidth - 2)}</Text>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}
