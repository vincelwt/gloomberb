import { Box, Text } from "../../../../ui";
import { TextAttributes } from "../../../../ui";
import { colors } from "../../../../theme/colors";
import type { ChatUserSummary, PublicPortfolioAnalytics } from "../../../../api-client";
import { formatNumber } from "../../../../utils/format";
import { truncateChannelLabel } from "../channels";
import { ChatActionChip } from "./action-chip";

export const PROFILE_POPOVER_CLOSE_DELAY_MS = 40;

function hasPortfolioAnalytics(analytics: PublicPortfolioAnalytics | null | undefined): boolean {
  return Boolean(
    analytics
    && (
      analytics.oneYearReturn != null
      || analytics.spyBeta != null
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

function analyticsValueColor(id: string, value: number): string {
  if (id === "one-year") {
    if (value > 0) return colors.positive;
    if (value < 0) return colors.negative;
  }
  return colors.warning;
}

function analyticsMetrics(analytics: PublicPortfolioAnalytics) {
  return [
    analytics.oneYearReturn != null
      ? {
        id: "one-year",
        label: "1Y",
        value: formatSignedPercent(analytics.oneYearReturn),
        rawValue: analytics.oneYearReturn,
      }
      : null,
    analytics.spyBeta != null
      ? {
        id: "beta",
        label: "Beta",
        value: formatNumber(analytics.spyBeta, 2),
        rawValue: analytics.spyBeta,
      }
      : null,
  ].filter((metric): metric is { id: string; label: string; value: string; rawValue: number } => !!metric);
}

function PortfolioAnalyticsBand({
  analytics,
  width,
}: {
  analytics: PublicPortfolioAnalytics;
  width: number;
}) {
  const metrics = analyticsMetrics(analytics);
  if (metrics.length === 0) return null;
  const metricWidth = Math.max(9, Math.floor((width - 5) / metrics.length));

  return (
    <Box flexDirection="column" width={width} backgroundColor={colors.commandBg} paddingX={1}>
      <Text fg={colors.textDim}>Portfolio Stats</Text>
      <Box flexDirection="row" gap={1}>
        {metrics.map((metric) => (
          <Box key={metric.id} width={metricWidth} flexDirection="column">
            <Text fg={colors.textMuted}>{truncateChannelLabel(metric.label, metricWidth)}</Text>
            <Text fg={analyticsValueColor(metric.id, metric.rawValue)} attributes={TextAttributes.BOLD}>
              {truncateChannelLabel(metric.value, metricWidth)}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
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
        <PortfolioAnalyticsBand analytics={analytics} width={popoverWidth - 2} />
      ) : null}
    </Box>
  );
}
