import { useEffect, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { GloomPlugin, DetailTabProps } from "../../types/plugin";
import type { OptionContract, OptionsChain } from "../../types/financials";
import { usePaneTicker } from "../../state/app-context";
import { ListView, type ListViewItem } from "../../components/ui";
import { colors, hoverBg } from "../../theme/colors";
import { padTo, formatCompact, formatNumber } from "../../utils/format";
import { formatMarketPrice } from "../../utils/market-format";
import { formatExpDate, resolveOptionsTarget } from "../../utils/options";
import { useOptionsQuery, useResolvedEntryValue } from "../../market-data/hooks";
import { Spinner } from "../../components/spinner";
import { setOptionsAvailability } from "./options-availability";

function OptionsTab({ width, height, focused, onCapture }: DetailTabProps) {
  const { ticker } = usePaneTicker();
  const [expIdx, setExpIdx] = useState(0);
  const [strikeIdx, setStrikeIdx] = useState(0);
  const [interactive, setInteractive] = useState(false);
  const [hoveredExpIdx, setHoveredExpIdx] = useState<number | null>(null);
  const target = resolveOptionsTarget(ticker);
  const isOpt = target?.isOptionTicker ?? false;
  const parsed = target?.parsedOption ?? null;
  const effectiveTicker = target?.effectiveTicker ?? "";
  const effectiveExchange = target?.effectiveExchange ?? "";
  const instrument = target?.instrument ?? null;
  const baseRequest = target
    ? {
      instrument: {
        symbol: effectiveTicker,
        exchange: effectiveExchange,
        brokerId: instrument?.brokerId,
        brokerInstanceId: instrument?.brokerInstanceId,
        instrument,
      },
    }
    : null;
  const initialChainEntry = useOptionsQuery(baseRequest);
  const initialChain = useResolvedEntryValue(initialChainEntry);
  const selectedExpiration = initialChain?.expirationDates[expIdx];
  const expirationChainEntry = useOptionsQuery(
    baseRequest && selectedExpiration != null
      ? { ...baseRequest, expirationDate: selectedExpiration }
      : null,
  );
  const expirationChain = useResolvedEntryValue(expirationChainEntry);
  const chain = expirationChain ?? initialChain;
  const loading = (initialChainEntry?.phase === "loading" || initialChainEntry?.phase === "refreshing") && !chain
    || (expirationChainEntry?.phase === "loading" || expirationChainEntry?.phase === "refreshing");
  const error = initialChainEntry?.phase === "error"
    ? initialChainEntry.error?.message ?? "Failed to load options"
    : expirationChainEntry?.phase === "error"
      ? expirationChainEntry.error?.message ?? "Failed to load options"
      : null;

  const enterInteractive = () => {
    if (!interactive) {
      setInteractive(true);
      onCapture(true);
    }
  };

  const exitInteractive = () => {
    if (interactive) {
      setInteractive(false);
      onCapture(false);
    }
  };

  // Exit interactive mode when ticker changes
  useEffect(() => {
    exitInteractive();
    setExpIdx(0);
    setStrikeIdx(0);
  }, [effectiveTicker]);

  useEffect(() => {
    setHoveredExpIdx(null);
  }, [expIdx]);

  useEffect(() => {
    if (!target) return;
    setOptionsAvailability(target, !!chain && chain.expirationDates.length > 0);
  }, [chain, target]);

  useEffect(() => {
    if (!parsed || !initialChain || initialChain.expirationDates.length === 0) return;
    const bestExpIdx = initialChain.expirationDates.reduce((best, ts, i) =>
      Math.abs(ts - parsed.expTs) < Math.abs(initialChain.expirationDates[best]! - parsed.expTs) ? i : best, 0);
    if (bestExpIdx !== expIdx) {
      setExpIdx(bestExpIdx);
    }
  }, [expIdx, initialChain, parsed]);

  useEffect(() => {
    setStrikeIdx(0);
  }, [expIdx]);

  // Build sorted strike list from the union of calls and puts
  const strikes = chain ? buildStrikeList(chain) : [];

  // Auto-scroll to matching strike when viewing an option position
  useEffect(() => {
    if (!parsed || strikes.length === 0) return;
    const matchIdx = strikes.findIndex((s) => Math.abs(s - parsed.strike) < 0.01);
    if (matchIdx >= 0) setStrikeIdx(matchIdx);
  }, [strikes.length, parsed?.strike]);

  // Keyboard navigation
  useKeyboard((event) => {
    if (!focused || !chain) return;

    const isEnter = event.name === "enter" || event.name === "return";

    // Enter/Escape for interactive mode
    if (isEnter && !interactive) {
      enterInteractive();
      return;
    }
    if (event.name === "escape" && interactive) {
      exitInteractive();
      return;
    }

    if (!interactive) return;

    // Arrow keys + j/k/h/l in interactive mode
    const numExp = chain.expirationDates.length;
    if (event.name === "j" || event.name === "down") {
      setStrikeIdx((i) => Math.min(i + 1, strikes.length - 1));
    } else if (event.name === "k" || event.name === "up") {
      setStrikeIdx((i) => Math.max(i - 1, 0));
    } else if (event.name === "h" || event.name === "left") {
      setExpIdx((i) => Math.max(i - 1, 0));
    } else if (event.name === "l" || event.name === "right") {
      setExpIdx((i) => Math.min(i + 1, numExp - 1));
    }
  });

  if (!ticker) return <text fg={colors.textDim}>Select a ticker to view options.</text>;
  if (loading && !chain) return <Spinner label="Loading options chain..." />;
  if (error) return <text fg={colors.textDim}>{error}</text>;
  if (!chain || chain.expirationDates.length === 0) return <text fg={colors.textDim}>No options available for {effectiveTicker}.</text>;

  const innerWidth = Math.max(width - 4, 60);
  const callsByStrike = new Map<number, OptionContract>(chain.calls.map((c) => [c.strike, c]));
  const putsByStrike = new Map<number, OptionContract>(chain.puts.map((p) => [p.strike, p]));

  // Column widths for each side
  const colW = { last: 7, bid: 7, ask: 7, vol: 6, oi: 6 };
  const sideW = colW.last + colW.bid + colW.ask + colW.vol + colW.oi + 4; // 4 gaps
  const strikeW = 9;
  const divW = 1;

  // Position info
  const posShares = isOpt && parsed
    ? ticker!.metadata.positions.reduce((sum, p) => sum + p.shares, 0)
    : 0;

  // Expiration selector — show a window of dates around the current selection
  const maxExpVisible = Math.max(Math.floor((innerWidth - 14) / 13), 3);
  const expStart = Math.max(0, Math.min(expIdx - Math.floor(maxExpVisible / 2), chain.expirationDates.length - maxExpVisible));
  const visibleExps = chain.expirationDates.slice(expStart, expStart + maxExpVisible);

  // Selected row detail
  const selectedStrike = strikes[strikeIdx];
  const selectedCall = selectedStrike != null ? callsByStrike.get(selectedStrike) : undefined;
  const selectedPut = selectedStrike != null ? putsByStrike.get(selectedStrike) : undefined;
  const strikeItems: ListViewItem[] = strikes.map((strike) => ({
    id: String(strike),
    label: formatStrikeLabel(strike),
  }));

  const hoverColor = hoverBg();

  return (
    <box flexDirection="column" flexGrow={1} paddingX={1} onMouseDown={() => { if (!interactive) enterInteractive(); }}>
      {/* Expiration selector */}
      <box flexDirection="row" height={1} gap={1}>
        <text fg={colors.textDim}>Exp:</text>
        {visibleExps.map((ts, i) => {
          const realIdx = expStart + i;
          const isActive = realIdx === expIdx;
          const isHovered = realIdx === hoveredExpIdx && !isActive;
          return (
            <box
              key={ts}
              onMouseMove={() => setHoveredExpIdx(realIdx)}
              onMouseOut={() => setHoveredExpIdx(null)}
              onMouseDown={() => { enterInteractive(); setExpIdx(realIdx); }}
            >
              <text
                fg={isActive ? colors.textBright : isHovered ? colors.text : colors.textMuted}
                attributes={isActive ? TextAttributes.BOLD : isHovered ? TextAttributes.UNDERLINE : 0}
              >
                {isActive ? `[${formatExpDate(ts)}]` : ` ${formatExpDate(ts)} `}
              </text>
            </box>
          );
        })}
        {loading && <spinner name="dots" color={colors.textDim} />}
      </box>

      {/* Position banner */}
      {isOpt && parsed && (
        <box height={1}>
          <text fg={colors.textBright}>
            {`Position: ${posShares} ${parsed.side === "C" ? "call" : "put"} contract${posShares !== 1 ? "s" : ""} @ $${parsed.strike}`}
          </text>
        </box>
      )}

      {/* Header labels */}
      <box flexDirection="row" height={1}>
        <box width={sideW}><text attributes={TextAttributes.BOLD} fg={colors.positive}>CALLS</text></box>
        <box width={divW}><text fg={colors.textDim}>{"\u2502"}</text></box>
        <box width={strikeW} />
        <box width={divW}><text fg={colors.textDim}>{"\u2502"}</text></box>
        <box width={sideW}><text attributes={TextAttributes.BOLD} fg={colors.negative}>PUTS</text></box>
      </box>

      {/* Column headers */}
      <box flexDirection="row" height={1}>
        <box width={sideW}>
          <text attributes={TextAttributes.BOLD} fg={colors.textDim}>
            {padTo("Last", colW.last)} {padTo("Bid", colW.bid)} {padTo("Ask", colW.ask)} {padTo("Vol", colW.vol)} {padTo("OI", colW.oi)}
          </text>
        </box>
        <box width={divW}><text fg={colors.textDim}>{"\u2502"}</text></box>
        <box width={strikeW}>
          <text attributes={TextAttributes.BOLD} fg={colors.textDim}>{padTo("Strike", strikeW, "center")}</text>
        </box>
        <box width={divW}><text fg={colors.textDim}>{"\u2502"}</text></box>
        <box width={sideW}>
          <text attributes={TextAttributes.BOLD} fg={colors.textDim}>
            {padTo("Last", colW.last)} {padTo("Bid", colW.bid)} {padTo("Ask", colW.ask)} {padTo("Vol", colW.vol)} {padTo("OI", colW.oi)}
          </text>
        </box>
      </box>

      {/* Chain rows */}
      <ListView
        items={strikeItems}
        selectedIndex={interactive ? strikeIdx : -1}
        scrollIndex={strikeIdx}
        onSelect={(index) => {
          enterInteractive();
          setStrikeIdx(index);
        }}
        renderRow={(_, state, i) => {
          const strike = strikes[i]!;
          const call = callsByStrike.get(strike);
          const put = putsByStrike.get(strike);
          const isSelected = state.selected;
          const isPositionStrike = parsed && Math.abs(strike - parsed.strike) < 0.01;
          const callItm = call?.inTheMoney;
          const putItm = put?.inTheMoney;

          return (
            <box flexDirection="row">
              <box width={sideW}>
                <text fg={callItm ? colors.textBright : colors.text}>
                  {formatContractRow(call, colW)}
                </text>
              </box>
              <box width={divW}><text fg={colors.textDim}>{"\u2502"}</text></box>
              <box width={strikeW}>
                <text fg={isSelected ? colors.textBright : colors.neutral} attributes={isSelected ? TextAttributes.BOLD : 0}>
                  {padTo(formatStrikeLabel(strike), strikeW, "center")}
                </text>
              </box>
              <box width={divW}><text fg={colors.textDim}>{"\u2502"}</text></box>
              <box width={sideW}>
                <text fg={putItm ? colors.textBright : colors.text}>
                  {formatContractRow(put, colW)}
                </text>
              </box>
            </box>
          );
        }}
        getRowBackgroundColor={(_, state, i) => {
          const strike = strikes[i]!;
          const isPositionStrike = parsed && Math.abs(strike - parsed.strike) < 0.01;
          if (state.selected) return colors.selected;
          if (state.hovered) return hoverColor;
          return isPositionStrike ? colors.selected : colors.bg;
        }}
        hoverBgColor={hoverColor}
        flexGrow={1}
        scrollable
      />

      {/* Detail for selected row */}
      {interactive && (selectedCall || selectedPut) && (
        <box height={1}>
          <text fg={colors.textDim}>
            {selectedCall ? `Call IV: ${(selectedCall.impliedVolatility * 100).toFixed(1)}%` : ""}
            {selectedCall && selectedPut ? "  |  " : ""}
            {selectedPut ? `Put IV: ${(selectedPut.impliedVolatility * 100).toFixed(1)}%` : ""}
          </text>
        </box>
      )}

      {/* Help */}
      <box height={1}>
        <text fg={colors.textMuted}>
          {interactive
            ? "j/k/\u2191\u2193 strike  h/l/\u2190\u2192 expiration  Esc exit"
            : "Enter to interact"}
        </text>
      </box>
    </box>
  );
}

function buildStrikeList(chain: OptionsChain): number[] {
  const set = new Set<number>();
  for (const c of chain.calls) set.add(c.strike);
  for (const p of chain.puts) set.add(p.strike);
  return Array.from(set).sort((a, b) => a - b);
}

function formatStrikeLabel(strike: number): string {
  const decimals = strike % 1 === 0 ? 0 : 2;
  return formatNumber(strike, decimals).replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

interface ColWidths {
  last: number;
  bid: number;
  ask: number;
  vol: number;
  oi: number;
}

function formatContractRow(contract: { lastPrice: number; bid: number; ask: number; volume: number; openInterest: number } | undefined, w: ColWidths): string {
  if (!contract) {
    return padTo("—", w.last) + " " + padTo("—", w.bid) + " " + padTo("—", w.ask) + " " + padTo("—", w.vol) + " " + padTo("—", w.oi);
  }
  return (
    padTo(formatMarketPrice(contract.lastPrice, { assetCategory: "OPT", maxWidth: w.last }), w.last) + " " +
    padTo(formatMarketPrice(contract.bid, { assetCategory: "OPT", maxWidth: w.bid }), w.bid) + " " +
    padTo(formatMarketPrice(contract.ask, { assetCategory: "OPT", maxWidth: w.ask }), w.ask) + " " +
    padTo(formatCompact(contract.volume), w.vol) + " " +
    padTo(formatCompact(contract.openInterest), w.oi)
  );
}

export const optionsPlugin: GloomPlugin = {
  id: "options",
  name: "Options",
  version: "1.0.0",
  description: "View options chain for tickers",
  toggleable: true,

  setup(ctx) {
    ctx.registerDetailTab({
      id: "options",
      name: "Options",
      order: 35, // after Chart (30), before News (40)
      component: OptionsTab,
    });
  },
};
