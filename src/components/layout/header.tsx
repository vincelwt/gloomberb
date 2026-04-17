import { Box, SpinnerMark, Text, TextAttributes, useRendererHost, useUiCapabilities } from "../../ui";
import { useCallback, useEffect } from "react";
import { colors, priceColor } from "../../theme/colors";
import { useAppActive } from "../../state/app-activity";
import { useAppDispatch, useAppSelector } from "../../state/app-context";
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
import { formatMarketPrice } from "../../utils/market-format";
import { marketStateLabel, marketStateColor, getExtendedHoursInfo } from "../../utils/market-status";
import { VERSION } from "../../version";

const SPY_REFRESH_MS = 5 * 60_000; // 5 min
const UPDATE_NOTICE_DURATION_MS = 5_000;
const TITLEBAR_TRAFFIC_LIGHT_WIDTH = 11;

interface HeaderMouseEvent {
  button?: number;
  preventDefault?: () => void;
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
      return <Text fg={colors.headerText}>Update installed, restart to apply</Text>;
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
  const baseCurrency = useAppSelector(selectBaseCurrency);
  const appActive = useAppActive();
  const rendererHost = useRendererHost();
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

  const spyColor = spyQuote ? priceColor(spyQuote.change) : colors.headerText;
  const spyText = spyQuote
    ? `SPY ${formatMarketPrice(spyQuote.price, { assetCategory: "ETF" })} ${formatPercentRaw(spyQuote.changePercent)}`
    : "SPY —";

  // Extended hours info
  const extText = getExtendedHoursInfo(spyQuote);

  // Market status
  const mktState = spyQuote?.marketState;
  const mktLabel = mktState ? marketStateLabel(mktState) : "";
  const mktColor = mktState ? marketStateColor(mktState) : colors.headerText;
  const handleMouseDown = useCallback((event: HeaderMouseEvent) => {
    if (!titleBarOverlay || !rendererHost.startWindowDrag) return;
    if (typeof event.button === "number" && event.button !== 0) return;
    event.preventDefault?.();
    void Promise.resolve(rendererHost.startWindowDrag()).catch(() => {});
  }, [rendererHost, titleBarOverlay]);

  return (
    <Box
      flexDirection="row"
      height={1}
      backgroundColor={colors.header}
      data-gloom-role="app-header"
      data-titlebar-overlay={titleBarOverlay ? "true" : undefined}
      onMouseDown={handleMouseDown}
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
      <Box paddingRight={extText ? 0 : 1}>
        <Text fg={spyColor}>{spyText}</Text>
      </Box>
      {extText && (
        <Box paddingRight={1} paddingLeft={1}>
          <Text fg={extText.color}>{extText.text}</Text>
        </Box>
      )}
      <Box paddingRight={1}>
        <Text fg={colors.headerText}>
          {baseCurrency}
        </Text>
      </Box>
    </Box>
  );
}
