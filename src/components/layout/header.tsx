import { Box, SpinnerMark, Text, TextAttributes, useUiCapabilities } from "../../ui";
import { useEffect, type ReactNode } from "react";
import { blendHex, colors, priceColor } from "../../theme/colors";
import { useThemeColors } from "../../theme/theme-context";
import { useAppActive } from "../../state/app/activity";
import { useAppDispatch, useAppSelector } from "../../state/app/context";
import {
  selectBaseCurrency,
  selectUpdateAvailable,
  selectUpdateCheckInProgress,
  selectUpdateNotice,
  selectUpdateProgress,
} from "../../state/selectors-ui";
import { getSharedMarketDataCoordinator } from "../../market-data/coordinator";
import { useQuoteEntry, useResolvedEntryValue } from "../../market-data/hooks";
import { formatPercentRaw } from "../../utils/format";
import { formatMarketPrice } from "../../market-data/market/format";
import { marketStateLabel, marketStateColor, getActiveQuoteDisplay } from "../../market-data/market/status";
import { VERSION } from "../../version";
import { TITLEBAR_TRAFFIC_LIGHT_WIDTH } from "./titlebar-overlay";

const SPY_REFRESH_MS = 5 * 60_000; // 5 min
const UPDATE_NOTICE_DURATION_MS = 5_000;

function DesktopHeaderPill({
  children,
  backgroundColor = blendHex(colors.header, colors.bg, 0.28),
  borderColor = blendHex(colors.border, colors.headerText, 0.22),
}: {
  children: ReactNode;
  backgroundColor?: string;
  borderColor?: string;
}) {
  return (
    <Box
      height={1}
      flexDirection="row"
      alignItems="center"
      backgroundColor={backgroundColor}
      style={{
        border: `1px solid ${borderColor}`,
        borderRadius: 5,
        paddingInline: 6,
      }}
    >
      {children}
    </Box>
  );
}

function UpdateStatus() {
  const dispatch = useAppDispatch();
  const updateAvailable = useAppSelector(selectUpdateAvailable);
  const updateProgress = useAppSelector(selectUpdateProgress);
  const updateCheckInProgress = useAppSelector(selectUpdateCheckInProgress);
  const updateNotice = useAppSelector(selectUpdateNotice);

  useEffect(() => {
    if (!updateNotice || updateAvailable || updateProgress || updateCheckInProgress) return;
    const timeout = setTimeout(() => {
      dispatch({ type: "SET_UPDATE_NOTICE", notice: null });
    }, UPDATE_NOTICE_DURATION_MS);
    return () => clearTimeout(timeout);
  }, [dispatch, updateAvailable, updateCheckInProgress, updateNotice, updateProgress]);

  if (updateProgress) {
    if (updateProgress.phase === "downloading") {
      return (
        <Box flexDirection="row" gap={1}>
          <SpinnerMark name="dots" color={colors.headerText} />
          <Text fg={colors.headerText}>
            Downloading v{updateAvailable?.version}: {updateProgress.percent ?? 0}%
          </Text>
        </Box>
      );
    }
    if (updateProgress.phase === "replacing") {
      return (
        <Box flexDirection="row" gap={1}>
          <SpinnerMark name="dots" color={colors.headerText} />
          <Text fg={colors.headerText}>Installing update...</Text>
        </Box>
      );
    }
    if (updateProgress.phase === "done") {
      return <Text fg={colors.headerText}>{updateProgress.message ?? "Update installed, restart to apply"}</Text>;
    }
    if (updateProgress.phase === "error") {
      return <Text fg={colors.headerText}>Update failed: {updateProgress.error}</Text>;
    }
  }

  if (updateCheckInProgress) {
    return (
      <Box flexDirection="row" gap={1}>
        <SpinnerMark name="dots" color={colors.headerText} />
        <Text fg={colors.headerText}>Checking for updates...</Text>
      </Box>
    );
  }

  if (updateAvailable) {
    if (updateAvailable.updateAction.kind === "manual") {
      return (
        <Text fg={colors.headerText}>
          v{updateAvailable.version} available — run {updateAvailable.updateAction.command}
        </Text>
      );
    }
    return (
      <Text fg={colors.headerText}>
        v{updateAvailable.version} available — starting download...
      </Text>
    );
  }

  if (updateNotice) {
    return <Text fg={colors.headerText}>{updateNotice}</Text>;
  }

  return null;
}

