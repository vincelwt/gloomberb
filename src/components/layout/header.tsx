import { useState, useEffect } from "react";
import { TextAttributes } from "@opentui/core";
import { colors, priceColor } from "../../theme/colors";
import { useAppState } from "../../state/app-context";
import { formatPercentRaw } from "../../utils/format";
import { marketStateLabel, marketStateColor } from "../../utils/market-status";
import type { DataProvider } from "../../types/data-provider";
import type { Quote } from "../../types/financials";

const SPY_REFRESH_MS = 5 * 60_000; // 5 min

function UpdateStatus() {
  const { state } = useAppState();
  const { updateAvailable, updateProgress } = state;

  if (updateProgress) {
    if (updateProgress.phase === "downloading") {
      return (
        <text fg={colors.headerText}>
          Downloading v{updateAvailable?.version}... {updateProgress.percent ?? 0}%
        </text>
      );
    }
    if (updateProgress.phase === "replacing") {
      return <text fg={colors.headerText}>Installing update...</text>;
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

export function Header({ dataProvider }: { dataProvider: DataProvider }) {
  const { state } = useAppState();
  const [spyQuote, setSpyQuote] = useState<Quote | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchSpy = async () => {
      try {
        const quote = await dataProvider.getQuote("SPY");
        if (!cancelled) setSpyQuote(quote);
      } catch {}
    };
    fetchSpy();
    const id = setInterval(fetchSpy, SPY_REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [dataProvider]);

  const spyColor = spyQuote ? priceColor(spyQuote.change) : colors.headerText;
  const spyText = spyQuote
    ? `SPY ${spyQuote.price.toFixed(2)} ${formatPercentRaw(spyQuote.changePercent)}`
    : "SPY —";

  // Extended hours info
  const extText = getExtendedHoursText(spyQuote);

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

function getExtendedHoursText(quote: Quote | null): { text: string; color: string } | null {
  if (!quote) return null;
  if (quote.marketState === "PRE" && quote.preMarketPrice != null) {
    const chg = quote.preMarketChangePercent ?? 0;
    return { text: `Pre ${quote.preMarketPrice.toFixed(2)} ${formatPercentRaw(chg)}`, color: priceColor(chg) };
  }
  if (quote.marketState === "POST" && quote.postMarketPrice != null) {
    const chg = quote.postMarketChangePercent ?? 0;
    return { text: `AH ${quote.postMarketPrice.toFixed(2)} ${formatPercentRaw(chg)}`, color: priceColor(chg) };
  }
  return null;
}
