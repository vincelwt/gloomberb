import { useState, useEffect } from "react";
import { TextAttributes } from "@opentui/core";
import "opentui-spinner/react";
import { colors, priceColor } from "../../theme/colors";
import { useAppActive } from "../../state/app-activity";
import { useAppState } from "../../state/app-context";
import { getSharedMarketDataCoordinator } from "../../market-data/coordinator";
import { useQuoteEntry, useResolvedEntryValue } from "../../market-data/hooks";
import { formatPercentRaw } from "../../utils/format";
import { marketStateLabel, marketStateColor, getExtendedHoursInfo } from "../../utils/market-status";

const SPY_REFRESH_MS = 5 * 60_000; // 5 min

function UpdateStatus() {
  const { state } = useAppState();
  const { updateAvailable, updateProgress } = state;

  if (updateProgress) {
    if (updateProgress.phase === "downloading") {
      return (
        <box flexDirection="row" gap={1}>
          <spinner name="dots" color={colors.headerText} />
          <text fg={colors.headerText}>
            Downloading v{updateAvailable?.version}... {updateProgress.percent ?? 0}%
          </text>
        </box>
      );
    }
    if (updateProgress.phase === "replacing") {
      return (
        <box flexDirection="row" gap={1}>
          <spinner name="dots" color={colors.headerText} />
          <text fg={colors.headerText}>Installing update...</text>
        </box>
      );
    }
    if (updateProgress.phase === "done") {
      return <text fg={colors.headerText}>Update installed — restart to apply</text>;
    }
    if (updateProgress.phase === "error") {
      return <text fg={colors.headerText}>Update failed: {updateProgress.error}</text>;
    }
  }

  if (updateAvailable) {
    return (
      <text fg={colors.headerText}>
        v{updateAvailable.version} available — press <span fg={colors.headerText}>u</span> to update
      </text>
    );
  }

  return null;
}

export function Header() {
  const { state } = useAppState();
  const appActive = useAppActive();
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
    ? `SPY ${spyQuote.price.toFixed(2)} ${formatPercentRaw(spyQuote.changePercent)}`
    : "SPY —";

  // Extended hours info
  const extText = getExtendedHoursInfo(spyQuote);

  // Market status
  const mktState = spyQuote?.marketState;
  const mktLabel = mktState ? marketStateLabel(mktState) : "";
  const mktColor = mktState ? marketStateColor(mktState) : colors.headerText;

  return (
    <box
      flexDirection="row"
      height={1}
      backgroundColor={colors.header}
    >
      <box paddingLeft={1}>
        <text attributes={TextAttributes.BOLD} fg={colors.headerText}>
          GLOOMBERB TERMINAL
        </text>
      </box>
      <box flexGrow={1} paddingLeft={2}>
        <UpdateStatus />
      </box>
      {mktLabel && (
        <box paddingRight={1}>
          <text fg={mktColor}>{mktLabel}</text>
        </box>
      )}
      <box paddingRight={extText ? 0 : 1}>
        <text fg={spyColor}>{spyText}</text>
      </box>
      {extText && (
        <box paddingRight={1} paddingLeft={1}>
          <text fg={extText.color}>{extText.text}</text>
        </box>
      )}
      <box paddingRight={1}>
        <text fg={colors.headerText}>
          {state.config.baseCurrency}
        </text>
      </box>
    </box>
  );
}