export function Header() {
  useThemeColors();
  const baseCurrency = useAppSelector(selectBaseCurrency);
  const appActive = useAppActive();
  const { titleBarOverlay } = useUiCapabilities();
  const spyQuoteEntry = useQuoteEntry("SPY", null);
  const spyQuote = useResolvedEntryValue(spyQuoteEntry);

  useEffect(() => {
    if (!appActive) return;
    const coordinator = getSharedMarketDataCoordinator();
    if (!coordinator) return;
    const fetchSpy = async () => {
      await coordinator.loadQuote({ symbol: "SPY" }).catch(() => {});
    };
    fetchSpy();
    const id = setInterval(fetchSpy, SPY_REFRESH_MS);
    return () => { clearInterval(id); };
  }, [appActive]);

  const activeSpyQuote = getActiveQuoteDisplay(spyQuote);
  const spyColor = activeSpyQuote ? priceColor(activeSpyQuote.change) : colors.headerText;
  const spyText = activeSpyQuote
    ? `SPY ${formatMarketPrice(activeSpyQuote.price, { assetCategory: "ETF" })} ${formatPercentRaw(activeSpyQuote.changePercent)}`
    : "SPY —";

  // Market status
  const mktState = spyQuote?.marketState;
  const mktLabel = mktState ? marketStateLabel(mktState) : "";
  const mktColor = mktState ? marketStateColor(mktState) : colors.headerText;

  if (titleBarOverlay) {
    return (
      <Box
        flexDirection="row"
        height={1}
        alignItems="center"
        backgroundColor={colors.header}
        data-gloom-role="app-header"
        data-titlebar-overlay="true"
        className="electrobun-webkit-app-region-drag"
        style={{
          boxShadow: `0 -1px 0 ${colors.header}, inset 0 1px 0 ${colors.header}`,
          paddingLeft: 8,
          paddingRight: 12,
        }}
      >
        <Box paddingLeft={TITLEBAR_TRAFFIC_LIGHT_WIDTH} flexDirection="row" alignItems="center" gap={1}>
          <Text attributes={TextAttributes.BOLD} fg={colors.headerText}>
            Gloomberb
          </Text>
          <DesktopHeaderPill
            backgroundColor={blendHex(colors.header, colors.headerText, 0.1)}
            borderColor={blendHex(colors.border, colors.headerText, 0.28)}
          >
            <Text fg={colors.headerText} style={{ fontSize: 11 }}>v{VERSION}</Text>
          </DesktopHeaderPill>
        </Box>
        <Box flexGrow={1} paddingLeft={2} paddingRight={2} minWidth={0}>
          <UpdateStatus />
        </Box>
        {mktLabel ? (
          <Box paddingRight={1}>
            <DesktopHeaderPill
              backgroundColor={blendHex(colors.header, mktColor, 0.12)}
              borderColor={blendHex(colors.border, mktColor, 0.3)}
            >
              <Text fg={mktColor} style={{ fontSize: 11, fontWeight: 700 }}>{mktLabel}</Text>
            </DesktopHeaderPill>
          </Box>
        ) : null}
        <Box paddingRight={1}>
          <Text fg={spyColor}>{spyText}</Text>
        </Box>
        <Text fg={colors.headerText}>{baseCurrency}</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="row"
      height={1}
      backgroundColor={colors.header}
      data-gloom-role="app-header"
      data-titlebar-overlay={titleBarOverlay ? "true" : undefined}
      className={titleBarOverlay ? "electrobun-webkit-app-region-drag" : undefined}
    >
      <Box paddingLeft={titleBarOverlay ? TITLEBAR_TRAFFIC_LIGHT_WIDTH : 1}>
        <Text attributes={TextAttributes.BOLD} fg={colors.headerText}>
          Gloomberb v{VERSION}
        </Text>
      </Box>
      <Box flexGrow={1} paddingLeft={2}>
        <UpdateStatus />
      </Box>
      {mktLabel && (
        <Box paddingRight={1}>
          <Text fg={mktColor}>{mktLabel}</Text>
        </Box>
      )}
      <Box paddingRight={1}>
        <Text fg={spyColor}>{spyText}</Text>
      </Box>
      <Box paddingRight={1}>
        <Text fg={colors.headerText}>
          {baseCurrency}
        </Text>
      </Box>
    </Box>
  );
}
