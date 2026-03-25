import { useState, useEffect } from "react";
import { TextAttributes } from "@opentui/core";
import { colors, priceColor } from "../../theme/colors";
import { useAppState } from "../../state/app-context";
import { formatPercentRaw } from "../../utils/format";
import type { YahooFinanceClient } from "../../sources/yahoo-finance";
import type { Quote } from "../../types/financials";

const SPY_REFRESH_MS = 5 * 60_000; // 5 min

export function Header({ yahoo }: { yahoo: YahooFinanceClient }) {
  const { state } = useAppState();
  const [spyQuote, setSpyQuote] = useState<Quote | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchSpy = async () => {
      try {
        const quote = await yahoo.getQuote("SPY");
        if (!cancelled) setSpyQuote(quote);
      } catch {}
    };
    fetchSpy();
    const id = setInterval(fetchSpy, SPY_REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [yahoo]);

  const spyColor = spyQuote ? priceColor(spyQuote.change) : colors.headerText;
  const spyText = spyQuote
    ? `SPY ${spyQuote.price.toFixed(2)} ${formatPercentRaw(spyQuote.changePercent)}`
    : "SPY —";

  return (
    <box
      flexDirection="row"
      height={1}
      backgroundColor={colors.header}
    >
      <box flexGrow={1} paddingLeft={1}>
        <text attributes={TextAttributes.BOLD} fg={colors.headerText}>
          GLOOMBERB TERMINAL
        </text>
      </box>
      <box paddingRight={1}>
        <text fg={spyColor}>{spyText}</text>
      </box>
      <box paddingRight={1}>
        <text fg={colors.headerText}>
          {state.config.baseCurrency}
        </text>
      </box>
    </box>
  );
}
